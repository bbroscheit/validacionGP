const sql = require('mssql');
const { gpConfigEcobahia } = require('./gpConfig');

let poolPromiseEcobahia;

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

module.exports = { getGpPoolEcobahia, sql };
