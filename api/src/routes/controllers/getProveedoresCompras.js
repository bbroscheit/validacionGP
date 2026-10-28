const { getGpPoolEcobahia, sql } = require('../../config/gpPool');

// Búsqueda de proveedores (Ecobahia) para el selector de Cuenta Corriente de Proveedor -
// mismo patrón que getClientesSist2.js. Busca por código o por nombre.
const getProveedoresCompras = async ({ q }) => {
  if (!q || q.trim().length < 2) return [];

  const pool = await getGpPoolEcobahia();
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
