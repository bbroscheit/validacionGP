require('dotenv').config();

const {
  GP_USER, GP_PASSWORD, GP_SERVER, GP_DATABASE_ECOBAHIA, GP_DATABASE_ECOSISTEMAS,
  GP2_USER, GP2_PASSWORD, GP2_SERVER, GP2_DATABASE_SIST2,
} = process.env;

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

// Ecosistemas Patagónicos: segundo emprendimiento, mismo servidor y credenciales que
// Ecobahia (confirmado contra PRD02 directo - mismo esquema de tablas, incluida
// Contabilidad Analítica), solo cambia la base de datos.
const gpConfigEcosistemas = {
  ...gpConfigEcobahia,
  database: GP_DATABASE_ECOSISTEMAS,
};

// Servidor "sist2" (172.19.31.47, empresa "sist2 ecobahia"): encrypt debe ir en false -
// con true, mssql tira error de negociación TLS (versión de protocolo vieja de ese SQL
// Server, incompatible con el default de Node/OpenSSL). Confirmado al conectar por
// primera vez - con encrypt:true no conecta, con encrypt:false sí.
const gpConfigSist2 = {
  user: GP2_USER,
  password: GP2_PASSWORD,
  server: GP2_SERVER,
  database: GP2_DATABASE_SIST2,
  options: {
    trustedConnection: true,
    encrypt: false,
    enableArithAbort: true,
    trustServerCertificate: true,
  },
};

module.exports = { gpConfigEcobahia, gpConfigEcosistemas, gpConfigSist2 };
