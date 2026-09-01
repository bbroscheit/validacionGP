const { getGpPoolEcobahia, getGpPoolSist2, sql } = require('../../config/gpPool');
const { resolverSucursalSist2, CLIENTE_SUCURSAL_JOIN_SIST2, CLIENTE_SUCURSAL_SELECT_SIST2 } = require('../../services/sist2Ventas');

const POOLS = { ecobahia: getGpPoolEcobahia, sist2: getGpPoolSist2 };

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

const getAsientoVentas = async ({ fechaDesde, fechaHasta, sucursal, soloConP = true, empresa = 'ecobahia' }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const getPool = POOLS[empresa];
  if (!getPool) throw new Error(`Empresa desconocida: "${empresa}"`);
  const pool = await getPool();
  const soloConPBool = soloConP === false || soloConP === 'false' ? false : true;
  const sucursalFiltro = sucursal ? sucursal.trim() : null;
  const filtrarSucursalEnSql = empresa !== 'sist2';

  const bindFilters = (request) => {
    request.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
    request.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
    request.input('soloConP', sql.Bit, soloConPBool);
    request.input('sucursal', sql.VarChar(100), filtrarSucursalEnSql ? sucursalFiltro : null);
    return request;
  };

  const sopJoinCondSist2 = empresa === 'sist2' ? ' AND H.SOPTYPE = G.ORTRXTYP' : '';
  const clienteSucursalJoin = empresa === 'sist2' ? CLIENTE_SUCURSAL_JOIN_SIST2 : '';
  const clienteSucursalSelect = empresa === 'sist2' ? CLIENTE_SUCURSAL_SELECT_SIST2 : '';

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
      AND (@sucursal IS NULL OR LTRIM(RTRIM(H.PHONE3)) = @sucursal)
  `);
  const totalCount = count.recordset[0].total;

  const detalleRequest = bindFilters(pool.request());
  const detalle = await detalleRequest.query(`
    SELECT TOP (${MAX_ROWS})
      NULLIF(LTRIM(RTRIM(H.PHONE3)), '') AS PHONE3,
      LTRIM(RTRIM(H.DOCID)) AS DOCID,
      LTRIM(RTRIM(G.ORDOCNUM)) AS Comprobante,
      LTRIM(RTRIM(N.ACTNUMST)) AS Cuenta,
      LTRIM(RTRIM(A.ACTDESCR)) AS CuentaDescripcion,
      G.DEBITAMT,
      G.CRDTAMNT${clienteSucursalSelect}
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
      AND (@sucursal IS NULL OR LTRIM(RTRIM(H.PHONE3)) = @sucursal)
    ORDER BY Cuenta ASC
  `);

  const detalleFiltrado = empresa === 'sist2' && sucursalFiltro
    ? detalle.recordset.filter((row) => resolverSucursalSist2({ phone3: row.PHONE3, docid: row.DOCID, clienteUserdef2: row.ClienteSucursal }) === sucursalFiltro)
    : detalle.recordset;

  const base = detalleFiltrado.map((row) => ({
    Comprobante: row.Comprobante,
    Cuenta: row.Cuenta,
    CuentaDescripcion: row.CuentaDescripcion,
    Debe: row.DEBITAMT || 0,
    Haber: row.CRDTAMNT || 0,
  }));

  const agrupado = new Map();
  base.forEach((row) => {
    if (!agrupado.has(row.Cuenta)) {
      agrupado.set(row.Cuenta, { Cuenta: row.Cuenta, CuentaDescripcion: row.CuentaDescripcion, neto: 0 });
    }
    agrupado.get(row.Cuenta).neto += row.Debe - row.Haber;
  });

  const rows = [...agrupado.values()]
    .sort((a, b) => a.Cuenta.localeCompare(b.Cuenta))
    .map(({ Cuenta, CuentaDescripcion, neto }) => ({
      Cuenta,
      CuentaDescripcion,
      Debe: neto > 0 ? neto : 0,
      Haber: neto < 0 ? -neto : 0,
    }));

  const totalDebe = rows.reduce((acc, row) => acc + row.Debe, 0);
  const totalHaber = rows.reduce((acc, row) => acc + row.Haber, 0);

  return {
    totalCount,
    truncated: totalCount > MAX_ROWS,
    base,
    baseColumns: ['Comprobante', 'Cuenta', 'CuentaDescripcion', 'Debe', 'Haber'],
    rows,
    columns: ['Cuenta', 'CuentaDescripcion', 'Debe', 'Haber'],
    totalDebe,
    totalHaber,
    diferencia: totalDebe - totalHaber,
  };
};

module.exports = getAsientoVentas;
