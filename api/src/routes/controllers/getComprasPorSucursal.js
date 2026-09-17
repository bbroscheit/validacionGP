const { getGpPoolEcobahia, sql } = require('../../config/gpPool');
const { coincideSucursal } = require('../../services/autorizacion');
const { getOverridesMap } = require('../../services/clasificacionOverrides');

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
// Columnas Neto/Impuestos/Total, igual que en Ventas por sucursal. Se excluyen (confirmado
// contra PRD08):
//   - Las cuentas que funcionan como contrapartida de pago (no una compra en sí). En GP,
//     al cargar una factura hay dos opciones: pagarla con una orden de pago aparte (queda
//     contra Proveedores) o pagarla "en el mismo documento" (el asiento queda directo
//     contra el medio de pago que se haya usado) - a pedido del usuario, hay que excluir
//     LA QUE SEA que se haya usado, sino el saldo termina en 0 o negativo (Gasto - Pago =
//     0, o si no hay línea de gasto propia, como en un pago de préstamo, queda negativo).
//     Confirmado: julio/2026 usó Proveedores (211101) y Visa Francés (223202); agosto/2026
//     usó cuentas bancarias (ACCATNUM 22 - Banco Credicoop, Banco Francés, etc., $63M).
//     Se excluye 211101/223202 puntuales y, por categoría, TODO ACCATNUM=22 (Bancos) - a
//     diferencia de ACCATNUM=24 (Préstamos), que NO se excluye porque ahí sí hay cuentas
//     con movimiento real (BBVA, Credicop) mezcladas con las de pura contrapartida.
//   - Las cuentas de impuestos (ACCATNUM=9: IVA Crédito Fiscal y percepciones).
// Todo lo demás (gastos, activo, préstamos) es Neto. No debería haber saldos negativos
// salvo Notas de crédito.
//
// Un mismo asiento puede prorratear una línea entre VARIAS zonas (Contabilidad Analítica
// permite distribuir por porcentaje, ej. 46% Bahía Blanca / 15% Puerto Madryn / ... - GP
// lo llama "Distribución"). El join de AADetalle tiene que ser por
// JRNENTRY+ACTINDX+SEQNUMBR (el número de línea real dentro del asiento, confirmado
// contra PRD08 que GL20000.SEQNUMBR = AATransactions."Número de secuencia") y agrupar
// además por "Id. de asignación de contabilidad analítica" (una fila de Contabilidad
// Analítica por cada % de la distribución) - agrupar solo por JRNENTRY+ACTINDX (como
// estaba antes) colapsaba TODA la distribución en una sola zona (la que ganaba el MAX()),
// mostrando el importe entero ahí en vez de prorratearlo. Validado contra PRD08: sumando
// por SEQNUMBR, el total de Contabilidad Analítica cierra exacto contra GL20000 en el
// 100% de compras 2026 (0 diferencias) - confirma que es la clave correcta.
const MONEDA_VACIA = 'En Blanco';
const CUENTAS_CONTRAPARTIDA = ['211101-01-000', '223202-01-000'];
const ACCATNUM_IMPUESTOS = 9;
const ACCATNUM_BANCOS = 22;
const MAX_ROWS = 100000;

const getComprasPorSucursal = async ({ fechaDesde, fechaHasta, sucursalRestringida = null }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const pool = await getGpPoolEcobahia();

  const bindFilters = (request) => {
    request.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
    request.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
    request.input('cuentaContrapartida1', sql.VarChar(75), CUENTAS_CONTRAPARTIDA[0]);
    request.input('cuentaContrapartida2', sql.VarChar(75), CUENTAS_CONTRAPARTIDA[1]);
    request.input('accatnumBancos', sql.Int, ACCATNUM_BANCOS);
    return request;
  };

  // Se excluyen también los comprobantes VOIDED y, a pedido del usuario (mismo criterio
  // que Libro IVA Digital), los DOCTYPE 3 (Cargo misceláneo), 4 (Devolución) y 6 (Pago) -
  // son ajustes internos o pagos, no compras reales (un Pago puede aparecer acá aunque en
  // general use SOURCDOC PMPAY, ej. "APR-00000001" cargado con PMTRX). El listado crudo
  // "Compras" (getCompras.js) queda afuera de este cambio a propósito - ahí sí se quieren
  // ver esos comprobantes.
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
    INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
    INNER JOIN GL00100 AS A ON A.ACTINDX = G.ACTINDX
    WHERE
      LTRIM(RTRIM(G.SOURCDOC)) IN ('PMTRX', 'PMVVR')
      AND G.TRXDATE >= @fechaDesde
      AND G.TRXDATE <= @fechaHasta
      AND LTRIM(RTRIM(N.ACTNUMST)) NOT IN (@cuentaContrapartida1, @cuentaContrapartida2)
      AND A.ACCATNUM <> @accatnumBancos
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
        AA.ZONA AS ZonaCodigo,
        LTRIM(RTRIM(G.ORDOCNUM)) AS Comprobante,
        G.TRXDATE,
        LTRIM(RTRIM(G.ORMSTRID)) AS Proveedor,
        LTRIM(RTRIM(V.VENDNAME)) AS NombreProveedor,
        LTRIM(RTRIM(N.ACTNUMST)) AS Cuenta,
        LTRIM(RTRIM(A.ACTDESCR)) AS CuentaDescripcion,
        A.ACCATNUM,
        COALESCE(AA.AA_DEBITAMT, G.DEBITAMT) AS DEBITAMT,
        COALESCE(AA.AA_CRDTAMNT, G.CRDTAMNT) AS CRDTAMNT
      FROM GL20000 AS G
      INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
      INNER JOIN GL00100 AS A ON A.ACTINDX = G.ACTINDX
      LEFT JOIN AADetalle AS AA ON AA.JRNENTRY = G.JRNENTRY AND AA.ACTINDX = G.ACTINDX AND AA.SEQNUMBR = G.SEQNUMBR
      LEFT JOIN PM00200 AS V ON LTRIM(RTRIM(V.VENDORID)) = LTRIM(RTRIM(G.ORMSTRID))
      WHERE
        LTRIM(RTRIM(G.SOURCDOC)) IN ('PMTRX', 'PMVVR')
        AND G.TRXDATE >= @fechaDesde
        AND G.TRXDATE <= @fechaHasta
        AND LTRIM(RTRIM(N.ACTNUMST)) NOT IN (@cuentaContrapartida1, @cuentaContrapartida2)
        AND A.ACCATNUM <> @accatnumBancos
        ${noAnuladaWhere}
      ORDER BY Sucursal ASC, G.TRXDATE ASC
    `),
    getOverridesMap({ empresa: 'ecobahia', tipo: 'zona' }),
  ]);

  // Overrides manuales (clasificacionOverrides.js, tipo "zona" - separado de "sucursal"
  // que usan los reportes de Ventas, aunque comparte el mismo mecanismo): para cuando la
  // Contabilidad Analítica no tiene la dimensión ZONA cargada en un asiento puntual.
  const base = detalle.recordset.map((row) => {
    const monto = (row.DEBITAMT || 0) - (row.CRDTAMNT || 0);
    const esImpuesto = row.ACCATNUM === ACCATNUM_IMPUESTOS;
    const override = overridesMap.get(row.Comprobante);
    return {
      Sucursal: override || row.Sucursal || MONEDA_VACIA,
      ZonaCodigo: row.ZonaCodigo || MONEDA_VACIA,
      Comprobante: row.Comprobante,
      DOCDATE: row.TRXDATE,
      Proveedor: row.Proveedor,
      NombreProveedor: row.NombreProveedor,
      Editado: !!override,
      Cuenta: row.Cuenta,
      CuentaDescripcion: row.CuentaDescripcion,
      Clasificacion: esImpuesto ? 'Impuestos' : 'Neto',
      Monto: monto,
    };
  });

  const baseVisible = sucursalRestringida
    ? base.filter((row) => coincideSucursal(row.Sucursal, sucursalRestringida))
    : base;

  const agrupado = new Map();
  baseVisible.forEach((row) => {
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

  const totalComprobantes = new Set(baseVisible.map((row) => row.Comprobante)).size;
  const totalNeto = rows.reduce((acc, row) => acc + row.Neto, 0);
  const totalImpuestos = rows.reduce((acc, row) => acc + row.Impuestos, 0);
  const totalGeneral = totalNeto + totalImpuestos;

  return {
    totalCount,
    truncated: totalCount > MAX_ROWS,
    base: baseVisible,
    baseColumns: ['Sucursal', 'ZonaCodigo', 'Comprobante', 'DOCDATE', 'Proveedor', 'NombreProveedor', 'Editado', 'Cuenta', 'CuentaDescripcion', 'Clasificacion', 'Monto'],
    rows,
    columns: ['Sucursal', 'CantidadComprobantes', 'Neto', 'Impuestos', 'Total'],
    totalComprobantes,
    totalNeto,
    totalImpuestos,
    totalGeneral,
  };
};

module.exports = getComprasPorSucursal;
