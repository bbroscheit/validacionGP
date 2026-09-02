const { getGpPoolEcobahia, sql } = require('../../config/gpPool');
const { getOverridesMap } = require('../../services/clasificacionOverrides');

// Reporte - Ventas por provincia (solo Ecobahia): igual que Ventas por sucursal, pero
// agrupa SOP30200 por STATE (provincia de la ficha del cliente/comprobante) en vez de
// PHONE3. Misma lógica de Neto/Impuestos/Total y mismo signo invertido en notas de
// crédito - ver getVentasPorSucursal.js para el detalle de esas cuentas.
const MONEDA_VACIA = 'En Blanco';
const MAX_ROWS = 100000;

const getVentasPorProvincia = async ({ fechaDesde, fechaHasta, soloConP = true }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const pool = await getGpPoolEcobahia();
  const soloConPBool = soloConP === false || soloConP === 'false' ? false : true;

  const bindFilters = (request) => {
    request.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
    request.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
    request.input('soloConP', sql.Bit, soloConPBool);
    return request;
  };

  const countRequest = bindFilters(pool.request());
  const count = await countRequest.query(`
    SELECT COUNT(*) AS total
    FROM SOP30200 AS H
    WHERE
      H.DOCDATE >= @fechaDesde
      AND H.DOCDATE <= @fechaHasta
      AND (@soloConP = 0 OR H.SOPNUMBE LIKE '%P%')
      AND ISNULL(H.VOIDSTTS, 0) = 0 -- excluye comprobantes anulados en GP (no son ventas reales)
  `);
  const totalCount = count.recordset[0].total;

  const [detalle, overridesMap] = await Promise.all([
    bindFilters(pool.request()).query(`
      SELECT TOP (${MAX_ROWS})
        NULLIF(LTRIM(RTRIM(H.STATE)), '') AS STATE,
        LTRIM(RTRIM(H.SOPNUMBE)) AS Comprobante,
        H.SOPTYPE,
        H.DOCDATE,
        LTRIM(RTRIM(H.CUSTNMBR)) AS Cliente,
        LTRIM(RTRIM(C.CUSTNAME)) AS NombreCliente,
        ISNULL(H.SUBTOTAL, 0) AS SUBTOTAL,
        ISNULL(H.TAXAMNT, 0) AS TAXAMNT,
        ISNULL(H.BCKTXAMT, 0) AS BCKTXAMT
      FROM SOP30200 AS H
      LEFT JOIN RM00101 AS C ON C.CUSTNMBR = H.CUSTNMBR
      WHERE
        H.DOCDATE >= @fechaDesde
        AND H.DOCDATE <= @fechaHasta
        AND (@soloConP = 0 OR H.SOPNUMBE LIKE '%P%')
        AND ISNULL(H.VOIDSTTS, 0) = 0
      ORDER BY H.DOCDATE ASC
    `),
    getOverridesMap({ empresa: 'ecobahia', tipo: 'provincia' }),
  ]);

  const base = detalle.recordset.map((row) => {
    const signo = row.Comprobante.startsWith('NC') ? -1 : 1;
    const neto = signo * (row.SUBTOTAL - row.BCKTXAMT);
    const impuestos = signo * (row.TAXAMNT + row.BCKTXAMT);
    // STATE viene con mayúsculas/minúsculas inconsistentes en GP ("Buenos Aires",
    // "BUENOS AIRES", "buenos aires"...) - se normaliza a mayúsculas para que agrupe
    // bien. Ojo: algunos valores son directamente nombres de ciudad y no de provincia
    // (ej. "PUNTA ALTA", "SANTA ROSA") - eso es así en la data de origen; se corrige a
    // mano vía overridesMap (Postgres) por comprobante, no acá.
    const provinciaCalculada = row.STATE ? row.STATE.toUpperCase() : MONEDA_VACIA;
    const override = overridesMap.get(row.Comprobante);
    return {
      Provincia: override || provinciaCalculada,
      Comprobante: row.Comprobante,
      DOCDATE: row.DOCDATE,
      Cliente: row.Cliente,
      NombreCliente: row.NombreCliente,
      Editado: !!override,
      Neto: neto,
      Impuestos: impuestos,
      Total: neto + impuestos,
    };
  });

  const agrupado = new Map();
  base.forEach((row) => {
    if (!agrupado.has(row.Provincia)) {
      agrupado.set(row.Provincia, { Provincia: row.Provincia, CantidadComprobantes: 0, Neto: 0, Impuestos: 0, Total: 0 });
    }
    const grupo = agrupado.get(row.Provincia);
    grupo.CantidadComprobantes += 1;
    grupo.Neto += row.Neto;
    grupo.Impuestos += row.Impuestos;
    grupo.Total += row.Total;
  });

  const rows = [...agrupado.values()].sort((a, b) => a.Provincia.localeCompare(b.Provincia));

  const totalComprobantes = rows.reduce((acc, row) => acc + row.CantidadComprobantes, 0);
  const totalNeto = rows.reduce((acc, row) => acc + row.Neto, 0);
  const totalImpuestos = rows.reduce((acc, row) => acc + row.Impuestos, 0);
  const totalGeneral = totalNeto + totalImpuestos;

  return {
    totalCount,
    truncated: totalCount > MAX_ROWS,
    base,
    baseColumns: ['Provincia', 'Comprobante', 'DOCDATE', 'Cliente', 'NombreCliente', 'Editado', 'Neto', 'Impuestos', 'Total'],
    rows,
    columns: ['Provincia', 'CantidadComprobantes', 'Neto', 'Impuestos', 'Total'],
    totalComprobantes,
    totalNeto,
    totalImpuestos,
    totalGeneral,
  };
};

module.exports = getVentasPorProvincia;
