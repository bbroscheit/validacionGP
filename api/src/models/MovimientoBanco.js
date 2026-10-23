const { DataTypes } = require('sequelize');
const { sequelize } = require('../bd.js');

// Movimientos de "Bancos Cobranzas" (Credicoop/Francés/Provincia/Chubut), persistidos al
// subir el excel de cada banco - antes esto se procesaba en memoria y se perdía apenas se
// descargaba el excel (ver services/movimientosBanco.js). `claveFila` es la clave natural
// de la fila (hash de banco+fecha+concepto+importe+observaciones): permite re-subir el
// mismo excel sin duplicar (upsert) y detectar, dentro de un mismo excel, filas que
// quedan indistinguibles entre sí (ver detectarConflictos en el servicio).
//
// `custnmbrManual`/`usuarioManual`/`fechaManual` son lo que el usuario escribe a mano
// cuando GP no pudo identificar el cliente solo (estadoMatch 'no_encontrado'/'varios') -
// un re-upload nunca los pisa, solo refresca los campos calculados
// (estadoMatch/custnmbrCalculado/candidatosAmbiguos/estadoBanco).
//
// `reciboCreado`/`usuarioRecibo`/`fechaRecibo`: el usuario carga, línea por línea, un
// recibo en GP por cada movimiento bancario identificado - esto marca cuáles ya tienen su
// recibo creado y cuáles todavía no, para no tener que recordarlo a mano. Mismo criterio
// que custnmbrManual: un re-upload no lo toca.
const MovimientoBanco = sequelize.define('MovimientoBanco', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  banco: { type: DataTypes.STRING(20), allowNull: false },
  fecha: { type: DataTypes.DATEONLY, allowNull: false },
  concepto: { type: DataTypes.STRING(500), allowNull: false },
  importe: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  observaciones: { type: DataTypes.STRING(500), allowNull: true },
  estadoBanco: { type: DataTypes.STRING(50), allowNull: true },
  estadoMatch: { type: DataTypes.STRING(20), allowNull: false }, // 'identificado' | 'no_encontrado' | 'varios'
  custnmbrCalculado: { type: DataTypes.STRING(20), allowNull: true },
  candidatosAmbiguos: { type: DataTypes.STRING(500), allowNull: true },
  custnmbrManual: { type: DataTypes.STRING(20), allowNull: true },
  usuarioManual: { type: DataTypes.STRING(150), allowNull: true },
  fechaManual: { type: DataTypes.DATE, allowNull: true },
  reciboCreado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  usuarioRecibo: { type: DataTypes.STRING(150), allowNull: true },
  fechaRecibo: { type: DataTypes.DATE, allowNull: true },
  claveFila: { type: DataTypes.STRING(32), allowNull: false },
}, {
  tableName: 'movimientos_banco',
  indexes: [
    { unique: true, fields: ['claveFila'] },
    { fields: ['banco', 'fecha'] },
  ],
});

module.exports = MovimientoBanco;
