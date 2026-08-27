const { getGpPoolEcobahia, sql } = require('../../config/gpPool');

// Endpoint 4 - OPB (órdenes de pago varias sin factura)
// Mismo GL20000/GL00100/GL00105 que Gastos (ver getGastos.js para el porqué del join
// contra GL00105 para el rango de cuentas).
//
// Todavía SIN CONFIRMAR cómo se identifica un OPB en los datos: se probó, contra PRD08
// completo de 2026, buscar "OPB" / "ORDEN" / "VARIA" en REFRENCE y DSCRIPTN y no apareció
// nada. Los SOURCDOC reales que existen son: SJ, CRJ, PMTRX, PMPAY, DG, RMJ, PMVPY, PMVVR
// (ninguno es "GLTRX"). Los movimientos con SOURCDOC = 'DG' (el único que parece asiento
// manual/general) que se revisaron son transferencias, reclasificaciones de IVA, etc. -
// no algo identificable como "orden de pago varia sin factura".
// Por eso acá NO se hardcodea ningún filtro por defecto: sourcdoc/referencia quedan
// como filtros opcionales para ir probando una vez que se sepa el criterio real
// (¿un SOURCDOC puntual? ¿un prefijo de comprobante? ¿una cuenta contable específica?).
const getOpb = async ({ cuentaDesde, cuentaHasta, fechaDesde, fechaHasta, referencia, sourcdoc }) => {
  if (!cuentaDesde || !cuentaHasta) {
    throw new Error('cuentaDesde y cuentaHasta son requeridos (rango de cuentas de gastos)');
  }

  const pool = await getGpPoolEcobahia();
  const request = pool.request();
  request.input('cuentaDesde', sql.VarChar(75), cuentaDesde);
  request.input('cuentaHasta', sql.VarChar(75), cuentaHasta);
  request.input('fechaDesde', sql.DateTime, fechaDesde ? new Date(fechaDesde) : null);
  request.input('fechaHasta', sql.DateTime, fechaHasta ? new Date(fechaHasta) : null);
  request.input('referencia', sql.VarChar(50), referencia ? `%${referencia}%` : null);
  request.input('sourcdoc', sql.VarChar(10), sourcdoc || null);

  const result = await request.query(`
    SELECT TOP 500
      G.*,
      N.ACTNUMST AS CuentaNumero,
      A.ACTDESCR AS CuentaDescripcion,
      A.ACCATNUM AS CuentaCategoria
    FROM GL20000 AS G
    INNER JOIN GL00100 AS A ON A.ACTINDX = G.ACTINDX
    INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
    WHERE
      N.ACTNUMST BETWEEN @cuentaDesde AND @cuentaHasta
      AND (@fechaDesde IS NULL OR G.TRXDATE >= @fechaDesde)
      AND (@fechaHasta IS NULL OR G.TRXDATE <= @fechaHasta)
      AND (@sourcdoc IS NULL OR G.SOURCDOC = @sourcdoc)
      AND (@referencia IS NULL OR G.REFRENCE LIKE @referencia OR G.DSCRIPTN LIKE @referencia)
    ORDER BY G.TRXDATE DESC
  `);

  return {
    movimientos: result.recordset,
    columns: result.recordset[0] ? Object.keys(result.recordset[0]) : [],
  };
};

module.exports = getOpb;
