const { DataTypes } = require('sequelize');
const { sequelize } = require('../bd.js');

// Correcciones manuales de Sucursal/Provincia por comprobante, cuando el dato que trae
// GP (PHONE3/STATE en Ecobahia, o las 3 fuentes de sist2Ventas.js) viene en blanco o
// mal cargado (ej. "SANTA ROSA" en la columna STATE, que es una ciudad, no una
// provincia). El override pisa el valor calculado en cada búsqueda - así persiste entre
// consultas en vez de perderse cada vez que se vuelve a generar el reporte.
const ClasificacionOverride = sequelize.define('ClasificacionOverride', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  empresa: { type: DataTypes.STRING(20), allowNull: false },
  tipo: { type: DataTypes.STRING(20), allowNull: false }, // 'sucursal' | 'provincia'
  comprobante: { type: DataTypes.STRING(50), allowNull: false },
  valor: { type: DataTypes.STRING(100), allowNull: false },
  valorOriginal: { type: DataTypes.STRING(100), allowNull: true },
  usuario: { type: DataTypes.STRING(150), allowNull: true },
}, {
  tableName: 'clasificacion_overrides',
  indexes: [
    { unique: true, fields: ['empresa', 'tipo', 'comprobante'] },
  ],
});

module.exports = ClasificacionOverride;
