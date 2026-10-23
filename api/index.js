require('dotenv').config();

const server = require('./src/app.js');
const { sequelize } = require('./src/bd.js');
require('./src/models/ClasificacionOverride.js');
require('./src/models/MovimientoBanco.js');
const { PORT } = process.env;

// `alter: true` porque no hay herramienta de migraciones en este proyecto - sync() solo
// CREA tablas que no existen, no les agrega columnas nuevas a las que ya existen (lo
// necesitamos desde que MovimientoBanco sumó reciboCreado/usuarioRecibo/fechaRecibo a una
// tabla que ya tenía datos reales).
sequelize.sync({ alter: true })
  .then(() => console.log('Postgres (validaciongp) sincronizado'))
  .catch((e) => console.log('No se pudo sincronizar Postgres:', e.message));

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}, server connected`);
});
