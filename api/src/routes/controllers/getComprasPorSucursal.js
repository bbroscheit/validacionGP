const { getGpPoolEcobahia, sql } = require('../../config/gpPool');

// Reporte - Compras por sucursal (zona de Contabilidad Analítica)
// A diferencia de Ventas, las compras (PM10000/PM20000/PM30200) no tienen un campo de
// sucursal en el comprobante - la única forma de saber la sucursal es la dimensión ZONA
// de Contabilidad Analítica (AATransactions), que solo vive en el asiento posteado
// (GL20000). Se usa el mismo grupo SOURCDOC = PMTRX/PMVVR que getGastos.js clasifica
// como "compras" (ya excluye recibos/pagos, que van por otro SOURCDOC).
//
// OJO: el código de zona cambió durante julio/2026 (ej. "BAHIA BLANCA" pasó a ser "001")
// y además la descripción no siempre respeta mayúsculas ("Bahia Blanca" vs "BAHIA
// BLANCA") - confirmado contra PRD08. Por eso se agrupa por la descripción normalizada
// (UPPER+trim), no por el código crudo. Se guarda igual el código original en el detalle
// por si hace falta rastrear un asiento puntual.
//
// Igual que en Gastos: GL20000.VOIDED no sirve (siempre da 0), así que se cruza contra
// PM30200/PM20000.VOIDED=1 por DOCNUMBR+VENDORID para sacar los comprobantes anulados.
//
// Columnas Neto/Impuestos/Total, igual que en Ventas por sucursal. Se excluyen solo dos
// cosas (confirmado contra PRD08):
//   - Las cuentas que funcionan como contrapartida de pago (no una compra en sí):
//     211101-01-000 "AV.-PROVEEDORES VARIOS" (la contrapartida de casi todas las
//     compras) y 223202-01-000 "Visa Frances a Pagar" (mismo caso puntual ya detectado
//     en Gastos - contrapartida de las compras con tarjeta, no un movimiento real). NO
//     se excluye por categoría (ACCATNUM 24): esa categoría también incluye cuentas de
//     préstamos (BBVA, Credicop) que sí son movimientos reales y deben quedar.
//   - Las cuentas de impuestos (ACCATNUM=9: IVA Crédito Fiscal y percepciones).
// Todo lo demás (gastos, activo, préstamos) es Neto.
const MONEDA_VACIA = 'En Blanco';
const CUENTAS_CONTRAPARTIDA = ['211101-01-000', '223202-01-000'];
const ACCATNUM_IMPUESTOS = 9;
const MAX_ROWS = 100000;

const getComprasPorSucursal = async ({ fechaDesde, fechaHasta }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const pool = await getGpPoolEcobahia();

  const bindFilters = (request) => {
    request.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
    request.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
    request.input('cuentaContrapartida1', sql.VarChar(75), CUENTAS_CONTRAPARTIDA[0]);
    request.input('cuentaContrapartida2', sql.VarChar(75), CUENTAS_CONTRAPARTIDA[1]);
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
    INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
    WHERE
      LTRIM(RTRIM(G.SOURCDOC)) IN ('PMTRX', 'PMVVR')
      AND G.TRXDATE >= @fechaDesde
      AND G.TRXDATE <= @fechaHasta
      AND LTRIM(RTRIM(N.ACTNUMST)) NOT IN (@cuentaContrapartida1, @cuentaContrapartida2)
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
      AA.ZONA AS ZonaCodigo,
      LTRIM(RTRIM(G.ORDOCNUM)) AS Comprobante,
      LTRIM(RTRIM(N.ACTNUMST)) AS Cuenta,
      LTRIM(RTRIM(A.ACTDESCR)) AS CuentaDescripcion,
      A.ACCATNUM,
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
      AND LTRIM(RTRIM(N.ACTNUMST)) NOT IN (@cuentaContrapartida1, @cuentaContrapartida2)
      ${noAnuladaWhere}
    ORDER BY Sucursal ASC, G.TRXDATE ASC
  `);

  const base = detalle.recordset.map((row) => {
    const monto = (row.DEBITAMT || 0) - (row.CRDTAMNT || 0);
    const esImpuesto = row.ACCATNUM === ACCATNUM_IMPUESTOS;
    return {
      Sucursal: row.Sucursal || MONEDA_VACIA,
      ZonaCodigo: row.ZonaCodigo || MONEDA_VACIA,
      Comprobante: row.Comprobante,
      Cuenta: row.Cuenta,
      CuentaDescripcion: row.CuentaDescripcion,
      Clasificacion: esImpuesto ? 'Impuestos' : 'Neto',
      Monto: monto,
    };
  });

  const agrupado = new Map();
  base.forEach((row) => {
    if (!agrupado.has(row.Sucursal)) {
      agrupado.set(row.Sucursal, { Sucursal: row.Sucursal, comprobantes: new Set(), Neto: 0, Impuestos: 0 });
    }
    const grupo = agrupado.get(row.Sucursal);
    grupo.comprobantes.add(row.Comprobante);
    if (row.Clasificacion === 'Impuestos') grupo.Impuestos += row.Monto;
    else grupo.Neto += row.Monto;
  });

  const rows = [...agrupado.values()]
    .map(({ Sucursal, comprobantes, Neto, Impuestos }) => ({
      Sucursal,
      CantidadComprobantes: comprobantes.size,
      Neto,
      Impuestos,
      Total: Neto + Impuestos,
    }))
    .sort((a, b) => a.Sucursal.localeCompare(b.Sucursal));

  const totalComprobantes = new Set(base.map((row) => row.Comprobante)).size;
  const totalNeto = rows.reduce((acc, row) => acc + row.Neto, 0);
  const totalImpuestos = rows.reduce((acc, row) => acc + row.Impuestos, 0);
  const totalGeneral = totalNeto + totalImpuestos;

  return {
    totalCount,
    truncated: totalCount > MAX_ROWS,
    base,
    baseColumns: ['Sucursal', 'ZonaCodigo', 'Comprobante', 'Cuenta', 'CuentaDescripcion', 'Clasificacion', 'Monto'],
    rows,
    columns: ['Sucursal', 'CantidadComprobantes', 'Neto', 'Impuestos', 'Total'],
    totalComprobantes,
    totalNeto,
    totalImpuestos,
    totalGeneral,
  };
};

module.exports = getComprasPorSucursal;
