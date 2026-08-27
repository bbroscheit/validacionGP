const { getGpPoolEcobahia, sql } = require('../../config/gpPool');

// Reporte - Compras por sucursal y cuenta contable
// Mismo esquema que getVentasPorSucursalCuenta.js pero para compras: GL20000 filtrado por
// SOURCDOC = PMTRX/PMVVR (grupo "compras" de getGastos.js), zona vía Contabilidad
// Analítica (AATransactions, igual que en getComprasPorSucursal.js - se agrupa por
// descripción normalizada porque el código de zona cambió durante el mes).
//
// A diferencia de "Compras por sucursal" (que ya excluye proveedores/impuestos para dar
// un Neto limpio), acá van TODAS las cuentas sin filtrar nada por SQL - el control de qué
// entra al total se hace con los checkboxes en pantalla, para tener visibilidad completa
// de cada cuenta que toca el asiento (incluida proveedores, para poder verificarla).
//
// Igual que en Gastos/Compras por sucursal: GL20000.VOIDED no sirve (siempre da 0), se
// cruza contra PM30200/PM20000.VOIDED=1 por DOCNUMBR+VENDORID.
const MONEDA_VACIA = 'En Blanco';
const MAX_ROWS = 100000;

const getComprasPorSucursalCuenta = async ({ fechaDesde, fechaHasta }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const pool = await getGpPoolEcobahia();

  const bindFilters = (request) => {
    request.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
    request.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
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
  const totalCount = count.recordset[0].total;

  const detalleRequest = bindFilters(pool.request());
  const detalle = await detalleRequest.query(`
    WITH AADetalle AS (
      SELECT
        A.[Entrada de diario] AS JRNENTRY,
        A.[Índice de cuenta] AS ACTINDX,
        MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'ZONA'
            THEN NULLIF(LTRIM(RTRIM(A.[Cód. de dimensión de trans.])), '') END) AS ZONA,
        MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'ZONA'
            THEN NULLIF(LTRIM(RTRIM(A.[Descripción del código de dimensión de transacción])), '') END) AS ZONA_DESC
      FROM dbo.AATransactions A
      GROUP BY A.[Entrada de diario], A.[Índice de cuenta]
    )
    SELECT TOP (${MAX_ROWS})
      NULLIF(UPPER(LTRIM(RTRIM(AA.ZONA_DESC))), '') AS Sucursal,
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
      ${noAnuladaWhere}
    ORDER BY Sucursal ASC, Cuenta ASC
  `);

  const base = detalle.recordset.map((row) => ({
    Sucursal: row.Sucursal || MONEDA_VACIA,
    Comprobante: row.Comprobante,
    Cuenta: row.Cuenta,
    CuentaDescripcion: row.CuentaDescripcion,
    Monto: (row.DEBITAMT || 0) - (row.CRDTAMNT || 0),
  }));

  const agrupado = new Map();
  base.forEach((row) => {
    const key = `${row.Sucursal}||${row.Cuenta}`;
    if (!agrupado.has(key)) {
      agrupado.set(key, { Sucursal: row.Sucursal, Cuenta: row.Cuenta, CuentaDescripcion: row.CuentaDescripcion, Monto: 0 });
    }
    agrupado.get(key).Monto += row.Monto;
  });

  const rows = [...agrupado.values()].sort((a, b) => a.Sucursal.localeCompare(b.Sucursal) || a.Cuenta.localeCompare(b.Cuenta));

  const totalGeneral = rows.reduce((acc, row) => acc + row.Monto, 0);

  return {
    totalCount,
    truncated: totalCount > MAX_ROWS,
    base,
    baseColumns: ['Sucursal', 'Comprobante', 'Cuenta', 'CuentaDescripcion', 'Monto'],
    rows,
    columns: ['Sucursal', 'Cuenta', 'CuentaDescripcion', 'Monto'],
    totalGeneral,
  };
};

module.exports = getComprasPorSucursalCuenta;
