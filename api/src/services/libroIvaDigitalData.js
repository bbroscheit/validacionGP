const { getGpPoolEcobahia, sql } = require('../config/gpPool');

// Datos crudos para el Libro IVA Digital (ARCA, R.G. 4597) - ventas y compras.
//
// El detalle impositivo real de cada comprobante (qué parte es gravada a cada alícuota,
// qué parte es exenta/no gravada, qué percepciones tiene) no vive en SOP30200/PM30200
// sino en AWLI_IMPUESTOS: una fila por cada línea de impuesto que GP calculó al
// facturar/registrar la compra (TAXDTLID identifica el tipo: "IVADF 21%", "IVACF 0%
// NOGRAV", "IB-PV-B-A" -percepción IIBB-, etc). Confirmado contra PRD08 al armar el fix
// de "RI (Gravado)/(No Gravado)" en compras-categoria-contribuyente: es la misma fuente,
// AWLI_IMPUESTOS.TYPE = 2 para ventas (VCHRNMBR = SOPNUMBE tal cual) y TYPE = 1 para
// compras (VCHRNMBR = PM30200/PM20000.VCHRNMBR, hay que resolverlo primero por
// DOCNUMBR+VENDORID).
//
// Solo se traen comprobantes "fiscales" (SOPNUMBE/DOCNUMBR con letra A/B/C reconocible -
// para ventas además exige la "P" que ya usan el resto de los reportes, ver
// getVentas.js). Quedan afuera a propósito los comprobantes de pago (OPP-, APR-, EFEC-,
// numéricos) - no son comprobantes fiscales, son órdenes de pago/recibos internos de GP.

const TAXDTLID_VENTA_RE = /^IVADF (\d+(?:\.\d+)?)%(?: (CF|EXE|NOGRAV))?$/;
const TAXDTLID_COMPRA_RE = /^IVACF (\d+(?:\.\d+)?)%(?: (EXE|NOGRAV))?$/;
const PERCEPCION_IIBB_RE = /^IB-P[VC]-/;
const PERCEPCION_IVA_RE = /^IVA-PC-/;

function clasificarImpuestos(filas, esVenta) {
  const re = esVenta ? TAXDTLID_VENTA_RE : TAXDTLID_COMPRA_RE;
  const alicuotasPorTasa = new Map(); // tasa -> { neto, iva }
  let importeExento = 0;
  let importeNoGravado = 0;
  let percepcionIIBB = 0;
  let percepcionIVA = 0;
  let otrosTributos = 0;

  filas.forEach((f) => {
    const id = f.TAXDTLID;
    const m = id.match(re);
    if (m) {
      const tasa = Number(m[1]);
      const sufijo = m[2];
      if (tasa === 0 && sufijo === 'EXE') {
        importeExento += f.TDTTXAMT || 0;
      } else if (tasa === 0 && sufijo === 'NOGRAV') {
        importeNoGravado += f.TDTTXAMT || 0;
      } else if (tasa > 0) {
        if (!alicuotasPorTasa.has(tasa)) alicuotasPorTasa.set(tasa, { neto: 0, iva: 0 });
        const acc = alicuotasPorTasa.get(tasa);
        acc.neto += f.TDTTXAMT || 0;
        acc.iva += f.TAXAMNT || 0;
      }
      return;
    }
    if (PERCEPCION_IIBB_RE.test(id)) {
      percepcionIIBB += f.TAXAMNT || 0;
    } else if (!esVenta && PERCEPCION_IVA_RE.test(id)) {
      percepcionIVA += f.TAXAMNT || 0;
    } else {
      // SIRCREB y cualquier otro concepto no mapeado: catch-all como "otros tributos".
      otrosTributos += f.TAXAMNT || 0;
    }
  });

  const alicuotas = [...alicuotasPorTasa.entries()]
    .map(([tasa, v]) => ({ tasa, neto: v.neto, iva: v.iva }))
    .sort((a, b) => a.tasa - b.tasa);

  return { alicuotas, importeExento, importeNoGravado, percepcionIIBB, percepcionIVA, otrosTributos };
}

// DOCID/DOCNUMBR en GP vienen como "FV A0040" (ventas, header.DOCID) o
// "FC A0044-00123808" (compras, header.DOCNUMBR): {tipo 2 letras} + espacio + {letra} +
// {PDV 4 dígitos} [+ "-" + número]. Se parsea directo del string en vez de tocar la base.
function parseComprobante(str) {
  const s = str.trim();
  const tipoDoc = s.slice(0, 2);
  const letra = s[3];
  const pdv = s.slice(4, 8);
  if (!tipoDoc || !letra || !/^\d{4}$/.test(pdv)) {
    throw new Error(`No se pudo parsear el comprobante "${str}" (formato esperado "XX Y0000...")`);
  }
  return { tipoDoc, letra, pdv };
}

async function fetchVentas(fechaDesde, fechaHasta) {
  const pool = await getGpPoolEcobahia();
  const request = pool.request();
  request.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
  request.input('fechaHasta', sql.DateTime, new Date(fechaHasta));

  const header = await request.query(`
    SELECT
      LTRIM(RTRIM(H.SOPNUMBE)) AS SOPNUMBE,
      H.DOCDATE,
      LTRIM(RTRIM(H.DOCID)) AS DOCID,
      H.DOCAMNT,
      LTRIM(RTRIM(H.CUSTNMBR)) AS CUSTNMBR,
      LTRIM(RTRIM(RT.CUSTNAME)) AS CUSTNAME,
      LTRIM(RTRIM(RT.TXRGNNUM)) AS TXRGNNUM
    FROM SOP30200 AS H
    LEFT JOIN RM00101 AS RT ON RT.CUSTNMBR = H.CUSTNMBR
    WHERE
      H.DOCDATE >= @fechaDesde AND H.DOCDATE <= @fechaHasta
      AND ISNULL(H.VOIDSTTS, 0) = 0
      AND LTRIM(RTRIM(H.SOPNUMBE)) LIKE '%P%'
      AND (
        (H.SOPTYPE = 3 AND (LTRIM(RTRIM(H.DOCID)) LIKE 'FV%' OR LTRIM(RTRIM(H.DOCID)) LIKE 'ND%'))
        OR (H.SOPTYPE = 4 AND LTRIM(RTRIM(H.DOCID)) LIKE 'NC%')
      )
    ORDER BY H.DOCDATE, H.SOPNUMBE
  `);

  const impuestosRequest = pool.request();
  impuestosRequest.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
  impuestosRequest.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
  const impuestos = await impuestosRequest.query(`
    SELECT LTRIM(RTRIM(AI.VCHRNMBR)) AS VCHRNMBR, LTRIM(RTRIM(AI.TAXDTLID)) AS TAXDTLID, AI.TAXAMNT, AI.TAXDTAMT, AI.TDTTXAMT
    FROM AWLI_IMPUESTOS AS AI
    WHERE AI.TYPE = 2
      AND EXISTS (
        SELECT 1 FROM SOP30200 H
        WHERE LTRIM(RTRIM(H.SOPNUMBE)) = LTRIM(RTRIM(AI.VCHRNMBR))
          AND H.DOCDATE >= @fechaDesde AND H.DOCDATE <= @fechaHasta
          AND ISNULL(H.VOIDSTTS, 0) = 0
          AND LTRIM(RTRIM(H.SOPNUMBE)) LIKE '%P%'
      )
  `);

  const impuestosPorDoc = new Map();
  impuestos.recordset.forEach((row) => {
    if (!impuestosPorDoc.has(row.VCHRNMBR)) impuestosPorDoc.set(row.VCHRNMBR, []);
    impuestosPorDoc.get(row.VCHRNMBR).push(row);
  });

  return header.recordset.map((row) => {
    const { tipoDoc, letra, pdv } = parseComprobante(row.DOCID);
    const numero = row.SOPNUMBE.split('-').pop();
    const txrgnnum = (row.TXRGNNUM || '').trim();
    const codigoDocumento = txrgnnum.slice(-2) || '99';
    const numeroIdentificacion = txrgnnum.slice(0, -2).trim();
    const impuestosDoc = clasificarImpuestos(impuestosPorDoc.get(row.SOPNUMBE) || [], true);

    return {
      fecha: row.DOCDATE,
      tipoDoc,
      letra,
      pdv,
      numero,
      importeTotal: row.DOCAMNT || 0,
      codigoDocumento,
      numeroIdentificacion,
      nombre: (row.CUSTNAME || '').trim(),
      ...impuestosDoc,
    };
  });
}

async function fetchCompras(fechaDesde, fechaHasta) {
  const pool = await getGpPoolEcobahia();
  const request = pool.request();
  request.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
  request.input('fechaHasta', sql.DateTime, new Date(fechaHasta));

  const header = await request.query(`
    SELECT
      LTRIM(RTRIM(H.DOCNUMBR)) AS DOCNUMBR,
      LTRIM(RTRIM(H.VCHRNMBR)) AS VCHRNMBR,
      H.DOCDATE,
      H.DOCAMNT,
      LTRIM(RTRIM(H.VENDORID)) AS VENDORID,
      LTRIM(RTRIM(PT.VENDNAME)) AS VENDNAME,
      LTRIM(RTRIM(PT.TXRGNNUM)) AS TXRGNNUM
    FROM (
      SELECT DOCNUMBR, VCHRNMBR, DOCDATE, DOCAMNT, VENDORID FROM PM30200
      WHERE DOCDATE >= @fechaDesde AND DOCDATE <= @fechaHasta AND ISNULL(VOIDED, 0) = 0
      UNION ALL
      SELECT DOCNUMBR, VCHRNMBR, DOCDATE, DOCAMNT, VENDORID FROM PM20000
      WHERE DOCDATE >= @fechaDesde AND DOCDATE <= @fechaHasta AND ISNULL(VOIDED, 0) = 0
    ) AS H
    LEFT JOIN PM00200 AS PT ON LTRIM(RTRIM(PT.VENDORID)) = LTRIM(RTRIM(H.VENDORID))
    WHERE
      LEFT(LTRIM(RTRIM(H.DOCNUMBR)), 2) IN ('FC', 'NC', 'ND')
      AND LTRIM(RTRIM(H.DOCNUMBR)) LIKE '__ [ABC][0-9][0-9][0-9][0-9]-%'
    ORDER BY H.DOCDATE, H.DOCNUMBR
  `);

  const impuestosRequest = pool.request();
  impuestosRequest.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
  impuestosRequest.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
  const impuestos = await impuestosRequest.query(`
    SELECT LTRIM(RTRIM(AI.VCHRNMBR)) AS VCHRNMBR, LTRIM(RTRIM(AI.TAXDTLID)) AS TAXDTLID, AI.TAXAMNT, AI.TAXDTAMT, AI.TDTTXAMT
    FROM AWLI_IMPUESTOS AS AI
    WHERE AI.TYPE = 1
      AND EXISTS (
        SELECT 1 FROM (
          SELECT VCHRNMBR, DOCDATE FROM PM30200 WHERE ISNULL(VOIDED, 0) = 0
          UNION ALL
          SELECT VCHRNMBR, DOCDATE FROM PM20000 WHERE ISNULL(VOIDED, 0) = 0
        ) AS H
        WHERE LTRIM(RTRIM(H.VCHRNMBR)) = LTRIM(RTRIM(AI.VCHRNMBR))
          AND H.DOCDATE >= @fechaDesde AND H.DOCDATE <= @fechaHasta
      )
  `);

  const impuestosPorDoc = new Map();
  impuestos.recordset.forEach((row) => {
    if (!impuestosPorDoc.has(row.VCHRNMBR)) impuestosPorDoc.set(row.VCHRNMBR, []);
    impuestosPorDoc.get(row.VCHRNMBR).push(row);
  });

  return header.recordset.map((row) => {
    const { tipoDoc, letra, pdv } = parseComprobante(row.DOCNUMBR);
    const numero = row.DOCNUMBR.split('-').pop();
    const txrgnnum = (row.TXRGNNUM || '').trim();
    const codigoDocumento = txrgnnum.slice(-2) || '80';
    const numeroIdentificacion = txrgnnum.slice(0, -2).trim();
    const impuestosDoc = clasificarImpuestos(impuestosPorDoc.get(row.VCHRNMBR) || [], false);

    return {
      fecha: row.DOCDATE,
      tipoDoc,
      letra,
      pdv,
      numero,
      importeTotal: row.DOCAMNT || 0,
      codigoDocumento,
      numeroIdentificacion,
      nombre: (row.VENDNAME || '').trim(),
      ...impuestosDoc,
    };
  });
}

module.exports = { fetchVentas, fetchCompras };
