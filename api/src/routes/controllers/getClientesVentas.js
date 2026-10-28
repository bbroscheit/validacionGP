const { getGpPoolEcobahia, sql } = require('../../config/gpPool');

// Búsqueda de clientes (Ecobahia) para el selector de Cuenta Corriente de Cliente -
// mismo patrón que getClientesSist2.js. Busca por código o por nombre.
const getClientesVentas = async ({ q }) => {
  if (!q || q.trim().length < 2) return [];

  const pool = await getGpPoolEcobahia();
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

module.exports = getClientesVentas;
