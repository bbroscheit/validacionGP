const { getGpPoolSist2, sql } = require('../../config/gpPool');

// Búsqueda de clientes (sist2) para el selector de Cuenta Corriente. Busca por código
// o por nombre - lo que sea más rápido de recordar para quien lo usa.
const getClientesSist2 = async ({ q }) => {
  if (!q || q.trim().length < 2) return [];

  const pool = await getGpPoolSist2();
  const request = pool.request();
  request.input('q', sql.VarChar(100), `%${q.trim()}%`);
  const result = await request.query(`
    SELECT TOP 30 LTRIM(RTRIM(CUSTNMBR)) AS CUSTNMBR, LTRIM(RTRIM(CUSTNAME)) AS CUSTNAME
    FROM RM00101
    WHERE LTRIM(RTRIM(CUSTNMBR)) LIKE @q OR LTRIM(RTRIM(CUSTNAME)) LIKE @q
    ORDER BY CUSTNAME ASC
  `);
  return result.recordset;
};

module.exports = getClientesSist2;
