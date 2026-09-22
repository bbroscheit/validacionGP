const { getGpPoolEcobahia, getGpPoolEcosistemas, sql } = require('../../config/gpPool');
const { coincideSucursal } = require('../../services/autorizacion');
const { getOverridesMap } = require('../../services/clasificacionOverrides');

const POOLS = { ecobahia: getGpPoolEcobahia, ecosistemas: getGpPoolEcosistemas };

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
//
// Igual que en Compras por sucursal: el join de AADetalle es por
// JRNENTRY+ACTINDX+SEQNUMBR (no solo JRNENTRY+ACTINDX) y agrupado también por "Id. de
// asignación de contabilidad analítica", para no colapsar una línea prorrateada entre
// varias zonas en una sola (ver el comentario largo en getComprasPorSucursal.js).
const MONEDA_VACIA = 'En Blanco';
const MAX_ROWS = 100000;

const getComprasPorSucursalCuenta = async ({ fechaDesde, fechaHasta, empresa = 'ecobahia', sucursalRestringida = null }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const pool = await POOLS[empresa]();

  const bindFilters = (request) => {
    request.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
    request.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
    return request;
  };

  // Se excluyen también los comprobantes VOIDED y, a pedido del usuario (mismo criterio
  // que Libro IVA Digital / Compras por sucursal), los DOCTYPE 3 (Cargo misceláneo), 4
  // (Devolución) y 6 (Pago) - son ajustes internos o pagos, no compras reales.
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
  const totalCount = count.recordset[0].total;

  const [detalle, overridesMap] = await Promise.all([
    bindFilters(pool.request()).query(`
      WITH AADetalle AS (
        SELECT
          A.[Entrada de diario] AS JRNENTRY,
          A.[Índice de cuenta] AS ACTINDX,
          A.[Número de secuencia] AS SEQNUMBR,
          A.[Id. de asignación de contabilidad analítica] AS ASIGNID,
          MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'ZONA'
              THEN NULLIF(LTRIM(RTRIM(A.[Cód. de dimensión de trans.])), '') END) AS ZONA,
          MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'ZONA'
              THEN NULLIF(LTRIM(RTRIM(A.[Descripción del código de dimensión de transacción])), '') END) AS ZONA_DESC,
          MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'ZONA' THEN A.[Monto débito] END) AS AA_DEBITAMT,
          MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'ZONA' THEN A.[Monto crédito] END) AS AA_CRDTAMNT
        FROM dbo.AATransactions A
        GROUP BY A.[Entrada de diario], A.[Índice de cuenta], A.[Número de secuencia], A.[Id. de asignación de contabilidad analítica]
      )
      SELECT TOP (${MAX_ROWS})
        NULLIF(UPPER(LTRIM(RTRIM(AA.ZONA_DESC))), '') AS Sucursal,
        LTRIM(RTRIM(G.ORDOCNUM)) AS Comprobante,
        LTRIM(RTRIM(N.ACTNUMST)) AS Cuenta,
        LTRIM(RTRIM(A.ACTDESCR)) AS CuentaDescripcion,
        COALESCE(AA.AA_DEBITAMT, G.DEBITAMT) AS DEBITAMT,
        COALESCE(AA.AA_CRDTAMNT, G.CRDTAMNT) AS CRDTAMNT
      FROM GL20000 AS G
      INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
      INNER JOIN GL00100 AS A ON A.ACTINDX = G.ACTINDX
      LEFT JOIN AADetalle AS AA ON AA.JRNENTRY = G.JRNENTRY AND AA.ACTINDX = G.ACTINDX AND AA.SEQNUMBR = G.SEQNUMBR
      WHERE
        LTRIM(RTRIM(G.SOURCDOC)) IN ('PMTRX', 'PMVVR')
        AND G.TRXDATE >= @fechaDesde
        AND G.TRXDATE <= @fechaHasta
        ${noAnuladaWhere}
      ORDER BY Sucursal ASC, Cuenta ASC
    `),
    getOverridesMap({ empresa, tipo: 'zona' }),
  ]);

  // Mismos overrides manuales que usa "Compras por sucursal" (tipo "zona") - así un
  // comprobante corregido a mano ahí no vuelve a quedar "En Blanco" acá.
  const base = detalle.recordset.map((row) => {
    const override = overridesMap.get(row.Comprobante);
    return {
      Sucursal: override || row.Sucursal || MONEDA_VACIA,
      Comprobante: row.Comprobante,
      Cuenta: row.Cuenta,
      CuentaDescripcion: row.CuentaDescripcion,
      Monto: (row.DEBITAMT || 0) - (row.CRDTAMNT || 0),
    };
  });

  const baseVisible = sucursalRestringida
    ? base.filter((row) => coincideSucursal(row.Sucursal, sucursalRestringida))
    : base;

  const agrupado = new Map();
  baseVisible.forEach((row) => {
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
    base: baseVisible,
    baseColumns: ['Sucursal', 'Comprobante', 'Cuenta', 'CuentaDescripcion', 'Monto'],
    rows,
    columns: ['Sucursal', 'Cuenta', 'CuentaDescripcion', 'Monto'],
    totalGeneral,
  };
};

module.exports = getComprasPorSucursalCuenta;
