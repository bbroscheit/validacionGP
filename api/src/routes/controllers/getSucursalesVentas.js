const { getGpPoolEcobahia } = require('../../config/gpPool');

// Lista de sucursales (SOP30200.PHONE3) para poblar el selector de los reportes de
// ventas. Se filtra el valor vacío: esos comprobantes ya se muestran como "En Blanco"
// dentro de los reportes, no hace falta ofrecerlos como opción de filtro.
const getSucursalesVentas = async () => {
  const pool = await getGpPoolEcobahia();
  const result = await pool.request().query(`
    SELECT DISTINCT LTRIM(RTRIM(PHONE3)) AS Sucursal
    FROM SOP30200
    WHERE LTRIM(RTRIM(PHONE3)) <> ''
    ORDER BY Sucursal ASC
  `);
  return result.recordset.map((row) => row.Sucursal);
};

module.exports = getSucursalesVentas;
