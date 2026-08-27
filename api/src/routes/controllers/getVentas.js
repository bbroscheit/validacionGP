const { getGpPoolEcobahia, sql } = require('../../config/gpPool');

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

const getVentas = async ({ sucursal, fechaDesde, fechaHasta, soloConP = true }) => {
  const pool = await getGpPoolEcobahia();
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
  const headerRequest = bindFilters(pool.request());
  const header = await headerRequest.query(`
    SELECT TOP (${MAX_ROWS}) H.*, CT.RESPBLE AS TipodeContribuyente
    FROM SOP30200 AS H
    LEFT JOIN II_DATOS_CLIE AS RT ON LTRIM(RTRIM(RT.CodigoCliente)) = LTRIM(RTRIM(H.CUSTNMBR))
    LEFT JOIN DYNAMICS..AWLI40330 AS CT ON LTRIM(RTRIM(CT.RESP_TYPE)) = LTRIM(RTRIM(RT.codigo))
    WHERE
      (@sucursal IS NULL OR H.LOCNCODE = @sucursal)
      AND (@fechaDesde IS NULL OR H.DOCDATE >= @fechaDesde)
      AND (@fechaHasta IS NULL OR H.DOCDATE <= @fechaHasta)
      AND (@soloConP = 0 OR H.SOPNUMBE LIKE '%P%')
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
    )
  `);

  const headerColumnsBase = (header.recordset[0] ? Object.keys(header.recordset[0]) : [])
    .filter((col) => !HEADER_COLUMNAS_EXCLUIDAS.includes(col) && col !== 'TipodeContribuyente');
  // NETO se calcula, no viene directo de GP: para Factura A es SUBTOTAL (el IVA ya
  // está aparte en TAXAMNT); para Factura B hay que restarle el IVA "escondido"
  // (BCKTXAMT) porque el precio ya lo incluye.
  const subtotalIdx = headerColumnsBase.indexOf('SUBTOTAL');
  const conNeto = subtotalIdx === -1
    ? [...headerColumnsBase, 'NETO']
    : [...headerColumnsBase.slice(0, subtotalIdx + 1), 'NETO', ...headerColumnsBase.slice(subtotalIdx + 1)];
  // TipodeContribuyente se ubica junto al resto de datos del cliente.
  const phone3Idx = conNeto.indexOf('PHONE3');
  const headerColumns = phone3Idx === -1
    ? [...conNeto, 'TipodeContribuyente']
    : [...conNeto.slice(0, phone3Idx + 1), 'TipodeContribuyente', ...conNeto.slice(phone3Idx + 1)];

  const headerRows = header.recordset.map((row) => {
    const esNotaCredito = String(row.SOPNUMBE).trim().startsWith('NC');
    const signo = esNotaCredito ? -1 : 1;
    const filtered = {};
    headerColumnsBase.forEach((col) => {
      const value = row[col];
      filtered[col] = MONTO_COLUMNAS.includes(col) && typeof value === 'number' ? signo * value : value;
    });
    filtered.NETO = (filtered.SUBTOTAL ?? 0) - (filtered.BCKTXAMT ?? 0);
    filtered.TipodeContribuyente = row.TipodeContribuyente ? String(row.TipodeContribuyente).trim() : null;
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
