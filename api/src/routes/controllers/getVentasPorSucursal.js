const { getGpPoolEcobahia, getGpPoolSist2, sql } = require('../../config/gpPool');
const {
  resolverSucursalSist2,
  CLIENTE_SUCURSAL_JOIN_SIST2,
  CLIENTE_SUCURSAL_SELECT_SIST2,
  esNotaCreditoSist2,
} = require('../../services/sist2Ventas');
const { getOverridesMap } = require('../../services/clasificacionOverrides');

const POOLS = { ecobahia: getGpPoolEcobahia, sist2: getGpPoolSist2 };

// Reporte 1 - Ventas por sucursal
// Ecobahia: agrupa SOP30200 por PHONE3 (la columna real de sucursal - no LOCNCODE, que es
// la que usa el endpoint base /ventas como filtro).
// sist2: PHONE3 solo no alcanza (casi siempre vacío) - se resuelve con las 3 fuentes de
// services/sist2Ventas.js (PHONE3 -> DOCID -> ficha del cliente), y el signo se decide
// por SOPTYPE en vez del prefijo NC (ver ese mismo módulo para el detalle).
// Igual que en getVentas.js: TAXAMNT trae el IVA en Factura A (BCKTXAMT da 0) y en
// Factura B es al revés (precio con impuesto incluido, el IVA "desagregado" está en
// BCKTXAMT y TAXAMNT da 0). Por eso:
//   Neto      = SUBTOTAL - BCKTXAMT
//   Impuestos = TAXAMNT + BCKTXAMT
//   Total     = Neto + Impuestos (= SUBTOTAL + TAXAMNT)
// Todo con signo invertido en notas de crédito. El Neto es el que debe cerrar exacto
// contra el subtotal del libro IVA Ventas del mismo período.
//
// Se trae siempre el detalle por comprobante (`base`) además del agrupado (`rows`): el
// agrupado se calcula en JS a partir de ese mismo detalle, así el Excel de control
// (pestaña "Base" + pestaña "Resultado") es una suma verificable línea por línea, no una
// cifra que hay que confiar a ciegas.
const MONEDA_VACIA = 'En Blanco';
const MAX_ROWS = 100000;

const getVentasPorSucursal = async ({ fechaDesde, fechaHasta, soloConP = true, empresa = 'ecobahia' }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const getPool = POOLS[empresa];
  if (!getPool) throw new Error(`Empresa desconocida: "${empresa}"`);
  const pool = await getPool();
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

  const clienteSucursalJoin = empresa === 'sist2' ? CLIENTE_SUCURSAL_JOIN_SIST2 : '';
  const clienteSucursalSelect = empresa === 'sist2' ? CLIENTE_SUCURSAL_SELECT_SIST2 : '';

  const [detalle, overridesMap] = await Promise.all([
    bindFilters(pool.request()).query(`
      SELECT TOP (${MAX_ROWS})
        NULLIF(LTRIM(RTRIM(H.PHONE3)), '') AS PHONE3,
        LTRIM(RTRIM(H.DOCID)) AS DOCID,
        LTRIM(RTRIM(H.SOPNUMBE)) AS Comprobante,
        H.SOPTYPE,
        H.DOCDATE,
        LTRIM(RTRIM(H.CUSTNMBR)) AS Cliente,
        LTRIM(RTRIM(NC.CUSTNAME)) AS NombreCliente,
        ISNULL(H.SUBTOTAL, 0) AS SUBTOTAL,
        ISNULL(H.TAXAMNT, 0) AS TAXAMNT,
        ISNULL(H.BCKTXAMT, 0) AS BCKTXAMT${clienteSucursalSelect}
      FROM SOP30200 AS H
      LEFT JOIN RM00101 AS NC ON NC.CUSTNMBR = H.CUSTNMBR
      ${clienteSucursalJoin}
      WHERE
        H.DOCDATE >= @fechaDesde
        AND H.DOCDATE <= @fechaHasta
        AND (@soloConP = 0 OR H.SOPNUMBE LIKE '%P%')
        AND ISNULL(H.VOIDSTTS, 0) = 0
      ORDER BY H.DOCDATE ASC
    `),
    getOverridesMap({ empresa, tipo: 'sucursal' }),
  ]);

  const base = detalle.recordset.map((row) => {
    const signo = (empresa === 'sist2' ? esNotaCreditoSist2(row.SOPTYPE) : row.Comprobante.startsWith('NC')) ? -1 : 1;
    const neto = signo * (row.SUBTOTAL - row.BCKTXAMT);
    const impuestos = signo * (row.TAXAMNT + row.BCKTXAMT);
    const sucursalCalculada = empresa === 'sist2'
      ? resolverSucursalSist2({ phone3: row.PHONE3, docid: row.DOCID, clienteUserdef2: row.ClienteSucursal })
      : row.PHONE3;
    const override = overridesMap.get(row.Comprobante);
    return {
      Sucursal: override || sucursalCalculada || MONEDA_VACIA,
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
    if (!agrupado.has(row.Sucursal)) {
      agrupado.set(row.Sucursal, { Sucursal: row.Sucursal, CantidadComprobantes: 0, Neto: 0, Impuestos: 0, Total: 0 });
    }
    const grupo = agrupado.get(row.Sucursal);
    grupo.CantidadComprobantes += 1;
    grupo.Neto += row.Neto;
    grupo.Impuestos += row.Impuestos;
    grupo.Total += row.Total;
  });

  const rows = [...agrupado.values()].sort((a, b) => a.Sucursal.localeCompare(b.Sucursal));

  const totalComprobantes = rows.reduce((acc, row) => acc + row.CantidadComprobantes, 0);
  const totalNeto = rows.reduce((acc, row) => acc + row.Neto, 0);
  const totalImpuestos = rows.reduce((acc, row) => acc + row.Impuestos, 0);
  const totalGeneral = totalNeto + totalImpuestos;

  return {
    totalCount,
    truncated: totalCount > MAX_ROWS,
    base,
    baseColumns: ['Sucursal', 'Comprobante', 'DOCDATE', 'Cliente', 'NombreCliente', 'Editado', 'Neto', 'Impuestos', 'Total'],
    rows,
    columns: ['Sucursal', 'CantidadComprobantes', 'Neto', 'Impuestos', 'Total'],
    totalComprobantes,
    totalNeto,
    totalImpuestos,
    totalGeneral,
  };
};

module.exports = getVentasPorSucursal;
