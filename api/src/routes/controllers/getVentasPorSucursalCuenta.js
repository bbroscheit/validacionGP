const { getGpPoolEcobahia, sql } = require('../../config/gpPool');

// Reporte - Ventas por sucursal y cuenta contable
// GL20000 filtrado por SOURCDOC = 'SJ' (asientos generados por el módulo de ventas,
// mismo código usado en getGastos.js) es donde vive el desglose real por cuenta: cada
// factura postea varias líneas (deudores, impuestos, ventas por rubro/cuenta) y GP no
// guarda la sucursal ahí - por eso se cruza G.ORDOCNUM (número de comprobante) contra
// SOP30200.SOPNUMBE para traer PHONE3.
// Se excluye la cuenta de deudores por ventas (113110-01-000) a pedido: es la
// contrapartida de cobro, no una cuenta que "factura" nada.
// El monto por cuenta es CRDTAMNT - DEBITAMT: en una factura normal las cuentas de
// venta/impuestos van al haber, en una nota de crédito GP invierte debe/haber - la resta
// ya da el signo correcto sin tener que detectar "NC" a mano.
//
// Se trae siempre el detalle por línea de asiento (`base`) además del agrupado (`rows`):
// el agrupado se calcula en JS a partir de ese mismo detalle, así el Excel de control
// (pestaña "Base" + pestaña "Resultado") es una suma verificable línea por línea.
const MONEDA_VACIA = 'En Blanco';
const CUENTA_DEUDORES = '113110-01-000';
const MAX_ROWS = 100000;

const getVentasPorSucursalCuenta = async ({ fechaDesde, fechaHasta, soloConP = true }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const pool = await getGpPoolEcobahia();
  const soloConPBool = soloConP === false || soloConP === 'false' ? false : true;

  const bindFilters = (request) => {
    request.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
    request.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
    request.input('soloConP', sql.Bit, soloConPBool);
    request.input('cuentaDeudores', sql.VarChar(75), CUENTA_DEUDORES);
    return request;
  };

  const countRequest = bindFilters(pool.request());
  const count = await countRequest.query(`
    SELECT COUNT(*) AS total
    FROM GL20000 AS G
    INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
    WHERE
      LTRIM(RTRIM(G.SOURCDOC)) = 'SJ'
      AND G.TRXDATE >= @fechaDesde
      AND G.TRXDATE <= @fechaHasta
      AND LTRIM(RTRIM(N.ACTNUMST)) <> @cuentaDeudores
      AND (@soloConP = 0 OR LTRIM(RTRIM(G.ORDOCNUM)) LIKE '%P%')
  `);
  const totalCount = count.recordset[0].total;

  const detalleRequest = bindFilters(pool.request());
  const detalle = await detalleRequest.query(`
    SELECT TOP (${MAX_ROWS})
      NULLIF(LTRIM(RTRIM(H.PHONE3)), '') AS Sucursal,
      LTRIM(RTRIM(G.ORDOCNUM)) AS Comprobante,
      LTRIM(RTRIM(N.ACTNUMST)) AS Cuenta,
      LTRIM(RTRIM(A.ACTDESCR)) AS CuentaDescripcion,
      G.DEBITAMT,
      G.CRDTAMNT
    FROM GL20000 AS G
    INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
    INNER JOIN GL00100 AS A ON A.ACTINDX = G.ACTINDX
    LEFT JOIN SOP30200 AS H ON LTRIM(RTRIM(H.SOPNUMBE)) = LTRIM(RTRIM(G.ORDOCNUM))
    WHERE
      LTRIM(RTRIM(G.SOURCDOC)) = 'SJ'
      AND G.TRXDATE >= @fechaDesde
      AND G.TRXDATE <= @fechaHasta
      AND LTRIM(RTRIM(N.ACTNUMST)) <> @cuentaDeudores
      AND (@soloConP = 0 OR LTRIM(RTRIM(G.ORDOCNUM)) LIKE '%P%')
    ORDER BY Sucursal ASC, Cuenta ASC
  `);

  const base = detalle.recordset.map((row) => ({
    Sucursal: row.Sucursal || MONEDA_VACIA,
    Comprobante: row.Comprobante,
    Cuenta: row.Cuenta,
    CuentaDescripcion: row.CuentaDescripcion,
    Monto: (row.CRDTAMNT || 0) - (row.DEBITAMT || 0),
  }));

  const agrupado = new Map();
  base.forEach((row) => {
    const key = `${row.Sucursal}||${row.Cuenta}`;
    if (!agrupado.has(key)) {
      agrupado.set(key, { Sucursal: row.Sucursal, Cuenta: row.Cuenta, CuentaDescripcion: row.CuentaDescripcion, Monto: 0 });
    }
    agrupado.get(key).Monto += row.Monto;
  });

  const rows = [...agrupado.values()].sort((a, b) => a.Sucursal.localeCompare(b.Sucursal) || a.Cuenta.localeCompare(b.Cuenta));

  const totalGeneral = rows.reduce((acc, row) => acc + row.Monto, 0);

  return {
    totalCount,
    truncated: totalCount > MAX_ROWS,
    base,
    baseColumns: ['Sucursal', 'Comprobante', 'Cuenta', 'CuentaDescripcion', 'Monto'],
    rows,
    columns: ['Sucursal', 'Cuenta', 'CuentaDescripcion', 'Monto'],
    totalGeneral,
  };
};

module.exports = getVentasPorSucursalCuenta;
