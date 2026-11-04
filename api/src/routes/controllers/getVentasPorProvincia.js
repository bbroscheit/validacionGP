const { getGpPoolEcobahia, getGpPoolEcosistemas, getGpPoolEcoportatiles, getGpPoolBaxpa, getGpPoolCylius, getGpPoolChile, sql } = require('../../config/gpPool');
const { getOverridesMap } = require('../../services/clasificacionOverrides');

const POOLS = { ecobahia: getGpPoolEcobahia, ecosistemas: getGpPoolEcosistemas, ecoportatiles: getGpPoolEcoportatiles, baxpa: getGpPoolBaxpa, cylius: getGpPoolCylius, chile: getGpPoolChile };

// Reporte - Ventas por provincia: igual que Ventas por sucursal, pero agrupa SOP30200 por
// STATE (provincia de la ficha del cliente/comprobante) en vez de PHONE3. Misma lógica de
// Neto/Impuestos/Total y mismo signo invertido en notas de crédito - ver
// getVentasPorSucursal.js para el detalle de esas cuentas. No existe para sist2
// (bloqueado en el router), pero sí aplica a Ecosistemas Patagónicos igual que Ecobahia.
const MONEDA_VACIA = 'En Blanco';
const MAX_ROWS = 100000;

const getVentasPorProvincia = async ({ fechaDesde, fechaHasta, soloConP = true, empresa = 'ecobahia' }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const pool = await POOLS[empresa]();
  const soloConPBool = soloConP === false || soloConP === 'false' ? false : true;

  // Mismo criterio que getVentasPorSucursal.js: Cylius factura en UYU/USD sin tipo de
  // cambio en la base, así que ahí se agrupa también por moneda y se totaliza aparte.
  const multiMoneda = empresa === 'cylius';
  const monedaSelect = multiMoneda ? ', LTRIM(RTRIM(H.CURNCYID)) AS Moneda' : '';

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
        ISNULL(H.BCKTXAMT, 0) AS BCKTXAMT${monedaSelect}
      FROM SOP30200 AS H
      LEFT JOIN RM00101 AS C ON C.CUSTNMBR = H.CUSTNMBR
      WHERE
        H.DOCDATE >= @fechaDesde
        AND H.DOCDATE <= @fechaHasta
        AND (@soloConP = 0 OR H.SOPNUMBE LIKE '%P%')
        AND ISNULL(H.VOIDSTTS, 0) = 0
      ORDER BY H.DOCDATE ASC
    `),
    getOverridesMap({ empresa, tipo: 'provincia' }),
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
      ...(multiMoneda ? { Moneda: row.Moneda || MONEDA_VACIA } : {}),
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

  const claveDe = (row) => (multiMoneda ? `${row.Provincia}__${row.Moneda}` : row.Provincia);

  const agrupado = new Map();
  base.forEach((row) => {
    const clave = claveDe(row);
    if (!agrupado.has(clave)) {
      agrupado.set(clave, { Provincia: row.Provincia, ...(multiMoneda ? { Moneda: row.Moneda } : {}), CantidadComprobantes: 0, Neto: 0, Impuestos: 0, Total: 0 });
    }
    const grupo = agrupado.get(clave);
    grupo.CantidadComprobantes += 1;
    grupo.Neto += row.Neto;
    grupo.Impuestos += row.Impuestos;
    grupo.Total += row.Total;
  });

  const rows = [...agrupado.values()].sort((a, b) => a.Provincia.localeCompare(b.Provincia) || (multiMoneda ? a.Moneda.localeCompare(b.Moneda) : 0));

  let totalComprobantes, totalNeto, totalImpuestos, totalGeneral, totalesPorMoneda;
  if (multiMoneda) {
    const porMoneda = new Map();
    rows.forEach((row) => {
      if (!porMoneda.has(row.Moneda)) porMoneda.set(row.Moneda, { Moneda: row.Moneda, totalComprobantes: 0, totalNeto: 0, totalImpuestos: 0, totalGeneral: 0 });
      const t = porMoneda.get(row.Moneda);
      t.totalComprobantes += row.CantidadComprobantes;
      t.totalNeto += row.Neto;
      t.totalImpuestos += row.Impuestos;
      t.totalGeneral += row.Total;
    });
    totalesPorMoneda = [...porMoneda.values()].sort((a, b) => a.Moneda.localeCompare(b.Moneda));
  } else {
    totalComprobantes = rows.reduce((acc, row) => acc + row.CantidadComprobantes, 0);
    totalNeto = rows.reduce((acc, row) => acc + row.Neto, 0);
    totalImpuestos = rows.reduce((acc, row) => acc + row.Impuestos, 0);
    totalGeneral = totalNeto + totalImpuestos;
  }

  return {
    totalCount,
    truncated: totalCount > MAX_ROWS,
    base,
    baseColumns: multiMoneda
      ? ['Provincia', 'Moneda', 'Comprobante', 'DOCDATE', 'Cliente', 'NombreCliente', 'Editado', 'Neto', 'Impuestos', 'Total']
      : ['Provincia', 'Comprobante', 'DOCDATE', 'Cliente', 'NombreCliente', 'Editado', 'Neto', 'Impuestos', 'Total'],
    rows,
    columns: multiMoneda
      ? ['Provincia', 'Moneda', 'CantidadComprobantes', 'Neto', 'Impuestos', 'Total']
      : ['Provincia', 'CantidadComprobantes', 'Neto', 'Impuestos', 'Total'],
    ...(multiMoneda ? { totalesPorMoneda } : { totalComprobantes, totalNeto, totalImpuestos, totalGeneral }),
  };
};

module.exports = getVentasPorProvincia;
