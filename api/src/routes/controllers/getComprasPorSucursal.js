const { getGpPoolEcobahia, getGpPoolEcosistemas, getGpPoolEcoportatiles, getGpPoolBaxpa, getGpPoolCylius, getGpPoolChile, getGpPoolBasani, sql } = require('../../config/gpPool');
const { coincideSucursal } = require('../../services/autorizacion');
const { getOverridesMap } = require('../../services/clasificacionOverrides');
const { condicionNotIn } = require('../../services/sist2Ventas');

const POOLS = { ecobahia: getGpPoolEcobahia, ecosistemas: getGpPoolEcosistemas, ecoportatiles: getGpPoolEcoportatiles, baxpa: getGpPoolBaxpa, cylius: getGpPoolCylius, chile: getGpPoolChile, basani: getGpPoolBasani };

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
//
// OJO: ACCATNUM y los números de cuenta son configuración propia de cada compañía GP -
// NO son códigos universales. Confirmado que el mismo ACCATNUM significa algo distinto
// en cada base (ej. ACCATNUM=9 es "Créditos Fiscales" en PRD08 pero "Obras en
// Construcción" en PRD02) y las cuentas de contrapartida tampoco existen igual (PRD08 usa
// 211101/223202, PRD02 usa 211110/211210). Por eso este mapeo está indexado por empresa -
// los valores de Ecosistemas se confirmaron contra el plan de cuentas real de PRD02
// (GL00100/GL00102): categoría 37 = "Créditos Fiscales", categoría 22 = "Bancos" (coincide
// con PRD08), 211110-01-000 = "PROVEEDORES", 211210-01-000 = "TARJETA CORPORATIVA VISA -
// CREDICOOP". Ecoportatiles (PRD09) confirmado contra su propio plan de cuentas: categoría
// 9 = "Créditos Fiscales" (coincide con PRD08), categoría 20 = "Bancos", 211101-01-000 =
// "AV.-PROVEEDORES VARIOS" (mismo número que PRD08) - es la ÚNICA cuenta de contrapartida
// con movimiento real en Compras (validado: sin una segunda cuenta tipo "Visa a pagar"
// como en Ecobahia, por eso acá `cuentasContrapartida` tiene un solo elemento).
// BAXPA (PRD06) tiene un plan de cuentas mucho más granular (74 categorías, sin el sufijo
// "-01-000" en los números de cuenta) - categoría 49 = "Créditos Fiscales", categoría 26 =
// "Bancos" (cuentas 100% bancarias, confirmado). Acá SÍ hay varias cuentas de contrapartida
// de pago aparte de Proveedores (211101): 3 tarjetas Visa a pagar (213224 BBVA, 213225
// Galicia, 213226 ICBC), todas dentro de una categoría "Otros Pasivos" (54) que NO se
// puede excluir entera porque también tiene cuentas legítimas mezcladas (comisiones,
// préstamos, anticipos de clientes) - por eso se listan las 4 cuentas puntuales en vez de
// excluir la categoría. Validado: excluyendo esas 4 cuentas + categoría 26 completa, el
// Neto de Compras da $522.040.151,56 e Impuestos $133.148.392,12, ambos positivos y
// razonables.
// `cuentasContrapartida` es de longitud variable (no siempre 2) - se arma un fragmento
// `NOT IN (@cuentaContrapartida0, @cuentaContrapartida1, ...)` según la cantidad real.
const MONEDA_VACIA = 'En Blanco';
const CONFIG_EMPRESA = {
  ecobahia: {
    cuentasContrapartida: ['211101-01-000', '223202-01-000'],
    accatnumImpuestos: [9],
    accatnumContrapartida: [22],
  },
  ecosistemas: {
    cuentasContrapartida: ['211110-01-000', '211210-01-000'],
    accatnumImpuestos: [37],
    accatnumContrapartida: [22],
  },
  ecoportatiles: {
    // 111110-01-000 "CAJA" (categoría 19): mismo caso que BAXPA más abajo - a veces se
    // paga la factura "en el mismo documento" con caja en vez de generar una orden de
    // pago aparte contra Proveedores. Confirmado contra PRD09: 18 comprobantes reales
    // (ej. FC A0001-00002669, FC C2000-00004715), categoría 19 100% contrapartida (sin
    // ninguna cuenta de gasto real mezclada, $486.631,52 siempre en el lado crédito).
    cuentasContrapartida: ['211101-01-000', '111110-01-000'],
    accatnumImpuestos: [9],
    accatnumContrapartida: [20],
  },
  baxpa: {
    // 111118/111130 "FONDO FIJO..." (categoría 28, "Fondo Fijo"): mismo caso que CAJA en
    // Ecoportatiles - a veces se paga con el fondo fijo de una sucursal en vez de generar
    // una orden de pago contra Proveedores. Confirmado contra PRD06: ej. FC A5423-00003246
    // (Fondo Fijo Playa) y FC A0061-00027961 (Fondo Fijo Diego Lopez) - sin excluirlas, el
    // Neto del comprobante quedaba negativo (la línea de gasto real quedaba más chica que
    // la contrapartida, que no debería contar). Categoría 28 tiene solo estas 2 cuentas,
    // 100% contrapartida (debito casi nulo, $1.119,81 de redondeos en 497 comprobantes).
    cuentasContrapartida: ['211101', '213224', '213225', '213226', '111118', '111130'],
    accatnumImpuestos: [49],
    accatnumContrapartida: [26],
  },
  // BAEBSA (Chile, PRD05): confirmado contra el asiento real de Compras (GL20000,
  // SOURCDOC PMTRX/PMVVR) de los últimos ~2.5 años. La cuenta de contrapartida principal
  // es "Proveedores Nacionales" (211110-01-000, categoría 13 "Cuentas por pagar" - 2669
  // filas, prácticamente todo crédito: $1.326M vs $37M débito). La segunda es "Tarjeta a
  // Pagar" (212110-01-000, categoría 230 "Deudas Bancarias y Financieras" - 265 filas,
  // 100% crédito, $58M) - mismo patrón que la tarjeta de Ecobahia/BAXPA. Créditos
  // Fiscales = categoría 135 ("Otros Créditos Corrientes - Créditos Fiscales", cuenta
  // única "I.V.A. Credito Fiscal 19%" 114650-01-000, 2302 filas). La categoría 100
  // ("Disponibilidades - Bancos Moneda Nacional") no tiene movimiento real de Compras (4
  // filas, montos despreciables) - se deja igual por ser la categoría semánticamente
  // correcta, el trabajo real de excluir la contrapartida de pago ya lo hacen las 2
  // cuentas puntuales de arriba.
  chile: {
    cuentasContrapartida: ['211110-01-000', '212110-01-000'],
    accatnumImpuestos: [135],
    accatnumContrapartida: [100],
  },
  // Cylius (Uruguay, PRD07): confirmado contra el asiento real de Compras (GL20000,
  // SOURCDOC PMTRX/PMVVR), todo el histórico. Contrapartida de pago = "AV-PROVEEDORES
  // VARIOS" (211101-01-000, categoría 31 "Cuentas por pagar" - 1182 filas, casi todo
  // crédito: $28.97M vs $309K débito) - no hay una segunda cuenta de tarjeta/banco con
  // movimiento real como en otras empresas. Créditos Fiscales = categoría 18 ("Otros
  // Créditos Corrientes - Créditos Fiscales", cuentas "IVA-CRED.FISCAL 22%" y
  // "IVA-CRED.FISCAL 10.5% Y9.50%", 1055 filas). La categoría 3 ("Disponibilidades -
  // Bancos Moneda Nacional") no tiene movimiento real de Compras (3 filas, $48.555) - se
  // deja igual por ser la categoría semánticamente correcta, mismo criterio que Chile. No
  // hace falta separar por moneda (ver getVentasPorSucursal.js) - DEBITAMT/CRDTAMNT de
  // GL20000 son siempre moneda funcional (UYU) por diseño de GP.
  cylius: {
    cuentasContrapartida: ['211101-01-000'],
    accatnumImpuestos: [18],
    accatnumContrapartida: [3],
  },
  // Basani (PRD01): plan de cuentas mucho más granular que las otras 6 - la contrapartida
  // de pago no se concentra en 1-2 cuentas puntuales sino en categorías GP completas,
  // todas confirmadas 100% contrapartida contra el asiento real de Compras (GL20000,
  // SOURCDOC PMTRX/PMVVR): 13 "Cuentas por pagar" (Proveedores Nacionales/del Exterior +
  // AMEX a pagar + planes de facilidades/moratorias impositivas, todas cuentas "a pagar"),
  // 230 "Deudas Bancarias y Financieras" (Visa BBVA/Santander, Tarjeta Pyme Nación,
  // Caución Pasiva, Provisión de gastos), 100 "Bancos", 102 "Caja" (incluye Mercado Pago),
  // 103 "Fondo Fijo" y 104 (Compensación Cliente/Proveedor, Valores a depositar) - mismas
  // 2 últimas que en Ventas (ver getVentasPorCategoriaContribuyente.js). También 87
  // "Deudores Nacionales", que en Compras solo aporta "Cheques rechazados Proveedor"
  // (113310, reclasifica Proveedores cuando rechazan un cheque propio - no es una compra
  // nueva). Créditos Fiscales = categoría 135 (misma cuenta que en Ventas, lado crédito
  // fiscal) + 73 y 75 (retenciones/percepciones a pagar que aparecen tanto del lado de
  // Ventas como de Compras, montos chicos pero con el mismo rol de "no es una compra").
  basani: {
    cuentasContrapartida: [],
    accatnumImpuestos: [135, 73, 75],
    // 1 "Banco Nación cuenta corriente" (+ Cert. Deuda Pcia Bs As + Facturas Negociadas,
    // ninguna con movimiento real de Compras): es otra categoría de banco aparte de la
    // 100, mismo rol de contrapartida - confirmado con un pago de préstamo real que
    // quedaba con Neto negativo sin excluirla (Prestamos Bancarios 212210, categoría 168,
    // SÍ se deja adentro a propósito, mismo criterio que BAXPA con su categoría de
    // Préstamos - acá el problema era solo el banco, no el préstamo en sí).
    accatnumContrapartida: [1, 13, 230, 100, 102, 103, 104, 87],
  },
};
const MAX_ROWS = 100000;

const getComprasPorSucursal = async ({ fechaDesde, fechaHasta, empresa = 'ecobahia', sucursalRestringida = null }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const pool = await POOLS[empresa]();
  const {
    cuentasContrapartida: CUENTAS_CONTRAPARTIDA,
    accatnumContrapartida: ACCATNUM_CONTRAPARTIDA,
    accatnumImpuestos: ACCATNUM_IMPUESTOS,
  } = CONFIG_EMPRESA[empresa];

  const bindFilters = (request) => {
    request.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
    request.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
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
  const condCuentaContrapartidaCount = condicionNotIn(countRequest, "LTRIM(RTRIM(N.ACTNUMST))", 'cuentaContrapartida', CUENTAS_CONTRAPARTIDA, sql.VarChar(75));
  const condAccatnumContrapartidaCount = condicionNotIn(countRequest, 'A.ACCATNUM', 'accatContrapartida', ACCATNUM_CONTRAPARTIDA, sql.Int);
  const count = await countRequest.query(`
    SELECT COUNT(*) AS total
    FROM GL20000 AS G
    INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
    INNER JOIN GL00100 AS A ON A.ACTINDX = G.ACTINDX
    WHERE
      LTRIM(RTRIM(G.SOURCDOC)) IN ('PMTRX', 'PMVVR')
      AND G.TRXDATE >= @fechaDesde
      AND G.TRXDATE <= @fechaHasta
      AND ${condCuentaContrapartidaCount}
      AND ${condAccatnumContrapartidaCount}
      ${noAnuladaWhere}
  `);
  const totalCount = count.recordset[0].total;

  const detalleRequest = bindFilters(pool.request());
  const condCuentaContrapartidaDetalle = condicionNotIn(detalleRequest, "LTRIM(RTRIM(N.ACTNUMST))", 'cuentaContrapartida', CUENTAS_CONTRAPARTIDA, sql.VarChar(75));
  const condAccatnumContrapartidaDetalle = condicionNotIn(detalleRequest, 'A.ACCATNUM', 'accatContrapartida', ACCATNUM_CONTRAPARTIDA, sql.Int);

  const [detalle, overridesMap] = await Promise.all([
    detalleRequest.query(`
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
        AND ${condCuentaContrapartidaDetalle}
        AND ${condAccatnumContrapartidaDetalle}
        ${noAnuladaWhere}
      ORDER BY Sucursal ASC, G.TRXDATE ASC
    `),
    getOverridesMap({ empresa, tipo: 'zona' }),
  ]);

  // Overrides manuales (clasificacionOverrides.js, tipo "zona" - separado de "sucursal"
  // que usan los reportes de Ventas, aunque comparte el mismo mecanismo): para cuando la
  // Contabilidad Analítica no tiene la dimensión ZONA cargada en un asiento puntual.
  const base = detalle.recordset.map((row) => {
    const monto = (row.DEBITAMT || 0) - (row.CRDTAMNT || 0);
    const esImpuesto = ACCATNUM_IMPUESTOS.includes(row.ACCATNUM);
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
