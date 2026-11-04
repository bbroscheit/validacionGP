const { getGpPoolEcobahia, getGpPoolEcosistemas, getGpPoolEcoportatiles, getGpPoolBaxpa, getGpPoolCylius, getGpPoolChile, sql } = require('../../config/gpPool');

const POOLS = { ecobahia: getGpPoolEcobahia, ecosistemas: getGpPoolEcosistemas, ecoportatiles: getGpPoolEcoportatiles, baxpa: getGpPoolBaxpa, cylius: getGpPoolCylius, chile: getGpPoolChile };

// Reporte - Asiento contable de compras (resumen)
// Mismo esquema que getAsientoVentas.js: GL20000 (SOURCDOC = PMTRX/PMVVR, grupo "compras"
// de getGastos.js) agrupado por cuenta con Debe y Haber. Es el asiento real, sin excluir
// ninguna cuenta - tiene que cerrar Debe = Haber.
// Una cuenta no puede figurar con importe en Debe y en Haber a la vez: se suma el neto
// (Debe - Haber) por cuenta y se manda a una sola columna - positivo a Debe, negativo a
// Haber (en positivo).
// Igual que en Gastos/Compras: GL20000.VOIDED no sirve (siempre da 0), se cruza contra
// PM30200/PM20000.VOIDED=1 por DOCNUMBR+VENDORID.
//
// El filtro por sucursal se sacó por ahora (código comentado más abajo, por si hace
// falta reactivarlo): a diferencia de Ventas, acá la Zona es una dimensión de
// Contabilidad Analítica por línea de asiento, no un campo de cabecera compartido por
// todas las líneas del comprobante - las cuentas de proveedores E impuestos no tienen
// Zona cargada, así que filtrando por una sucursal puntual el asiento nunca cierra
// (falta siempre la contrapartida). Confirmado contra PRD08.
const MAX_ROWS = 100000;
const MONEDA_VACIA = 'En Blanco';

const getAsientoCompras = async ({ fechaDesde, fechaHasta, empresa = 'ecobahia' /* , sucursal */ }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const pool = await POOLS[empresa]();
  // const sucursalFiltro = sucursal ? sucursal.trim().toUpperCase() : null;

  // Cylius factura en UYU/USD sin tipo de cambio en la base, y GL20000 queda en la
  // moneda original del comprobante (confirmado igual que en Ventas) - acá la moneda no
  // vive en el comprobante de compra en sí (PM20000/PM30200 no tienen cabecera única
  // como SOP30200), hay que resolverla cruzando por DOCNUMBR+VENDORID contra la que esté
  // abierta (PM20000) o pagada (PM30200) - un documento vive en una sola de las dos.
  const multiMoneda = empresa === 'cylius';
  const monedaSelect = multiMoneda ? ', LTRIM(RTRIM(COALESCE(PM1.CURNCYID, PM2.CURNCYID))) AS Moneda' : '';
  const monedaJoin = multiMoneda ? `
      LEFT JOIN PM30200 AS PM1 ON LTRIM(RTRIM(PM1.DOCNUMBR)) = LTRIM(RTRIM(G.ORDOCNUM)) AND LTRIM(RTRIM(PM1.VENDORID)) = LTRIM(RTRIM(G.ORMSTRID))
      LEFT JOIN PM20000 AS PM2 ON LTRIM(RTRIM(PM2.DOCNUMBR)) = LTRIM(RTRIM(G.ORDOCNUM)) AND LTRIM(RTRIM(PM2.VENDORID)) = LTRIM(RTRIM(G.ORMSTRID))
  ` : '';

  const bindFilters = (request) => {
    request.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
    request.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
    // request.input('sucursal', sql.VarChar(100), sucursalFiltro);
    return request;
  };

  // Se excluyen también los comprobantes VOIDED y, a pedido del usuario (mismo criterio
  // que Libro IVA Digital / Compras por sucursal), los DOCTYPE 3 (Cargo misceláneo), 4
  // (Devolución) y 6 (Pago) - son ajustes internos o pagos, no compras reales. Se excluye
  // el comprobante ENTERO (todas sus líneas) en los tres casos, así el asiento sigue
  // cerrando (Debe = Haber) - nunca se excluye una línea suelta dentro de un comprobante.
  const noAnuladaWhere = `
    AND NOT EXISTS (
      SELECT 1 FROM PM30200 P
      WHERE LTRIM(RTRIM(P.DOCNUMBR)) = LTRIM(RTRIM(G.ORDOCNUM))
        AND LTRIM(RTRIM(P.VENDORID)) = LTRIM(RTRIM(G.ORMSTRID))
        AND (P.VOIDED = 1 OR P.DOCTYPE IN (3, 4, 6))
    )
    AND NOT EXISTS (
      SELECT 1 FROM PM20000 P
      WHERE LTRIM(RTRIM(P.DOCNUMBR)) = LTRIM(RTRIM(G.ORDOCNUM))
        AND LTRIM(RTRIM(P.VENDORID)) = LTRIM(RTRIM(G.ORMSTRID))
        AND (P.VOIDED = 1 OR P.DOCTYPE IN (3, 4, 6))
    )
  `;

  const countRequest = bindFilters(pool.request());
  const count = await countRequest.query(`
    SELECT COUNT(*) AS total
    FROM GL20000 AS G
    WHERE
      LTRIM(RTRIM(G.SOURCDOC)) IN ('PMTRX', 'PMVVR')
      AND G.TRXDATE >= @fechaDesde
      AND G.TRXDATE <= @fechaHasta
      ${noAnuladaWhere}
  `);
  /* Versión con filtro por sucursal (AA por línea de asiento) - reactivar si hace falta:
  const count = await countRequest.query(`
    WITH AADetalle AS (
      SELECT
        A.[Entrada de diario] AS JRNENTRY,
        A.[Índice de cuenta] AS ACTINDX,
        MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'ZONA'
            THEN NULLIF(LTRIM(RTRIM(A.[Descripción del código de dimensión de transacción])), '') END) AS ZONA_DESC
      FROM dbo.AATransactions A
      GROUP BY A.[Entrada de diario], A.[Índice de cuenta]
    )
    SELECT COUNT(*) AS total
    FROM GL20000 AS G
    LEFT JOIN AADetalle AS AA ON AA.JRNENTRY = G.JRNENTRY AND AA.ACTINDX = G.ACTINDX
    WHERE
      LTRIM(RTRIM(G.SOURCDOC)) IN ('PMTRX', 'PMVVR')
      AND G.TRXDATE >= @fechaDesde
      AND G.TRXDATE <= @fechaHasta
      AND (@sucursal IS NULL OR UPPER(LTRIM(RTRIM(AA.ZONA_DESC))) = @sucursal)
      ${noAnuladaWhere}
  `);
  */
  const totalCount = count.recordset[0].total;

  const detalleRequest = bindFilters(pool.request());
  const detalle = await detalleRequest.query(`
    SELECT TOP (${MAX_ROWS})
      LTRIM(RTRIM(G.ORDOCNUM)) AS Comprobante,
      LTRIM(RTRIM(N.ACTNUMST)) AS Cuenta,
      LTRIM(RTRIM(A.ACTDESCR)) AS CuentaDescripcion,
      G.DEBITAMT,
      G.CRDTAMNT${monedaSelect}
    FROM GL20000 AS G
    INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
    INNER JOIN GL00100 AS A ON A.ACTINDX = G.ACTINDX
    ${monedaJoin}
    WHERE
      LTRIM(RTRIM(G.SOURCDOC)) IN ('PMTRX', 'PMVVR')
      AND G.TRXDATE >= @fechaDesde
      AND G.TRXDATE <= @fechaHasta
      ${noAnuladaWhere}
    ORDER BY Cuenta ASC
  `);
  /* Versión con filtro por sucursal - reactivar si hace falta:
  const detalle = await detalleRequest.query(`
    WITH AADetalle AS (
      SELECT
        A.[Entrada de diario] AS JRNENTRY,
        A.[Índice de cuenta] AS ACTINDX,
        MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'ZONA'
            THEN NULLIF(LTRIM(RTRIM(A.[Descripción del código de dimensión de transacción])), '') END) AS ZONA_DESC
      FROM dbo.AATransactions A
      GROUP BY A.[Entrada de diario], A.[Índice de cuenta]
    )
    SELECT TOP (${MAX_ROWS})
      LTRIM(RTRIM(G.ORDOCNUM)) AS Comprobante,
      LTRIM(RTRIM(N.ACTNUMST)) AS Cuenta,
      LTRIM(RTRIM(A.ACTDESCR)) AS CuentaDescripcion,
      G.DEBITAMT,
      G.CRDTAMNT
    FROM GL20000 AS G
    INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
    INNER JOIN GL00100 AS A ON A.ACTINDX = G.ACTINDX
    LEFT JOIN AADetalle AS AA ON AA.JRNENTRY = G.JRNENTRY AND AA.ACTINDX = G.ACTINDX
    WHERE
      LTRIM(RTRIM(G.SOURCDOC)) IN ('PMTRX', 'PMVVR')
      AND G.TRXDATE >= @fechaDesde
      AND G.TRXDATE <= @fechaHasta
      AND (@sucursal IS NULL OR UPPER(LTRIM(RTRIM(AA.ZONA_DESC))) = @sucursal)
      ${noAnuladaWhere}
    ORDER BY Cuenta ASC
  `);
  */

  const base = detalle.recordset.map((row) => ({
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

module.exports = getAsientoCompras;
