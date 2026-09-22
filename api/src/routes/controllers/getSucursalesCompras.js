const { getGpPoolEcobahia, getGpPoolEcosistemas } = require('../../config/gpPool');

const POOLS = { ecobahia: getGpPoolEcobahia, ecosistemas: getGpPoolEcosistemas };

// Lista de sucursales (zona de Contabilidad Analítica, descripción normalizada) para
// poblar el selector de los reportes de compras - mismo criterio que
// getComprasPorSucursal.js: se agrupa por descripción en mayúsculas porque el código de
// zona cambió durante julio/2026 y la escritura de la descripción tampoco es 100% estable.
const getSucursalesCompras = async ({ empresa = 'ecobahia' } = {}) => {
  const pool = await POOLS[empresa]();
  const result = await pool.request().query(`
    WITH AADetalle AS (
      SELECT
        A.[Entrada de diario] AS JRNENTRY,
        A.[Índice de cuenta] AS ACTINDX,
        A.[Número de secuencia] AS SEQNUMBR,
        MAX(CASE WHEN LTRIM(RTRIM(A.[Dimensión de trans.])) = 'ZONA'
            THEN NULLIF(LTRIM(RTRIM(A.[Descripción del código de dimensión de transacción])), '') END) AS ZONA_DESC
      FROM dbo.AATransactions A
      GROUP BY A.[Entrada de diario], A.[Índice de cuenta], A.[Número de secuencia]
    )
    SELECT DISTINCT UPPER(LTRIM(RTRIM(AA.ZONA_DESC))) AS Sucursal
    FROM GL20000 AS G
    INNER JOIN AADetalle AS AA ON AA.JRNENTRY = G.JRNENTRY AND AA.ACTINDX = G.ACTINDX AND AA.SEQNUMBR = G.SEQNUMBR
    WHERE LTRIM(RTRIM(G.SOURCDOC)) IN ('PMTRX', 'PMVVR')
      AND LTRIM(RTRIM(AA.ZONA_DESC)) <> ''
    ORDER BY Sucursal ASC
  `);
  return result.recordset.map((row) => row.Sucursal);
};

module.exports = getSucursalesCompras;
