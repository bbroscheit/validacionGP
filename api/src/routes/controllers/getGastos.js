const { getGpPoolEcobahia, getGpPoolEcosistemas, getGpPoolSist2, sql } = require('../../config/gpPool');
const { coincideSucursal } = require('../../services/autorizacion');

const POOLS = { ecobahia: getGpPoolEcobahia, ecosistemas: getGpPoolEcosistemas, sist2: getGpPoolSist2 };

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

// `empresa` ('ecobahia' | 'sist2'): a diferencia de Ventas, este endpoint no tiene
// supuestos rotos en "sist2" - confirmado que AATransactions/PM20000/PM30200 existen
// igual y que el patrón "OPV" (órdenes de pago varias, sin proveedor cargado - la razón
// por la que esta empresa necesitaba Gastos en vez de un reporte de Compras) aparece
// igual en ORCTRNUM (ej. "OPV-00000018").

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

const getGastos = async ({ cuentaDesde, cuentaHasta, fechaDesde, fechaHasta, empresa = 'ecobahia', sucursalRestringida = null }) => {
  if (!cuentaDesde || !cuentaHasta) {
    throw new Error('cuentaDesde y cuentaHasta son requeridos (rango de cuentas de gastos)');
  }

  const getPool = POOLS[empresa];
  if (!getPool) throw new Error(`Empresa desconocida: "${empresa}"`);
  const pool = await getPool();

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
  //
  // También se excluyen, a pedido del usuario (mismo criterio que Libro IVA Digital /
  // Compras por sucursal), los DOCTYPE 3 (Cargo misceláneo), 4 (Devolución) y 6 (Pago) -
  // ajustes internos o pagos, no compras reales. Solo afecta al grupo "compras" (SOURCDOC
  // PMTRX/PMVVR) en la práctica: es el único que puede tener match de ORDOCNUM+ORMSTRID
  // contra PM30200/PM20000 - ventas/recibos/pagos/financiero no comparten esa numeración.
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
  //
  // OJO empresa=sist2: AATransactions ahí NO tiene las mismas columnas (falta
  // "Dimensión de trans." - el campo que distingue ZONA de CENTRO DE COSTO - y
  // "Descripción del código de dimensión de transacción" tampoco existe con ese
  // nombre). Es una Contabilidad Analítica configurada distinto en esa instalación de
  // GP, no se investigó todavía cómo mapea. Por eso el join de dimensión se arma para
  // cualquier empresa MENOS sist2 (no solo 'ecobahia': confirmado que Ecosistemas
  // Patagónicos -PRD02- tiene el mismo esquema de columnas que Ecobahia en
  // AATransactions, solo que está vacía - la query corre igual y da todo en blanco, sin
  // necesitar la rama especial que sí hace falta para sist2).
  // FIX (2026-09-23, a pedido del usuario - confirmado con datos reales que el problema
  // era real: 25 líneas de DG en 2026 con 6 zonas cada una, algunas de más de $3M, todas
  // apareciendo enteras en una sola zona): ahora SÍ se prorratea el importe entre zonas
  // cuando un asiento distribuye una línea por % entre varias, mismo mecanismo que ya usa
  // getComprasPorSucursal.js (ver el comentario largo ahí para el detalle de cómo se
  // confirmó la clave JRNENTRY+ACTINDX+SEQNUMBR+"Id. de asignación de contabilidad
  // analítica" - cada asignación pairea una fila ZONA + una fila CENTRO DE COSTO con el
  // mismo Monto débito/crédito). La CTE ahora agrupa también por esa asignación (antes
  // colapsaba todas las asignaciones de una línea en una sola con MAX()), así que el LEFT
  // JOIN puede devolver VARIAS filas por línea de GL20000 cuando corresponde - una por
  // zona, cada una con su parte proporcional.
  // Como este reporte trae G.* (con su propio DEBITAMT/CRDTAMNT de la línea completa) y en
  // SQL Server no se puede pisar una columna de G.* con un alias del mismo nombre sin
  // ambigüedad, el monto de cada asignación se trae con nombre temporal
  // (_AA_DEBITAMT/_AA_CRDTAMNT) y se usa para pisar DEBITAMT/CRDTAMNT en JS después de la
  // consulta (ver más abajo) - si una línea no tiene ninguna asignación de Contabilidad
  // Analítica, esas columnas quedan NULL y el monto original de G se deja como está,
  // comportamiento idéntico al de antes para ese caso.
  const aaJoin = empresa !== 'sist2'
    ? `LEFT JOIN AADetalle AS AA ON AA.JRNENTRY = G.JRNENTRY AND AA.ACTINDX = G.ACTINDX AND AA.SEQNUMBR = G.SEQNUMBR`
    : '';
  const aaSelect = empresa !== 'sist2'
    ? 'AA.ZONA, AA.ZONA_DESC, AA.ID_CENTRO, AA.CENTRO_DESC, AA.AA_DEBITAMT AS _AA_DEBITAMT, AA.AA_CRDTAMNT AS _AA_CRDTAMNT'
    : 'CAST(NULL AS VARCHAR(50)) AS ZONA, CAST(NULL AS VARCHAR(50)) AS ZONA_DESC, CAST(NULL AS VARCHAR(50)) AS ID_CENTRO, CAST(NULL AS VARCHAR(50)) AS CENTRO_DESC, CAST(NULL AS MONEY) AS _AA_DEBITAMT, CAST(NULL AS MONEY) AS _AA_CRDTAMNT';
  const aaCte = empresa !== 'sist2'
    ? `WITH AADetalle AS (
        SELECT
          A.[Entrada de diario] AS JRNENTRY,
          A.[Índice de cuenta] AS ACTINDX,
          A.[Número de secuencia] AS SEQNUMBR,
          A.[Id. de asignación de contabilidad analítica] AS ASIGNID,
          MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'ZONA'
              THEN NULLIF(LTRIM(RTRIM(A.[Cód. de dimensión de trans.])), '') END) AS ZONA,
          MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'ZONA'
              THEN NULLIF(LTRIM(RTRIM(A.[Descripción del código de dimensión de transacción])), '') END) AS ZONA_DESC,
          MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'CENTRO DE COSTO'
              THEN NULLIF(LTRIM(RTRIM(A.[Cód. de dimensión de trans.])), '') END) AS ID_CENTRO,
          MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'CENTRO DE COSTO'
              THEN NULLIF(LTRIM(RTRIM(A.[Descripción del código de dimensión de transacción])), '') END) AS CENTRO_DESC,
          MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'ZONA' THEN A.[Monto débito] END) AS AA_DEBITAMT,
          MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'ZONA' THEN A.[Monto crédito] END) AS AA_CRDTAMNT
        FROM dbo.AATransactions A
        GROUP BY A.[Entrada de diario], A.[Índice de cuenta], A.[Número de secuencia], A.[Id. de asignación de contabilidad analítica]
      )`
    : '';

  const request = bindFilters(pool.request());
  const result = await request.query(`
    ${aaCte}
    SELECT TOP (${MAX_ROWS})
      G.*,
      N.ACTNUMST AS CuentaNumero,
      A.ACTDESCR AS CuentaDescripcion,
      A.ACCATNUM AS CuentaCategoria,
      ${aaSelect}
    FROM GL20000 AS G
    INNER JOIN GL00100 AS A ON A.ACTINDX = G.ACTINDX
    INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
    ${aaJoin}
    WHERE
      N.ACTNUMST BETWEEN @cuentaDesde AND @cuentaHasta
      AND (@fechaDesde IS NULL OR G.TRXDATE >= @fechaDesde)
      AND (@fechaHasta IS NULL OR G.TRXDATE <= @fechaHasta)
      AND LTRIM(RTRIM(G.SOURCDOC)) <> @sourcdocExcluido
      ${noAnuladaWhere}
    ORDER BY G.TRXDATE ASC
  `);

  // Pisa el DEBITAMT/CRDTAMNT de la línea completa con el de la asignación de
  // Contabilidad Analítica que le corresponde a esta fila (ver comentario de _AA_DEBITAMT/
  // _AA_CRDTAMNT más arriba) - si una línea no tiene ninguna asignación, quedan NULL acá y
  // se deja el monto original de G tal cual estaba.
  result.recordset.forEach((row) => {
    if (row._AA_DEBITAMT !== null || row._AA_CRDTAMNT !== null) {
      row.DEBITAMT = row._AA_DEBITAMT || 0;
      row.CRDTAMNT = row._AA_CRDTAMNT || 0;
    }
    delete row._AA_DEBITAMT;
    delete row._AA_CRDTAMNT;
  });

  // Cuentas de activo/pasivo (y a veces alguna de gasto) no siempre tienen Zona/Centro
  // cargado en Contabilidad Analítica - se deja explícito en vez de una celda vacía.
  const CAMPOS_DIMENSION = ['ZONA', 'ZONA_DESC', 'ID_CENTRO', 'CENTRO_DESC'];
  result.recordset.forEach((row) => {
    CAMPOS_DIMENSION.forEach((campo) => {
      if (!row[campo]) row[campo] = 'En Blanco';
    });
  });

  // Acceso restringido por sucursal (services/autorizacion.js, a partir del "o" de AD):
  // se filtra por Zona (ZONA_DESC) - las filas "En Blanco" (sin dimensión cargada, o
  // empresa=sist2 que no tiene esta Contabilidad Analítica) quedan afuera para un
  // usuario restringido, no se puede confirmar que sean de su sucursal.
  const filasVisibles = sucursalRestringida
    ? result.recordset.filter((row) => coincideSucursal(row.ZONA_DESC, sucursalRestringida))
    : result.recordset;

  const grupos = { ventas: [], recibos: [], pagos: [], financiero: [], compras: [], otro: [] };
  filasVisibles.forEach((row) => {
    const sourcdoc = String(row.SOURCDOC || '').trim();
    const grupo = Object.keys(SOURCDOC_GRUPOS).find((key) => SOURCDOC_GRUPOS[key].includes(sourcdoc)) || 'otro';
    grupos[grupo].push(row);
  });

  // Dentro de los pagos (PMPAY), los que tienen "OPV" o "EGRE" en ORCTRNUM son el caso
  // puntual de pagos sin proveedor cargado ("órdenes de pago varias") que hay que poder
  // ver junto con Gastos - el resto de los pagos vive en su propia página. "EGRE" es la
  // convención propia de sist2 (Ecobahia solo usa "OPV" - confirmado 0 casos de "EGRE"
  // ahí); en sist2 "EGRE" es más común que "OPV" (60 contra 32 en jun-jul/2026) y entre
  // las dos cubren el 100% de los PMPAY sin proveedor de esa empresa.
  // Cada OPV/EGRE tiene una línea de contrapartida en una cuenta de efectivo (ACCATNUM
  // 20/21 - "FONDO FIJO"/"CAJA") que no es un gasto en sí, es solo el movimiento de
  // plata. Se queda solo con las líneas de gasto real: ACCATNUM 16 y 17 (confirmado
  // contra PRD08, las dos empresas que comparten esa base - ecobahia y sist2: 16/17 son
  // cuentas de gastos, 20/21 son efectivo - también aparecen otras categorías sueltas
  // mezcladas ahí, como 7/22/24/29/30 en Ecobahia, que tampoco son gasto).
  // OJO: ACCATNUM es configuración propia de cada compañía GP, no un código universal -
  // ecobahia/sist2 comparten base (PRD08) así que valen los mismos números, pero
  // Ecosistemas (PRD02) tiene su propio plan de cuentas: ahí "Egresos Operativos" es la
  // categoría 26 y no existe una categoría separada de "Egresos No Operativos" (a
  // diferencia de PRD08 que sí separa 16/17) - confirmado contra GL00102 de PRD02.
  const CUENTA_CATEGORIA_GASTO_POR_EMPRESA = {
    ecobahia: [16, 17],
    sist2: [16, 17],
    ecosistemas: [26],
  };
  const CUENTA_CATEGORIA_GASTO = CUENTA_CATEGORIA_GASTO_POR_EMPRESA[empresa];
  const pagosOPV = grupos.pagos.filter((row) => {
    const ref = String(row.ORCTRNUM || '');
    return (ref.includes('OPV') || ref.includes('EGRE')) && CUENTA_CATEGORIA_GASTO.includes(row.CuentaCategoria);
  });

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
