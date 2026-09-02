require('dotenv').config();

const server = require('./src/app.js');
const { sequelize } = require('./src/bd.js');
require('./src/models/ClasificacionOverride.js');
const { PORT } = process.env;

sequelize.sync()
  .then(() => console.log('Postgres (validaciongp) sincronizado'))
  .catch((e) => console.log('No se pudo sincronizar Postgres:', e.message));

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}, server connected`);
});
