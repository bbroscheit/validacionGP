require('dotenv').config();

const {
  GP_USER, GP_PASSWORD, GP_SERVER, GP_DATABASE_ECOBAHIA, GP_DATABASE_ECOSISTEMAS,
  GP_DATABASE_ECOPORTATILES, GP_DATABASE_BAXPA, GP_DATABASE_CYLIUS, GP_DATABASE_CHILE,
  GP_DATABASE_BASANI,
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

// Ecoportatiles: tercer emprendimiento, mismo servidor y credenciales que Ecobahia
// (confirmado contra PRD09 directo - mismo esquema de tablas), solo cambia la base.
const gpConfigEcoportatiles = {
  ...gpConfigEcobahia,
  database: GP_DATABASE_ECOPORTATILES,
};

// BAXPA: cuarto emprendimiento, mismo servidor y credenciales que Ecobahia (confirmado
// contra PRD06 directo - mismo esquema de tablas), solo cambia la base.
const gpConfigBaxpa = {
  ...gpConfigEcobahia,
  database: GP_DATABASE_BAXPA,
};

// Cylius (Uruguay, PRD07): quinto emprendimiento, mismo servidor y credenciales que
// Ecobahia (confirmado contra PRD07 directo - mismo esquema de tablas: RM20101, PM20000+
// PM30200, SOP30200), solo cambia la base. A diferencia de los otros 4 (solo ARS), Cylius
// factura en UYU y USD sin tabla de tipo de cambio - los reportes separan los totales por
// moneda en vez de sumarlos juntos (ver comentarios en cada controller).
const gpConfigCylius = {
  ...gpConfigEcobahia,
  database: GP_DATABASE_CYLIUS,
};

// BAEBSA (Chile, PRD05): sexto emprendimiento, mismo servidor y credenciales que Ecobahia
// (confirmado contra PRD05 directo - mismo esquema de tablas), solo cambia la base. A
// diferencia de Cylius, opera en una sola moneda (CLP) - no necesita separar totales por
// moneda. Sin sucursales restringidas por ahora (acceso completo para todos, a pedido del
// usuario), aunque Compras sí tiene datos reales de zona (Santiago/Coquimbo) en
// Contabilidad Analítica - a diferencia de Ventas, que no tiene PHONE3 cargado (siempre
// en blanco, confirmado contra PRD05).
const gpConfigChile = {
  ...gpConfigEcobahia,
  database: GP_DATABASE_CHILE,
};

// Basani (PRD01): séptimo emprendimiento, mismo servidor y credenciales que Ecobahia -
// confirmado mismo esquema de tablas, pero con MUCHO más volumen que los otros 6 (ej.
// 956K filas en SOP30200 contra ~10-50K de los demás, 1,48M en RM20101) - varias consultas
// que andan bien en los otros emprendimientos tardan más de los 15s default de mssql acá
// (confirmado con getVentasPorCategoriaContribuyente/getVentasPorSucursal en paralelo).
// Se sube requestTimeout a 60s solo para este pool.
const gpConfigBasani = {
  ...gpConfigEcobahia,
  database: GP_DATABASE_BASANI,
  requestTimeout: 60000,
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

module.exports = { gpConfigEcobahia, gpConfigEcosistemas, gpConfigEcoportatiles, gpConfigBaxpa, gpConfigCylius, gpConfigChile, gpConfigBasani, gpConfigSist2 };
