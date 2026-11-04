const { getGpPoolEcobahia, getGpPoolEcosistemas, getGpPoolEcoportatiles, getGpPoolBaxpa, getGpPoolCylius, getGpPoolChile, sql } = require('../../config/gpPool');

const POOLS = { ecobahia: getGpPoolEcobahia, ecosistemas: getGpPoolEcosistemas, ecoportatiles: getGpPoolEcoportatiles, baxpa: getGpPoolBaxpa, cylius: getGpPoolCylius, chile: getGpPoolChile };

// Búsqueda de clientes (los 4 emprendimientos) para el selector de Cuenta Corriente de
// Cliente - mismo patrón que getClientesSist2.js. Busca por código o por nombre.
const getClientesVentas = async ({ q, empresa = 'ecobahia' }) => {
  if (!q || q.trim().length < 2) return [];

  const getPool = POOLS[empresa];
  if (!getPool) throw new Error(`Empresa desconocida: "${empresa}"`);
  const pool = await getPool();
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
