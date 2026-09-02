const { upsertOverride, deleteOverride } = require('../../services/clasificacionOverrides.js');

const TIPOS_VALIDOS = ['sucursal', 'provincia'];

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
