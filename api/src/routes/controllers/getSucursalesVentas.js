const { getGpPoolEcobahia, getGpPoolSist2 } = require('../../config/gpPool');
const { resolverSucursalSist2, CLIENTE_SUCURSAL_JOIN_SIST2, CLIENTE_SUCURSAL_SELECT_SIST2 } = require('../../services/sist2Ventas');

const POOLS = { ecobahia: getGpPoolEcobahia, sist2: getGpPoolSist2 };

// Lista de sucursales para poblar el selector de los reportes de ventas.
// Ecobahia: SOP30200.PHONE3 directo. Se filtra el valor vacío: esos comprobantes ya se
// muestran como "En Blanco" dentro de los reportes, no hace falta ofrecerlos como opción.
// sist2: PHONE3 solo no alcanza - se resuelven las 3 fuentes de services/sist2Ventas.js
// para cada combinación real de PHONE3/DOCID/ficha del cliente y se arma la lista de
// sucursales distintas en JS.
const getSucursalesVentas = async ({ empresa = 'ecobahia' } = {}) => {
  const getPool = POOLS[empresa];
  if (!getPool) throw new Error(`Empresa desconocida: "${empresa}"`);
  const pool = await getPool();

  if (empresa === 'sist2') {
    const result = await pool.request().query(`
      SELECT DISTINCT
        NULLIF(LTRIM(RTRIM(H.PHONE3)), '') AS PHONE3,
        LTRIM(RTRIM(H.DOCID)) AS DOCID${CLIENTE_SUCURSAL_SELECT_SIST2}
      FROM SOP30200 AS H
      ${CLIENTE_SUCURSAL_JOIN_SIST2}
    `);
    const sucursales = new Set();
    result.recordset.forEach((row) => {
      const s = resolverSucursalSist2({ phone3: row.PHONE3, docid: row.DOCID, clienteUserdef2: row.ClienteSucursal });
      if (s) sucursales.add(s);
    });
    return [...sucursales].sort();
  }

  const result = await pool.request().query(`
    SELECT DISTINCT LTRIM(RTRIM(PHONE3)) AS Sucursal
    FROM SOP30200
    WHERE LTRIM(RTRIM(PHONE3)) <> ''
    ORDER BY Sucursal ASC
  `);
  return result.recordset.map((row) => row.Sucursal);
};

module.exports = getSucursalesVentas;
