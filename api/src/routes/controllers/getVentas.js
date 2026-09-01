const { getGpPoolEcobahia, getGpPoolSist2, sql } = require('../../config/gpPool');
const {
  resolverSucursalSist2,
  CLIENTE_SUCURSAL_JOIN_SIST2,
  CLIENTE_SUCURSAL_SELECT_SIST2,
  esNotaCreditoSist2,
} = require('../../services/sist2Ventas');

const POOLS = { ecobahia: getGpPoolEcobahia, sist2: getGpPoolSist2 };

// Endpoint 1 - Ventas
// SOP30200 = cabecera de historial de ventas (facturas/notas posteadas), campo de sucursal
// esperado: LOCNCODE. SOP30300 = líneas del mismo historial.
// Devolvemos ambas tablas "en crudo" (SELECT *) para poder confirmar visualmente
// en qué columna aparecen sucursal/provincia, en vez de asumir el nombre exacto.
//
// Regla de negocio confirmada: SOPNUMBE solo cuenta como comprobante fiscal válido si
// tiene una "P" (FVPA, FVPB, NCPA, etc. - documentos que pasaron por impuestos). Sin esa
// "P" no debería entrar al reporte. Es toggleable por si en algún momento hace falta ver
// también los que no la tienen.
//
// Límite: se trae hasta MAX_ROWS y se informa `truncated`/`totalCount` en vez de cortar en
// silencio con un TOP fijo (un TOP + ORDER BY DESC se quedaba con los N más recientes y
// descartaba todo lo anterior sin avisar - eso rompía cualquier control de totales).
//
// `empresa` ('ecobahia' | 'sist2'): mismo esquema de tablas en los dos servidores, pero
// OJO con dos supuestos de Ecobahia que en "sist2" NO valen tal cual (confirmado contra
// PRD08 de 172.19.31.47, agosto/2026):
// - `soloConP`: en sist2 casi todas las ventas del mes (357 de 362) usan un esquema de
//   comprobante propio por sucursal (ej. "BB0000026", DOCID="BAHIABLANCA") sin la "P" de
//   comprobante fiscal - solo un puñado usa el formato clásico "FV A0040-...". Con
//   soloConP=true (default) el reporte devuelve casi vacío para esta empresa; hay que
//   desmarcar el checkbox correspondiente en el frontend.
// - `sucursal` (LOCNCODE): en sist2 viene siempre "PRINCIPAL" para todo - la sucursal
//   real está en el DOCID (nombre de ciudad), no en LOCNCODE. El filtro de sucursal no
//   sirve para esta empresa tal como está.
const MAX_ROWS = 100000;

// Columnas de SOP30200 que no aportan al control de ventas (ids internos de GP,
// fechas de otros flujos, campos de descuentos/retenciones que no se usan). Se van
// agregando a pedido - no se sacan de la query, solo se ocultan del resultado.
const HEADER_COLUMNAS_EXCLUIDAS = [
  'ORIGTYPE', 'ORIGNUMB', 'GLPOSTDT', 'QUOTEDAT', 'QUOEXPDA', 'ORDRDATE',
  'BACKDATE', 'RETUDATE', 'ReqShipDate', 'FUFILDAT', 'ACTLSHIP', 'DISCDATE',
  'REPTING', 'TRXFREQU', 'TIMEREPD', 'TIMETREP', 'DYSTINCR', 'DTLSTREP',
  'DSTBTCH1', 'DSTBTCH2', 'USDOCID1', 'USDOCID2', 'DISCFRGT', 'ORDAVFRT',
  'DISCMISC', 'ORDAVMSC', 'DISAVAMT', 'ORDAVAMT', 'DISCRTND', 'ORDISRTD',
  'DISTKNAM', 'ORDISTKN', 'DSCPCTAM', 'DSCDLRAM', 'ORDDLRAT', 'DISAVTKN',
  'ORDATKN', 'PYMTRMID', 'PRCLEVEL', 'LOCNCODE', 'BCHSOURC', 'BACHNUMB',
  'CSTPONBR', 'PROSPECT', 'MSTRNUMB', 'PCKSLPNO', 'PICTICNU', 'MRKDNAMT',
  'ORMRKDAM', 'PRBTADCD', 'CNTCPRSN', 'ShipToName', 'ADDRESS1', 'ADDRESS2',
  'ADDRESS3', 'CITY', 'ZIPCODE', 'CCode', 'COUNTRY', 'PHNUMBR1', 'PHNUMBR2',
  'FAXNUMBR', 'COMAPPTO', 'COMMAMNT',
  'OCOMMAMT', 'CMMSLAMT', 'ORCOSAMT', 'NCOMAMNT', 'ORNCMAMT', 'SHIPMTHD',
  'TRDISAMT', 'ORTDISAM', 'TRDISPCT', 'ORSUBTOT', 'REMSUBTO',
  'OREMSUBT', 'EXTDCOST', 'OREXTCST', 'FRTAMNT', 'ORFRTAMT', 'MISCAMNT',
  'ORMISCAMT', 'TXENGCLD', 'TAXEXMT1', 'TAXEXMT2', 'TXSCHSRC', 'BSIVCTTL',
  'FRTSCHID', 'FRTTXAMT', 'ORFRTTAX', 'FRGTTXBL', 'MSCSCHID', 'MSCTXAMT',
  'ORMSCTAX', 'MISCTXBL', 'BKTFRTAM', 'ORBKTFRT', 'BKTMSCAM', 'ORBKTMSC',
  'OBTAXAMT', 'TXBTXAMT', 'OTAXTAMT', 'ORTAXAMT',
  'PYMTRCVD', 'ORPMTRVD', 'DEPRECVD', 'ORDEPRVD', 'CODAMNT', 'ORCODAMT',
  'ORACTAMT', 'SALSTERR', 'SLPRSNID', 'UPSZONE', 'TIMESPRT', 'PSTGSTUS',
  'VOIDSTTS', 'ALLOCABY', 'CURNCYID', 'CURRNIDX', 'RATETPID', 'EXGTBLID',
  'XCHGRATE', 'DENXRATE', 'EXCHDATE', 'TIME1', 'RTCLCMTD', 'MCTRXSTT',
  'TRXSORCE', 'SOPHDRE1', 'SOPHDRE2', 'SOPLNERR', 'SOPHDRFL', 'COMMNTID',
  'REFRENCE', 'POSTEDDT', 'PTDUSRID', 'USER2ENT', 'CREATDDT', 'MODIFDT',
  'Tax_Date', 'APLYWITH', 'WITHHAMT', 'SHPPGDOC', 'CORRCTN', 'SIMPLIFD',
  'DOCNCORR', 'SEQNCORR', 'SALEDATE', 'EXCEPTIONALDEMAND', 'Flags',
  'SOPSTATUS', 'SHIPCOMPLETE', 'DIRECTDEBIT',
  'ECTRX', 'ORDOCAMT', 'NOTEINDX', 'WorkflowApprStatCreditLm',
  'WorkflowPriorityCreditLm', 'WorkflowApprStatusQuote', 'WorkflowPriorityQuote',
  'Workflow_Status', 'ContractExchangeRateStat', 'Print_Phone_NumberGB',
  'DEX_ROW_TS', 'DEX_ROW_ID',
];

// Las notas de crédito (SOPNUMBE que arranca con "NC") restan ventas, pero GP las
// guarda con importe positivo - para que sumar la columna en Excel dé el neto real,
// se invierte el signo de estos campos cuando el comprobante es una NC.
// BCKTXAMT = IVA "desagregado" de comprobantes con precio con impuestos incluidos
// (Factura B): ahí TAXAMNT viene en 0 y el IVA real está en BCKTXAMT. En Factura A
// es al revés (TAXAMNT tiene el IVA, BCKTXAMT da 0). Por eso el neto real es
// SUBTOTAL - BCKTXAMT, no SUBTOTAL solo.
const MONTO_COLUMNAS = ['SUBTOTAL', 'TAXAMNT', 'DOCAMNT', 'ACCTAMNT', 'BCKTXAMT'];

const getVentas = async ({ sucursal, fechaDesde, fechaHasta, soloConP = true, empresa = 'ecobahia' }) => {
  const getPool = POOLS[empresa];
  if (!getPool) throw new Error(`Empresa desconocida: "${empresa}"`);
  const pool = await getPool();
  const soloConPBool = soloConP === false || soloConP === 'false' ? false : true;

  const bindFilters = (request) => {
    request.input('sucursal', sql.VarChar(10), sucursal || null);
    request.input('fechaDesde', sql.DateTime, fechaDesde ? new Date(fechaDesde) : null);
    request.input('fechaHasta', sql.DateTime, fechaHasta ? new Date(fechaHasta) : null);
    request.input('soloConP', sql.Bit, soloConPBool);
    return request;
  };

  const countRequest = bindFilters(pool.request());
  const count = await countRequest.query(`
    SELECT COUNT(*) AS total
    FROM SOP30200 AS H
    WHERE
      (@sucursal IS NULL OR H.LOCNCODE = @sucursal)
      AND (@fechaDesde IS NULL OR H.DOCDATE >= @fechaDesde)
      AND (@fechaHasta IS NULL OR H.DOCDATE <= @fechaHasta)
      AND (@soloConP = 0 OR H.SOPNUMBE LIKE '%P%')
      AND ISNULL(H.VOIDSTTS, 0) = 0 -- excluye comprobantes anulados en GP (no son ventas reales)
  `);
  const totalCount = count.recordset[0].total;

  // Tipo de contribuyente: no vive en SOP30200. Se resuelve por cliente cruzando
  // II_DATOS_CLIE.codigo (columna CodigoCliente = CUSTNMBR) contra la tabla de sistema
  // DYNAMICS..AWLI40330 que tiene la descripción (RESPBLE: RI/MO/CF/EX/Iva No Alcanzado).
  // OJO: no usar AWLI_RM00101.RESP_TYPE - ese campo viene "colapsado" a propósito
  // (queda "01/RI" tanto para RI como para Monotributistas, porque hace años la
  // facturación era igual para ambos y nunca se separó). II_DATOS_CLIE.codigo es el
  // mismo dato pero sin ese colapso (viene de New_TipodeContribuyente en el CRM), y es
  // el que realmente distingue RI de MO. La vista II_VentasProvincia ya existente en la
  // base usa el camino viejo (AWLI_RM00101) y por lo tanto tiene el mismo problema.
  //
  // OJO empresa=sist2: ese servidor TAMBIÉN tiene una vista II_DATOS_CLIE, pero apunta
  // a un linked server (CRM) propio de esa instalación que no es alcanzable desde acá -
  // la consulta se queda colgada indefinidamente (confirmado, timeout >30s en una tabla
  // de 1000 filas). Por eso para sist2 se usa el camino "colapsado" de AWLI_RM00101
  // (RI/MO se ven todos como RI) en vez de arriesgarse a colgar el endpoint entero.
  const tipoContribuyenteJoin = empresa === 'ecobahia'
    ? `LEFT JOIN II_DATOS_CLIE AS RT ON LTRIM(RTRIM(RT.CodigoCliente)) = LTRIM(RTRIM(H.CUSTNMBR))
       LEFT JOIN DYNAMICS..AWLI40330 AS CT ON LTRIM(RTRIM(CT.RESP_TYPE)) = LTRIM(RTRIM(RT.codigo))`
    : `LEFT JOIN AWLI_RM00101 AS RT ON RT.CUSTNMBR = H.CUSTNMBR
       LEFT JOIN DYNAMICS..AWLI40330 AS CT ON CT.RESP_TYPE = RT.RESP_TYPE`;

  // Tipo de venta (Factura/Nota de Crédito/Nota de Débito) - solo para empresa=sist2.
  // Hasta el 03/07/2026 se podía saber por el prefijo del comprobante (FV.../NC...),
  // pero a partir de esa fecha sist2 cambió la numeración (ver comentario de arriba,
  // "soloConP") y perdió esos prefijos - un comprobante como "BB0000026" no dice nada
  // por sí solo. El dato real está en AWLI_DOCUMENTOS.DOCTYPEDESC (la misma tabla que
  // usa el reporte nativo "IVA Ventas" de GP para su columna "Tipo de Venta"), que
  // clasifica bien incluso a los comprobantes sin prefijo (confirmado contra PRD08 de
  // sist2, agosto/2026: "FACTURA" vs "DEVOLUC" -nota de crédito/devolución- vs
  // "N.DEBIT"). Tiene filas duplicadas por comprobante (mismo dato en estado OPEN y
  // WORK) - se agrupa por DOCNUMBR con MIN() para no fanoutear el join.
  const tipoVentaJoin = empresa === 'sist2'
    ? `LEFT JOIN (
         SELECT LTRIM(RTRIM(DOCNUMBR)) AS DOCNUMBR, MIN(LTRIM(RTRIM(DOCTYPEDESC))) AS DOCTYPEDESC
         FROM AWLI_DOCUMENTOS WHERE TYPE = 2
         GROUP BY LTRIM(RTRIM(DOCNUMBR))
       ) AS TV ON TV.DOCNUMBR = LTRIM(RTRIM(H.SOPNUMBE))`
    : '';
  const tipoVentaSelect = empresa === 'sist2' ? ', TV.DOCTYPEDESC AS TipoVenta' : '';

  // Sucursal (solo sist2) - tercera fuente, cuando ni PHONE3 ni DOCID la resuelven: el
  // campo "Def. de usuario 2" de la ficha del cliente. Ver services/sist2Ventas.js para
  // el detalle de las 3 fuentes y el orden de prioridad.
  const clienteSucursalJoin = empresa === 'sist2' ? CLIENTE_SUCURSAL_JOIN_SIST2 : '';
  const clienteSucursalSelect = empresa === 'sist2' ? CLIENTE_SUCURSAL_SELECT_SIST2 : '';

  const headerRequest = bindFilters(pool.request());
  const header = await headerRequest.query(`
    SELECT TOP (${MAX_ROWS}) H.*, CT.RESPBLE AS TipodeContribuyente${tipoVentaSelect}${clienteSucursalSelect}
    FROM SOP30200 AS H
    ${tipoContribuyenteJoin}
    ${tipoVentaJoin}
    ${clienteSucursalJoin}
    WHERE
      (@sucursal IS NULL OR H.LOCNCODE = @sucursal)
      AND (@fechaDesde IS NULL OR H.DOCDATE >= @fechaDesde)
      AND (@fechaHasta IS NULL OR H.DOCDATE <= @fechaHasta)
      AND (@soloConP = 0 OR H.SOPNUMBE LIKE '%P%')
      AND ISNULL(H.VOIDSTTS, 0) = 0
    ORDER BY H.DOCDATE ASC
  `);

  const lineRequest = bindFilters(pool.request());
  const lines = await lineRequest.query(`
    SELECT TOP (${MAX_ROWS}) L.*
    FROM SOP30300 AS L
    WHERE EXISTS (
      SELECT 1 FROM SOP30200 AS H
      WHERE H.SOPTYPE = L.SOPTYPE AND H.SOPNUMBE = L.SOPNUMBE
        AND (@sucursal IS NULL OR H.LOCNCODE = @sucursal)
        AND (@fechaDesde IS NULL OR H.DOCDATE >= @fechaDesde)
        AND (@fechaHasta IS NULL OR H.DOCDATE <= @fechaHasta)
        AND (@soloConP = 0 OR H.SOPNUMBE LIKE '%P%')
        AND ISNULL(H.VOIDSTTS, 0) = 0
    )
  `);

  const headerColumnsBase = (header.recordset[0] ? Object.keys(header.recordset[0]) : [])
    .filter((col) => !HEADER_COLUMNAS_EXCLUIDAS.includes(col) && col !== 'TipodeContribuyente' && col !== 'TipoVenta' && col !== 'ClienteSucursal');
  // NETO se calcula, no viene directo de GP: para Factura A es SUBTOTAL (el IVA ya
  // está aparte en TAXAMNT); para Factura B hay que restarle el IVA "escondido"
  // (BCKTXAMT) porque el precio ya lo incluye.
  const subtotalIdx = headerColumnsBase.indexOf('SUBTOTAL');
  const conNeto = subtotalIdx === -1
    ? [...headerColumnsBase, 'NETO']
    : [...headerColumnsBase.slice(0, subtotalIdx + 1), 'NETO', ...headerColumnsBase.slice(subtotalIdx + 1)];
  // TipodeContribuyente (y TipoVenta/Sucursal, solo sist2) se ubican junto al resto de
  // datos del cliente.
  const columnasExtra = empresa === 'sist2'
    ? ['TipodeContribuyente', 'TipoVenta', 'Sucursal']
    : ['TipodeContribuyente'];
  const phone3Idx = conNeto.indexOf('PHONE3');
  const headerColumns = phone3Idx === -1
    ? [...conNeto, ...columnasExtra]
    : [...conNeto.slice(0, phone3Idx + 1), ...columnasExtra, ...conNeto.slice(phone3Idx + 1)];

  // "Es nota de crédito" define el signo de los importes (GP los guarda siempre en
  // positivo). En sist2, desde el 03/07/2026 el número de comprobante ya no dice nada
  // (perdió el prefijo NC) - probamos primero con TipoVenta (AWLI_DOCUMENTOS), pero esa
  // tabla tiene errores de carga puntuales (confirmado: 3 facturas del 03/07/2026, el
  // mismo día del cambio de numeración, quedaron mal cargadas como "DEVOLUC" ahí pese a
  // ser SOPTYPE=3/Factura en SOP30200) y terminaban saliendo negativas por error. La
  // fuente confiable es H.SOPTYPE, el campo nativo que GP usa para toda su
  // contabilización: en sist2 solo aparecen los valores 3 (Factura) y 4 (Devolución/nota
  // de crédito) - no hay Notas de Débito como SOPTYPE aparte, van con SOPTYPE=3 igual
  // que una factura (correcto: una ND también suma, no resta).
  const esNotaCredito = (row) => (empresa === 'sist2'
    ? esNotaCreditoSist2(row.SOPTYPE)
    : String(row.SOPNUMBE).trim().startsWith('NC'));

  const headerRows = header.recordset.map((row) => {
    const signo = esNotaCredito(row) ? -1 : 1;
    const filtered = {};
    headerColumnsBase.forEach((col) => {
      const value = row[col];
      filtered[col] = MONTO_COLUMNAS.includes(col) && typeof value === 'number' ? signo * value : value;
    });
    filtered.NETO = (filtered.SUBTOTAL ?? 0) - (filtered.BCKTXAMT ?? 0);
    filtered.TipodeContribuyente = row.TipodeContribuyente ? String(row.TipodeContribuyente).trim() : null;
    if (empresa === 'sist2') {
      filtered.TipoVenta = row.TipoVenta ? String(row.TipoVenta).trim() : null;
      filtered.Sucursal = resolverSucursalSist2({ phone3: row.PHONE3, docid: row.DOCID, clienteUserdef2: row.ClienteSucursal });
    }
    return filtered;
  });

  return {
    header: headerRows,
    headerColumns,
    totalCount,
    truncated: totalCount > MAX_ROWS,
    lines: lines.recordset,
    lineColumns: lines.recordset[0] ? Object.keys(lines.recordset[0]) : [],
  };
};

module.exports = getVentas;
