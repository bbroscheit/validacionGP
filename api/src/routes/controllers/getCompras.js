const { getGpPoolEcobahia, sql } = require('../../config/gpPool');

// Endpoint 2 - Compras
// PM10000 = transacciones aún en work/sin postear.
// PM20000 = ya posteadas pero todavía no pagadas del todo (quedan "abiertas" acá hasta
// saldarse). PM30200 = historial, solo llegan acá una vez pagadas por completo.
// Confirmado contra PRD08: un comprobante que está en el libro IVA Compras pero no
// aparecía en este reporte estaba en PM20000 - si solo se mira PM10000/PM30200 se
// pierden todas las facturas posteadas que siguen pendientes de pago (114 casos, ~$154M
// solo en julio 2026). Por eso se consultan las tres.
//
// El filtro de fechas es por PSTGDATE (fecha contable), no por DOCDATE (fecha de la
// factura del proveedor) - un comprobante puede tener DOCDATE de un mes y PSTGDATE de
// otro (llegó tarde), y lo que define contra qué período/libro IVA hay que controlarlo
// es la fecha contable.
//
// DOCTYPE es el campo estándar de GP para distinguir el tipo de documento:
// 1 Factura, 2 Nota de débito, 3 Cargo varios, 4 Devolución, 5 Nota de crédito, 6 Pago/recibo.
// El pedido original era "solo facturas, que los recibos queden afuera" - al principio
// eso se armó como DOCTYPE = 1 únicamente, pero en los datos reales el prefijo "FC" del
// comprobante NO garantiza DOCTYPE = 1 (hay "FC..." que son en realidad Nota de Débito,
// DOCTYPE = 2) y además hay comprobantes de Cargos varios (DOCTYPE = 3) sin ningún prefijo
// de letras. La forma correcta de "solo recibos afuera" es excluir DOCTYPE = 6, no armar
// una lista blanca de tipos que se va descubriendo caso por caso.
const DOCTYPE_EXCLUIDO = 6;
// Devolución (4) y Nota de crédito (5) restan compras; el resto suma.
const DOCTYPES_NEGATIVOS = [4, 5];

// Comprobantes anulados (VOIDED = 1) siguen quedando en PM20000/PM30200 y aparecían en
// el reporte aunque ya no cuentan para nada - hay que sacarlos. PM10000 no tiene esta
// columna (todavía no se puede anular algo que ni se posteó).
const TABLAS_CON_VOIDED = ['PM20000', 'PM30200'];

// Un TOP fijo con ORDER BY DESC corta en silencio y se queda con los más recientes,
// arruinando cualquier suma de un período. Se trae hasta MAX_ROWS y se informa
// `truncated`/`totalCount` en vez de cortar sin avisar.
const MAX_ROWS = 100000;

// GP guarda todos los importes en positivo sin importar el tipo - se invierte el signo
// en Devolución/Nota de crédito para que sumar la columna en Excel dé el neto real.
const MONTO_COLUMNAS = ['DOCAMNT', 'PRCHAMNT', 'TAXAMNT'];

// Columnas de PM10000/PM20000/PM30200 que no aportan al control de compras. DOCTYPE se
// saca de la vista igual que LOCNCODE en Ventas - la lógica de factura/NC ya no depende
// de mostrarla, se resuelve internamente por el prefijo de DOCNUMBR.
const COLUMNAS_EXCLUIDAS = [
  'DOCTYPE', 'CURTRXAM', 'DISTKNAM', 'DISCAMNT', 'DSCDLRAM', 'BACHNUMB',
  'TRXSORCE', 'BCHSOURC', 'DISCDATE', 'PORDNMBR', 'TEN99AMNT', 'WROFAMNT',
  'DISAMTAV', 'TRXDSCRN', 'UN1099AM', 'BKTPURAM', 'BKTFRTAM', 'BKTMSCAM',
  'VOIDED', 'HOLD', 'CHEKBKID', 'DINVPDOF', 'PPSAMDED', 'PPSTAXRT',
  'PGRAMSBJ', 'GSTDSAMT',
  'Electronic', 'DocPrinted', 'TEN99TYPE', 'TEN99BOXNUMBER', 'VNDCHKNM',
  'LNGDESC', 'DEX_ROW_TS', 'DEX_ROW_ID', 'Workflow_Status',
  'POSTEDDT', 'PTDUSRID', 'MODIFDT', 'MDFUSRID', 'PYENTTYP', 'CARDNAME',
  'TRDISAMT', 'MSCCHAMT', 'FRTAMNT', 'TTLPYMTS', 'CURNCYID', 'PYMTRMID',
  'SHIPMTHD', 'PCHSCHID', 'FRTSCHID', 'MSCSCHID', 'DISAVTKN', 'CNTRLTYP',
  'NOTEINDX', 'PRCTDISC', 'RETNAGAM', 'VOIDPDATE', 'ICTRX', 'Tax_Date',
  'PRCHDATE', 'CORRCTN', 'SIMPLIFD', 'APLYWITH', 'ECTRX', 'TaxInvReqd',
  'BackoutTradeDisc', 'CBVAT', 'VADCDTRO', 'PONUMBER', 'InvoiceReceiptDate',
  'BNKRCAMT',
];

function aplicarSignoYColumnas(recordset) {
  return recordset.map((row) => {
    const esNegativo = DOCTYPES_NEGATIVOS.includes(row.DOCTYPE);
    const filtered = {};
    Object.keys(row).forEach((col) => {
      if (col === 'TipodeProveedor' || COLUMNAS_EXCLUIDAS.includes(col)) return;
      const value = row[col];
      filtered[col] = esNegativo && MONTO_COLUMNAS.includes(col) && typeof value === 'number'
        ? -value
        : value;
      // TipodeProveedor va justo después de VENDORID, no al final de la fila.
      if (col === 'VENDORID') {
        filtered.TipodeProveedor = row.TipodeProveedor ? String(row.TipodeProveedor).trim() : null;
      }
    });
    return filtered;
  });
}

const getCompras = async ({ fechaDesde, fechaHasta }) => {
  const pool = await getGpPoolEcobahia();
  const docTypeWhere = `DOCTYPE <> ${DOCTYPE_EXCLUIDO}`;

  const bindFilters = (request) => {
    request.input('fechaDesde', sql.DateTime, fechaDesde ? new Date(fechaDesde) : null);
    request.input('fechaHasta', sql.DateTime, fechaHasta ? new Date(fechaHasta) : null);
    return request;
  };

  const consultarTabla = async (tabla) => {
    const voidedWhere = TABLAS_CON_VOIDED.includes(tabla) ? 'AND ISNULL(VOIDED, 0) = 0' : '';
    const voidedWhereH = TABLAS_CON_VOIDED.includes(tabla) ? 'AND ISNULL(H.VOIDED, 0) = 0' : '';

    const countRequest = bindFilters(pool.request());
    const count = await countRequest.query(`
      SELECT COUNT(*) AS total FROM ${tabla}
      WHERE
        ${docTypeWhere}
        ${voidedWhere}
        AND (@fechaDesde IS NULL OR PSTGDATE >= @fechaDesde)
        AND (@fechaHasta IS NULL OR PSTGDATE <= @fechaHasta)
    `);

    const request = bindFilters(pool.request());
    const result = await request.query(`
      SELECT TOP (${MAX_ROWS}) H.*, CT.RESPBLE AS TipodeProveedor
      FROM ${tabla} AS H
      LEFT JOIN AWLI_PM00200 AS PT ON PT.VENDORID = H.VENDORID
      LEFT JOIN DYNAMICS..AWLI40330 AS CT ON CT.RESP_TYPE = PT.RESP_TYPE
      WHERE
        ${docTypeWhere.replace(/DOCTYPE/g, 'H.DOCTYPE')}
        ${voidedWhereH}
        AND (@fechaDesde IS NULL OR H.PSTGDATE >= @fechaDesde)
        AND (@fechaHasta IS NULL OR H.PSTGDATE <= @fechaHasta)
      ORDER BY H.PSTGDATE ASC
    `);

    const totalCount = count.recordset[0].total;
    const rows = aplicarSignoYColumnas(result.recordset);
    return {
      rows,
      columns: rows[0] ? Object.keys(rows[0]) : [],
      totalCount,
      truncated: totalCount > MAX_ROWS,
    };
  };

  const [work, open, history] = await Promise.all([
    consultarTabla('PM10000'),
    consultarTabla('PM20000'),
    consultarTabla('PM30200'),
  ]);

  return {
    work: work.rows,
    workColumns: work.columns,
    workTotalCount: work.totalCount,
    workTruncated: work.truncated,
    open: open.rows,
    openColumns: open.columns,
    openTotalCount: open.totalCount,
    openTruncated: open.truncated,
    history: history.rows,
    historyColumns: history.columns,
    historyTotalCount: history.totalCount,
    historyTruncated: history.truncated,
  };
};

module.exports = getCompras;
