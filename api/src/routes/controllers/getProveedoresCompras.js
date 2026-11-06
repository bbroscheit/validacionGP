const { getGpPoolEcobahia, getGpPoolEcosistemas, getGpPoolEcoportatiles, getGpPoolBaxpa, getGpPoolCylius, getGpPoolChile, getGpPoolBasani, sql } = require('../../config/gpPool');

const POOLS = { ecobahia: getGpPoolEcobahia, ecosistemas: getGpPoolEcosistemas, ecoportatiles: getGpPoolEcoportatiles, baxpa: getGpPoolBaxpa, cylius: getGpPoolCylius, chile: getGpPoolChile, basani: getGpPoolBasani };

// Búsqueda de proveedores (los 4 emprendimientos) para el selector de Cuenta Corriente de
// Proveedor - mismo patrón que getClientesSist2.js. Busca por código o por nombre.
const getProveedoresCompras = async ({ q, empresa = 'ecobahia' }) => {
  if (!q || q.trim().length < 2) return [];

  const getPool = POOLS[empresa];
  if (!getPool) throw new Error(`Empresa desconocida: "${empresa}"`);
  const pool = await getPool();
  const request = pool.request();
  request.input('q', sql.VarChar(100), `%${q.trim()}%`);
  const result = await request.query(`
    SELECT TOP 30 LTRIM(RTRIM(VENDORID)) AS VENDORID, LTRIM(RTRIM(VENDNAME)) AS VENDNAME
    FROM PM00200
    WHERE LTRIM(RTRIM(VENDORID)) LIKE @q OR LTRIM(RTRIM(VENDNAME)) LIKE @q
    ORDER BY VENDNAME ASC
  `);
  return result.recordset;
};

module.exports = getProveedoresCompras;
