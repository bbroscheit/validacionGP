require('dotenv').config();

const { GP_USER, GP_PASSWORD, GP_SERVER, GP_DATABASE_ECOBAHIA } = process.env;

const gpConfigEcobahia = {
  user: GP_USER,
  password: GP_PASSWORD,
  server: GP_SERVER,
  database: GP_DATABASE_ECOBAHIA,
  options: {
    trustedConnection: true,
    encrypt: true,
    enableArithAbort: true,
    trustServerCertificate: true,
  },
};

module.exports = { gpConfigEcobahia };
