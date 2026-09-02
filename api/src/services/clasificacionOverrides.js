const ClasificacionOverride = require('../models/ClasificacionOverride.js');

// Trae los overrides de un tipo ("sucursal" | "provincia") y empresa como un Map
// Comprobante -> valor, para poder pisar el dato calculado de GP en O(1) por fila al
// armar cada reporte.
const getOverridesMap = async ({ empresa, tipo }) => {
  const filas = await ClasificacionOverride.findAll({
    where: { empresa, tipo },
    attributes: ['comprobante', 'valor'],
    raw: true,
  });
  return new Map(filas.map((f) => [f.comprobante, f.valor]));
};

const upsertOverride = async ({ empresa, tipo, comprobante, valor, valorOriginal, usuario }) => {
  const [fila] = await ClasificacionOverride.upsert(
    { empresa, tipo, comprobante, valor, valorOriginal, usuario },
    { conflictFields: ['empresa', 'tipo', 'comprobante'], returning: true }
  );
  return fila;
};

const deleteOverride = async ({ empresa, tipo, comprobante }) => {
  const cantidad = await ClasificacionOverride.destroy({ where: { empresa, tipo, comprobante } });
  return cantidad > 0;
};

module.exports = { getOverridesMap, upsertOverride, deleteOverride };
