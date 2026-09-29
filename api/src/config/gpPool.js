const sql = require('mssql');
const { gpConfigEcobahia, gpConfigEcosistemas, gpConfigEcoportatiles, gpConfigBaxpa, gpConfigSist2 } = require('./gpConfig');

let poolPromiseEcobahia;
let poolPromiseEcosistemas;
let poolPromiseEcoportatiles;
let poolPromiseBaxpa;
let poolPromiseSist2;

// Pool compartido: mssql ya maneja el pooling de conexiones internamente,
// por eso conviene abrir el pool una sola vez y reusarlo entre requests
// en lugar de conectar/cerrar en cada consulta.
function getGpPoolEcobahia() {
  if (!poolPromiseEcobahia) {
    poolPromiseEcobahia = new sql.ConnectionPool(gpConfigEcobahia).connect();
    poolPromiseEcobahia.catch(() => {
      // Si falla la conexión (ej. VPN caída), no dejamos la promesa rechazada
      // cacheada para siempre: la próxima request vuelve a intentar conectar.
      poolPromiseEcobahia = null;
    });
  }
  return poolPromiseEcobahia;
}

// Ecosistemas Patagónicos (PRD02) - mismo servidor que Ecobahia, pool propio porque es
// una base de datos distinta (mssql pool-ea por config, no por servidor).
function getGpPoolEcosistemas() {
  if (!poolPromiseEcosistemas) {
    poolPromiseEcosistemas = new sql.ConnectionPool(gpConfigEcosistemas).connect();
    poolPromiseEcosistemas.catch(() => {
      poolPromiseEcosistemas = null;
    });
  }
  return poolPromiseEcosistemas;
}

// Ecoportatiles (PRD09) - mismo servidor que Ecobahia, pool propio.
function getGpPoolEcoportatiles() {
  if (!poolPromiseEcoportatiles) {
    poolPromiseEcoportatiles = new sql.ConnectionPool(gpConfigEcoportatiles).connect();
    poolPromiseEcoportatiles.catch(() => {
      poolPromiseEcoportatiles = null;
    });
  }
  return poolPromiseEcoportatiles;
}

// BAXPA (PRD06) - mismo servidor que Ecobahia, pool propio.
function getGpPoolBaxpa() {
  if (!poolPromiseBaxpa) {
    poolPromiseBaxpa = new sql.ConnectionPool(gpConfigBaxpa).connect();
    poolPromiseBaxpa.catch(() => {
      poolPromiseBaxpa = null;
    });
  }
  return poolPromiseBaxpa;
}

// Segundo servidor GP ("sist2", 172.19.31.47) - mismo patrón que Ecobahia, pool propio
// porque son dos SQL Server físicamente distintos.
function getGpPoolSist2() {
  if (!poolPromiseSist2) {
    poolPromiseSist2 = new sql.ConnectionPool(gpConfigSist2).connect();
    poolPromiseSist2.catch(() => {
      poolPromiseSist2 = null;
    });
  }
  return poolPromiseSist2;
}

module.exports = { getGpPoolEcobahia, getGpPoolEcosistemas, getGpPoolEcoportatiles, getGpPoolBaxpa, getGpPoolSist2, sql };
