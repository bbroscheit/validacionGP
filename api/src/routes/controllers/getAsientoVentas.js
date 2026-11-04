const { getGpPoolEcobahia, getGpPoolEcosistemas, getGpPoolEcoportatiles, getGpPoolBaxpa, getGpPoolCylius, getGpPoolChile, getGpPoolSist2, sql } = require('../../config/gpPool');
const { resolverSucursalSist2, CLIENTE_SUCURSAL_JOIN_SIST2, CLIENTE_SUCURSAL_SELECT_SIST2 } = require('../../services/sist2Ventas');
const { coincideSucursal } = require('../../services/autorizacion');
const { getOverridesMap } = require('../../services/clasificacionOverrides');

const POOLS = { ecobahia: getGpPoolEcobahia, ecosistemas: getGpPoolEcosistemas, ecoportatiles: getGpPoolEcoportatiles, baxpa: getGpPoolBaxpa, cylius: getGpPoolCylius, chile: getGpPoolChile, sist2: getGpPoolSist2 };

// Reporte - Asiento contable de ventas (resumen), opcionalmente filtrado por sucursal
// A diferencia de "Ventas por sucursal y cuenta" (que excluye deudores por venta porque
// busca el neto facturado), acá SÍ hace falta esa cuenta: es el asiento real, tiene que
// cerrar Debe = Haber. Confirmado contra PRD08 (Bahía Blanca, julio/2026): Debe = Haber
// exacto agrupando GL20000 (SOURCDOC=SJ) por cuenta, cruzando SOP30200 por ORDOCNUM para
// filtrar por sucursal (PHONE3 en Ecobahia; en sist2, las 3 fuentes de
// services/sist2Ventas.js).
//
// sist2: el filtro de sucursal se resuelve en JS (no en SQL, porque la sucursal ahí sale
// de resolverSucursalSist2 y no de una sola columna) - se trae todo y se filtra después.
// También hace falta desambiguar el join a SOP30200 por G.ORTRXTYP = H.SOPTYPE: en sist2
// un mismo número de comprobante puede pertenecer a dos documentos reales distintos
// (Factura y Devolución con la serie numérica pisada, ver getVentasPorSucursalCuenta.js)
// y sin este join el Debe/Haber queda duplicado.
//
// Una cuenta no puede figurar con importe en Debe y en Haber a la vez (eso pasaba con
// facturas y notas de crédito mezcladas en el mismo período): se suma el neto (Debe -
// Haber) por cuenta y ese neto se manda a una sola columna - positivo va a Debe,
// negativo va a Haber (en positivo).
//
// Se trae siempre el detalle por línea de asiento (`base`) además del resumen (`rows`):
// el resumen se calcula en JS a partir de ese mismo detalle, así el Excel de control
// (pestaña "Base" + pestaña "Resultado") es una suma verificable línea por línea.
const MAX_ROWS = 100000;
const MONEDA_VACIA = 'En Blanco';

const getAsientoVentas = async ({ fechaDesde, fechaHasta, sucursal, soloConP = true, empresa = 'ecobahia', sucursalRestringida = null }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const getPool = POOLS[empresa];
  if (!getPool) throw new Error(`Empresa desconocida: "${empresa}"`);
  const pool = await getPool();
  const soloConPBool = soloConP === false || soloConP === 'false' ? false : true;
  const sucursalFiltro = sucursal ? sucursal.trim() : null;

  // Cylius factura en UYU/USD sin tipo de cambio en la base, y confirmado contra PRD07
  // que GL20000 queda en la moneda ORIGINAL del comprobante (no convertida) - un asiento
  // de una factura en USD posta sus importes en USD tal cual, no en pesos uruguayos. Por
  // eso acá también hay que separar el asiento por moneda (vía el mismo LEFT JOIN a
  // SOP30200 que ya trae la sucursal) en vez de sumar Debe/Haber de las dos monedas
  // juntas - cada moneda sigue cerrando Debe = Haber por separado.
  const multiMoneda = empresa === 'cylius';
  const monedaSelect = multiMoneda ? ', LTRIM(RTRIM(H.CURNCYID)) AS Moneda' : '';

  const bindFilters = (request) => {
    request.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
    request.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
    request.input('soloConP', sql.Bit, soloConPBool);
    return request;
  };

  const sopJoinCondSist2 = empresa === 'sist2' ? ' AND H.SOPTYPE = G.ORTRXTYP' : '';
  const clienteSucursalJoin = empresa === 'sist2' ? CLIENTE_SUCURSAL_JOIN_SIST2 : '';
  const clienteSucursalSelect = empresa === 'sist2' ? CLIENTE_SUCURSAL_SELECT_SIST2 : '';

  // El filtro por sucursal (tanto el dropdown opcional como el acceso restringido) se
  // resuelve siempre en JS, no en SQL: para Ecobahia hay que poder pisar PHONE3 con un
  // override manual (clasificacionOverrides.js) cuando viene en blanco - filtrar por
  // "H.PHONE3 = @sucursal" en SQL se comía esos comprobantes corregidos a mano (no
  // aparecían ni con el dropdown ni, más grave, para un usuario restringido). Mismo
  // criterio que ya usaba sist2 (ahí la sucursal nunca vino de una sola columna).
  const countRequest = bindFilters(pool.request());
  const count = await countRequest.query(`
    SELECT COUNT(*) AS total
    FROM GL20000 AS G
    LEFT JOIN SOP30200 AS H ON LTRIM(RTRIM(H.SOPNUMBE)) = LTRIM(RTRIM(G.ORDOCNUM))${sopJoinCondSist2}
    WHERE
      LTRIM(RTRIM(G.SOURCDOC)) = 'SJ'
      AND G.TRXDATE >= @fechaDesde
      AND G.TRXDATE <= @fechaHasta
      AND (@soloConP = 0 OR LTRIM(RTRIM(G.ORDOCNUM)) LIKE '%P%')
  `);
  const totalCount = count.recordset[0].total;

  const [detalle, overridesMap] = await Promise.all([
    bindFilters(pool.request()).query(`
      SELECT TOP (${MAX_ROWS})
        NULLIF(LTRIM(RTRIM(H.PHONE3)), '') AS PHONE3,
        LTRIM(RTRIM(H.DOCID)) AS DOCID,
        LTRIM(RTRIM(G.ORDOCNUM)) AS Comprobante,
        LTRIM(RTRIM(N.ACTNUMST)) AS Cuenta,
        LTRIM(RTRIM(A.ACTDESCR)) AS CuentaDescripcion,
        G.DEBITAMT,
        G.CRDTAMNT${clienteSucursalSelect}${monedaSelect}
      FROM GL20000 AS G
      INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
      INNER JOIN GL00100 AS A ON A.ACTINDX = G.ACTINDX
      LEFT JOIN SOP30200 AS H ON LTRIM(RTRIM(H.SOPNUMBE)) = LTRIM(RTRIM(G.ORDOCNUM))${sopJoinCondSist2}
      ${clienteSucursalJoin}
      WHERE
        LTRIM(RTRIM(G.SOURCDOC)) = 'SJ'
        AND G.TRXDATE >= @fechaDesde
        AND G.TRXDATE <= @fechaHasta
        AND (@soloConP = 0 OR LTRIM(RTRIM(G.ORDOCNUM)) LIKE '%P%')
      ORDER BY Cuenta ASC
    `),
    getOverridesMap({ empresa, tipo: 'sucursal' }),
  ]);

  const sucursalDeFila = (row) => {
    const sucursalCalculada = empresa === 'sist2'
      ? resolverSucursalSist2({ phone3: row.PHONE3, docid: row.DOCID, clienteUserdef2: row.ClienteSucursal })
      : row.PHONE3;
    return overridesMap.get(row.Comprobante) || sucursalCalculada;
  };

  const detalleFiltrado = sucursalFiltro
    ? detalle.recordset.filter((row) => coincideSucursal(sucursalDeFila(row), sucursalFiltro))
    : detalle.recordset;

  // Acceso restringido por sucursal (services/autorizacion.js): el valor de AD viene con
  // formato libre (tildes/mayúsculas), por eso coincideSucursal en vez de comparar exacto.
  const detalleVisible = sucursalRestringida
    ? detalleFiltrado.filter((row) => coincideSucursal(sucursalDeFila(row), sucursalRestringida))
    : detalleFiltrado;

  const base = detalleVisible.map((row) => ({
    Comprobante: row.Comprobante,
    ...(multiMoneda ? { Moneda: row.Moneda || MONEDA_VACIA } : {}),
    Cuenta: row.Cuenta,
    CuentaDescripcion: row.CuentaDescripcion,
    Debe: row.DEBITAMT || 0,
    Haber: row.CRDTAMNT || 0,
  }));

  const claveDe = (row) => (multiMoneda ? `${row.Cuenta}__${row.Moneda}` : row.Cuenta);

  const agrupado = new Map();
  base.forEach((row) => {
    const clave = claveDe(row);
    if (!agrupado.has(clave)) {
      agrupado.set(clave, { Cuenta: row.Cuenta, ...(multiMoneda ? { Moneda: row.Moneda } : {}), CuentaDescripcion: row.CuentaDescripcion, neto: 0 });
    }
    agrupado.get(clave).neto += row.Debe - row.Haber;
  });

  const rows = [...agrupado.values()]
    .sort((a, b) => a.Cuenta.localeCompare(b.Cuenta) || (multiMoneda ? a.Moneda.localeCompare(b.Moneda) : 0))
    .map(({ Cuenta, Moneda, CuentaDescripcion, neto }) => ({
      Cuenta,
      ...(multiMoneda ? { Moneda } : {}),
      CuentaDescripcion,
      Debe: neto > 0 ? neto : 0,
      Haber: neto < 0 ? -neto : 0,
    }));

  let totalDebe, totalHaber, diferencia, totalesPorMoneda;
  if (multiMoneda) {
    const porMoneda = new Map();
    rows.forEach((row) => {
      if (!porMoneda.has(row.Moneda)) porMoneda.set(row.Moneda, { Moneda: row.Moneda, totalDebe: 0, totalHaber: 0 });
      const t = porMoneda.get(row.Moneda);
      t.totalDebe += row.Debe;
      t.totalHaber += row.Haber;
    });
    totalesPorMoneda = [...porMoneda.values()]
      .map((t) => ({ ...t, diferencia: t.totalDebe - t.totalHaber }))
      .sort((a, b) => a.Moneda.localeCompare(b.Moneda));
  } else {
    totalDebe = rows.reduce((acc, row) => acc + row.Debe, 0);
    totalHaber = rows.reduce((acc, row) => acc + row.Haber, 0);
    diferencia = totalDebe - totalHaber;
  }

  return {
    totalCount,
    truncated: totalCount > MAX_ROWS,
    base,
    baseColumns: multiMoneda ? ['Comprobante', 'Moneda', 'Cuenta', 'CuentaDescripcion', 'Debe', 'Haber'] : ['Comprobante', 'Cuenta', 'CuentaDescripcion', 'Debe', 'Haber'],
    rows,
    columns: multiMoneda ? ['Cuenta', 'Moneda', 'CuentaDescripcion', 'Debe', 'Haber'] : ['Cuenta', 'CuentaDescripcion', 'Debe', 'Haber'],
    ...(multiMoneda ? { totalesPorMoneda } : { totalDebe, totalHaber, diferencia }),
  };
};

module.exports = getAsientoVentas;
