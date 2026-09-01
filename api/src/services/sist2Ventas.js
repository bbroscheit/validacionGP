// Reglas de ventas específicas de "sist2" compartidas entre getVentas.js,
// getVentasPorSucursal.js, getVentasPorSucursalCuenta.js, getAsientoVentas.js y
// getSucursalesVentas.js - centralizadas acá para no duplicar la misma lógica 5 veces.
//
// Sucursal: LOCNCODE no sirve en sist2 (siempre "PRINCIPAL"). Se resuelve con 3 fuentes,
// en este orden de prioridad (confirmado contra PRD08 de sist2, jun-ago/2026 - las 3
// juntas cubren el 100% de los comprobantes, ninguna sola alcanza):
//   1) H.PHONE3 en SOP30200 (paralelo al método que ya usa Ecobahia para sus reportes de
//      sucursal, pero ahí casi siempre viene vacío en sist2 - solo resuelve una parte).
//   2) H.DOCID en SOP30200: para los comprobantes con la nomenclatura nueva (post
//      03/07/2026) trae directamente el nombre de la ciudad (BAHIABLANCA, TANDIL, etc.).
//      Para los que siguen con el formato viejo ("FV A0040", "FV B0040", "NC A0040") NO
//      sirve - ahí DOCID es tipo+letra+PDV, no una sucursal.
//   3) RM00101.USERDEF2 (campo "Def. de usuario 2" de la ficha del cliente): cubre lo que
//      queda sin resolver por las dos anteriores.
// PHONE3 y USERDEF2 traen el nombre con espacios ("BAHIA BLANCA"), DOCID sin espacios
// ("BAHIABLANCA") - de ahí los dos mapeos separados. USERDEF2 tiene además un typo real
// en la data ("Mar de Plata" en vez de "Mar del Plata"), contemplado en el mapeo.
const SIST2_DOCID_SUCURSAL = {
  BAHIABLANCA: 'Bahía Blanca',
  CASACENTRAL: 'Casa Central',
  TANDIL: 'Tandil',
  MARDELPLATA: 'Mar del Plata',
  LAPAMPA: 'La Pampa',
  PUERTOMADRYN: 'Puerto Madryn',
};

const SIST2_TEXTO_SUCURSAL = {
  'BAHIA BLANCA': 'Bahía Blanca',
  'CASA CENTRAL': 'Casa Central',
  TANDIL: 'Tandil',
  'MAR DEL PLATA': 'Mar del Plata',
  'MAR DE PLATA': 'Mar del Plata',
  'LA PAMPA': 'La Pampa',
  'PUERTO MADRYN': 'Puerto Madryn',
};

const resolverSucursalSist2 = ({ phone3, docid, clienteUserdef2 }) => (
  SIST2_TEXTO_SUCURSAL[String(phone3 ?? '').trim().toUpperCase()]
  ?? SIST2_DOCID_SUCURSAL[String(docid ?? '').trim()]
  ?? SIST2_TEXTO_SUCURSAL[String(clienteUserdef2 ?? '').trim().toUpperCase()]
  ?? null
);

// Join reusable para traer USERDEF2 (fuente 3) - se agrega LEFT JOIN a RM00101 por
// CUSTNMBR en cada query que necesite resolver sucursal para sist2.
const CLIENTE_SUCURSAL_JOIN_SIST2 = 'LEFT JOIN RM00101 AS CU ON CU.CUSTNMBR = H.CUSTNMBR';
const CLIENTE_SUCURSAL_SELECT_SIST2 = ', CU.USERDEF2 AS ClienteSucursal';

// "Es nota de crédito" en sist2: desde el 03/07/2026 el número de comprobante ya no dice
// nada (perdió el prefijo NC). H.SOPTYPE es el campo nativo que GP usa para toda su
// contabilización - en sist2 solo aparecen los valores 3 (Factura, incluye Notas de
// Débito) y 4 (Devolución/Nota de Crédito). Confirmado más confiable que la tabla custom
// AWLI_DOCUMENTOS.DOCTYPEDESC (tiene errores de carga puntuales).
const esNotaCreditoSist2 = (soptype) => soptype === 4;

module.exports = {
  resolverSucursalSist2,
  CLIENTE_SUCURSAL_JOIN_SIST2,
  CLIENTE_SUCURSAL_SELECT_SIST2,
  esNotaCreditoSist2,
};
