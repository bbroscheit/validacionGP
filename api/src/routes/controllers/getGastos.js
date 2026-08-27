const { getGpPoolEcobahia, sql } = require('../../config/gpPool');

// Endpoint 3 - Gastos (GL)
// GL20000 = detalle de movimientos posteados al mayor. GL00100 = maestro de cuentas
// (ACTINDX es la clave interna que las une). El número de cuenta como texto NO vive en
// GL00100 (ahí está partido en ACTNUMBR_1..10) sino en GL00105, que GP mantiene como
// lookup con ACTNUMST ya armado - por eso el join extra.
// Confirmado contra PRD08: las cuentas de gastos son ACCATNUM = 16 en GL00100.
//
// El campo que distingue el tipo de movimiento es SOURCDOC (no ORGNTSRC - ese queda
// en blanco justo en los asientos manuales, que es el caso que más importa separar).
// Universo real visto en PRD08: SJ, CRJ, PMTRX, PMPAY, DG, RMJ, PMVPY, PMVVR.
// PMVPY = anulación de pago histórico (REFRENCE = "Anular trans. hist.") - no es un
// pago real, se excluye del todo (ver SOURCDOC_EXCLUIDO más abajo).
const SOURCDOC_GRUPOS = {
  ventas: ['SJ'],
  recibos: ['CRJ', 'RMJ'],
  pagos: ['PMPAY'],
  financiero: ['DG'], // asientos contables manuales, sin factura de por medio
  compras: ['PMTRX', 'PMVVR'],
};
const SOURCDOC_EXCLUIDO = 'PMVPY';

// Columnas de GL20000 que no aportan al control de gastos (ids internos de GP, campos
// de multimoneda/workflow sin uso, DEX_ROW_ID). ORCTRNUM y VOIDED se ocultan de la vista
// pero se siguen usando internamente (ORCTRNUM para detectar OPV, VOIDED nunca se usó
// porque en GL20000 siempre da 0 - lo real está en PM20000/PM30200).
const COLUMNAS_EXCLUIDAS = [
  'RCTRXSEQ', 'TRXSORCE', 'ACTINDX', 'POLLDTRX', 'LASTUSER', 'LSTDTEDT',
  'USWHPSTD', 'ORGNATYP', 'QKOFSET', 'ORTRXTYP', 'ORCTRNUM', 'OrigDTASeries',
  'OrigSeqNum', 'SEQNUMBR', 'DTA_Index', 'DTA_GL_Status', 'CURNCYID',
  'CURRNIDX', 'RATETPID', 'EXGTBLID', 'XCHGRATE', 'EXCHDATE', 'TIME1',
  'RTCLCMTD', 'NOTEINDX', 'ICTRX', 'ORCOMID', 'ORIGINJE', 'ORDBTAMT',
  'ORCRDAMT', 'DOCDATE', 'PSTGNMBR', 'PPSGNMBR', 'DENXRATE', 'MCTRXSTT',
  'CorrespondingUnit', 'VOIDED', 'Back_Out_JE', 'Back_Out_JE_Year',
  'Correcting_JE', 'Correcting_JE_Year', 'Original_JE', 'Original_JE_Seq_Num',
  'Ledger_ID', 'Adjustment_Transaction', 'APPRVLDT', 'User_Defined_Text01',
  'User_Defined_Text02', 'DEX_ROW_ID',
];

// Un TOP fijo con ORDER BY DESC corta en silencio y se queda con los más recientes,
// arruinando cualquier suma de un período. Se trae hasta MAX_ROWS y se informa
// `truncated`/`totalCount` en vez de cortar sin avisar.
const MAX_ROWS = 100000;

const getGastos = async ({ cuentaDesde, cuentaHasta, fechaDesde, fechaHasta }) => {
  if (!cuentaDesde || !cuentaHasta) {
    throw new Error('cuentaDesde y cuentaHasta son requeridos (rango de cuentas de gastos)');
  }

  const pool = await getGpPoolEcobahia();

  const bindFilters = (request) => {
    request.input('cuentaDesde', sql.VarChar(75), cuentaDesde);
    request.input('cuentaHasta', sql.VarChar(75), cuentaHasta);
    request.input('fechaDesde', sql.DateTime, fechaDesde ? new Date(fechaDesde) : null);
    request.input('fechaHasta', sql.DateTime, fechaHasta ? new Date(fechaHasta) : null);
    request.input('sourcdocExcluido', sql.VarChar(10), SOURCDOC_EXCLUIDO);
    return request;
  };

  // GL20000 NO marca anulado en el asiento original (VOIDED da 0 igual, y no queda un
  // asiento de reversa vinculado) - lo único anulado de verdad es el comprobante fuente
  // en Payables (PM20000/PM30200.VOIDED = 1). Por eso hay que cruzar por número de
  // comprobante + proveedor para poder sacar las anuladas de acá también.
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
      N.ACTNUMST BETWEEN @cuentaDesde AND @cuentaHasta
      AND (@fechaDesde IS NULL OR G.TRXDATE >= @fechaDesde)
      AND (@fechaHasta IS NULL OR G.TRXDATE <= @fechaHasta)
      AND LTRIM(RTRIM(G.SOURCDOC)) <> @sourcdocExcluido
      ${noAnuladaWhere}
  `);
  const totalCount = count.recordset[0].total;

  // Zona y Centro de Costo son dimensiones de Contabilidad Analítica (AATransactions),
  // no columnas de GL20000. Cada asiento+cuenta puede tener varias filas en AATransactions
  // (una por dimensión: ZONA, CENTRO DE COSTO, etc.) - se pivotea a columnas acá.
  // LEFT JOIN a propósito: si algún asiento no tiene la dimensión cargada, se ve igual
  // con Zona/Centro en blanco en vez de desaparecer del reporte.
  const request = bindFilters(pool.request());
  const result = await request.query(`
    WITH AADetalle AS (
      SELECT
        A.[Entrada de diario] AS JRNENTRY,
        A.[Índice de cuenta] AS ACTINDX,
        MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'ZONA'
            THEN NULLIF(LTRIM(RTRIM(A.[Cód. de dimensión de trans.])), '') END) AS ZONA,
        MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'ZONA'
            THEN NULLIF(LTRIM(RTRIM(A.[Descripción del código de dimensión de transacción])), '') END) AS ZONA_DESC,
        MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'CENTRO DE COSTO'
            THEN NULLIF(LTRIM(RTRIM(A.[Cód. de dimensión de trans.])), '') END) AS ID_CENTRO,
        MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'CENTRO DE COSTO'
            THEN NULLIF(LTRIM(RTRIM(A.[Descripción del código de dimensión de transacción])), '') END) AS CENTRO_DESC
      FROM dbo.AATransactions A
      GROUP BY A.[Entrada de diario], A.[Índice de cuenta]
    )
    SELECT TOP (${MAX_ROWS})
      G.*,
      N.ACTNUMST AS CuentaNumero,
      A.ACTDESCR AS CuentaDescripcion,
      A.ACCATNUM AS CuentaCategoria,
      AA.ZONA,
      AA.ZONA_DESC,
      AA.ID_CENTRO,
      AA.CENTRO_DESC
    FROM GL20000 AS G
    INNER JOIN GL00100 AS A ON A.ACTINDX = G.ACTINDX
    INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
    LEFT JOIN AADetalle AS AA ON AA.JRNENTRY = G.JRNENTRY AND AA.ACTINDX = G.ACTINDX
    WHERE
      N.ACTNUMST BETWEEN @cuentaDesde AND @cuentaHasta
      AND (@fechaDesde IS NULL OR G.TRXDATE >= @fechaDesde)
      AND (@fechaHasta IS NULL OR G.TRXDATE <= @fechaHasta)
      AND LTRIM(RTRIM(G.SOURCDOC)) <> @sourcdocExcluido
      ${noAnuladaWhere}
    ORDER BY G.TRXDATE ASC
  `);

  // Cuentas de activo/pasivo (y a veces alguna de gasto) no siempre tienen Zona/Centro
  // cargado en Contabilidad Analítica - se deja explícito en vez de una celda vacía.
  const CAMPOS_DIMENSION = ['ZONA', 'ZONA_DESC', 'ID_CENTRO', 'CENTRO_DESC'];
  result.recordset.forEach((row) => {
    CAMPOS_DIMENSION.forEach((campo) => {
      if (!row[campo]) row[campo] = 'En Blanco';
    });
  });

  const grupos = { ventas: [], recibos: [], pagos: [], financiero: [], compras: [], otro: [] };
  result.recordset.forEach((row) => {
    const sourcdoc = String(row.SOURCDOC || '').trim();
    const grupo = Object.keys(SOURCDOC_GRUPOS).find((key) => SOURCDOC_GRUPOS[key].includes(sourcdoc)) || 'otro';
    grupos[grupo].push(row);
  });

  // Dentro de los pagos (PMPAY), los que tienen "OPV" en ORCTRNUM son el caso puntual
  // de "órdenes de pago varias" que hay que poder ver junto con Gastos - el resto de
  // los pagos vive en su propia página.
  const pagosOPV = grupos.pagos.filter((row) => String(row.ORCTRNUM || '').includes('OPV'));

  const armarRespuesta = (rows) => {
    const columns = (rows[0] ? Object.keys(rows[0]) : []).filter((col) => !COLUMNAS_EXCLUIDAS.includes(col));
    const filteredRows = rows.map((row) => {
      const filtered = {};
      columns.forEach((col) => { filtered[col] = row[col]; });
      return filtered;
    });
    return { rows: filteredRows, columns };
  };

  return {
    totalCount,
    truncated: totalCount > MAX_ROWS,
    recibos: armarRespuesta(grupos.recibos),
    pagos: armarRespuesta(grupos.pagos),
    pagosOPV: armarRespuesta(pagosOPV),
    ventas: armarRespuesta(grupos.ventas),
    financiero: armarRespuesta(grupos.financiero),
    compras: armarRespuesta(grupos.compras),
    otro: armarRespuesta(grupos.otro),
  };
};

module.exports = getGastos;
