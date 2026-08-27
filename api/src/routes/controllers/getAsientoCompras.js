const { getGpPoolEcobahia, sql } = require('../../config/gpPool');

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

const getAsientoCompras = async ({ fechaDesde, fechaHasta /* , sucursal */ }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const pool = await getGpPoolEcobahia();
  // const sucursalFiltro = sucursal ? sucursal.trim().toUpperCase() : null;

  const bindFilters = (request) => {
    request.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
    request.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
    // request.input('sucursal', sql.VarChar(100), sucursalFiltro);
    return request;
  };

  const noAnuladaWhere = `
    AND NOT EXISTS (
      SELECT 1 FROM PM30200 P
      WHERE LTRIM(RTRIM(P.DOCNUMBR)) = LTRIM(RTRIM(G.ORDOCNUM))
        AND LTRIM(RTRIM(P.VENDORID)) = LTRIM(RTRIM(G.ORMSTRID))
        AND P.VOIDED = 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM PM20000 P
      WHERE LTRIM(RTRIM(P.DOCNUMBR)) = LTRIM(RTRIM(G.ORDOCNUM))
        AND LTRIM(RTRIM(P.VENDORID)) = LTRIM(RTRIM(G.ORMSTRID))
        AND P.VOIDED = 1
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
      G.CRDTAMNT
    FROM GL20000 AS G
    INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
    INNER JOIN GL00100 AS A ON A.ACTINDX = G.ACTINDX
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

module.exports = getAsientoCompras;
