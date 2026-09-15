const { upsertOverride, deleteOverride } = require('../../services/clasificacionOverrides.js');

// 'sucursal'/'provincia': reportes de Ventas (Ecobahia PHONE3/STATE, o sist2). 'zona':
// reportes de Compras (Contabilidad Analítica, AATransactions.ZONA_DESC). 'sucursal_recibo':
// Cobranzas por sucursal (sist2), separado de 'sucursal' porque ahí el comprobante es un
// número de Recibo (GL20000.ORDOCNUM con SOURCDOC CRJ/RMJ), un espacio de numeración
// GP distinto al de las facturas - evita que un recibo y una factura con el mismo número
// pisen el override del otro.
const TIPOS_VALIDOS = ['sucursal', 'provincia', 'zona', 'sucursal_recibo'];

const putOverrideClasificacion = async ({ empresa, tipo, comprobante, valor, valorOriginal, usuario }) => {
  if (!empresa || !tipo || !comprobante || !valor) {
    throw new Error('empresa, tipo, comprobante y valor son requeridos');
  }
  if (!TIPOS_VALIDOS.includes(tipo)) {
    throw new Error(`tipo inválido: "${tipo}"`);
  }
  return upsertOverride({ empresa, tipo, comprobante, valor: valor.trim(), valorOriginal, usuario });
};

const deleteOverrideClasificacion = async ({ empresa, tipo, comprobante }) => {
  if (!empresa || !tipo || !comprobante) {
    throw new Error('empresa, tipo y comprobante son requeridos');
  }
  return deleteOverride({ empresa, tipo, comprobante });
};

module.exports = { putOverrideClasificacion, deleteOverrideClasificacion };
