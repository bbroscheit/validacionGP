const validacionRouter = require('express').Router();

const getVentas = require('./controllers/getVentas.js');
const getCompras = require('./controllers/getCompras.js');
const getGastos = require('./controllers/getGastos.js');
const getOpb = require('./controllers/getOpb.js');
const getVentasPorSucursal = require('./controllers/getVentasPorSucursal.js');
const getVentasPorSucursalCuenta = require('./controllers/getVentasPorSucursalCuenta.js');
const getAsientoVentas = require('./controllers/getAsientoVentas.js');
const getSucursalesVentas = require('./controllers/getSucursalesVentas.js');
const getVentasPorCategoriaContribuyente = require('./controllers/getVentasPorCategoriaContribuyente.js');
const getComprasPorSucursal = require('./controllers/getComprasPorSucursal.js');
const getComprasPorSucursalCuenta = require('./controllers/getComprasPorSucursalCuenta.js');
const getAsientoCompras = require('./controllers/getAsientoCompras.js');
const getSucursalesCompras = require('./controllers/getSucursalesCompras.js');
const getComprasPorCategoriaContribuyente = require('./controllers/getComprasPorCategoriaContribuyente.js');

// Endpoint 1 - Ventas: SOP30200/SOP30300 filtrado por sucursal y fechas
validacionRouter.get('/ventas', async (req, res) => {
  try {
    const { sucursal, fechaDesde, fechaHasta, soloConP } = req.query;
    const data = await getVentas({ sucursal, fechaDesde, fechaHasta, soloConP });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /ventas', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Endpoint 2 - Compras: PM30200/PM10000 filtrando solo facturas
validacionRouter.get('/compras', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta } = req.query;
    const data = await getCompras({ fechaDesde, fechaHasta });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /compras', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Endpoint 3 - Gastos (GL): GL20000/GL00100 filtrado por rango de cuentas de gastos
validacionRouter.get('/gastos', async (req, res) => {
  try {
    const { cuentaDesde, cuentaHasta, fechaDesde, fechaHasta } = req.query;
    const data = await getGastos({ cuentaDesde, cuentaHasta, fechaDesde, fechaHasta });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /gastos', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Endpoint 4 - OPB: GL20000 aislando órdenes de pago varias sin factura
validacionRouter.get('/opb', async (req, res) => {
  try {
    const { cuentaDesde, cuentaHasta, fechaDesde, fechaHasta, referencia, sourcdoc } = req.query;
    const data = await getOpb({ cuentaDesde, cuentaHasta, fechaDesde, fechaHasta, referencia, sourcdoc });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /opb', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Reporte 1 - Ventas por sucursal: SOP30200 agrupado por PHONE3, monto facturado neto
validacionRouter.get('/reportes/ventas-por-sucursal', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, soloConP } = req.query;
    const data = await getVentasPorSucursal({ fechaDesde, fechaHasta, soloConP });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/ventas-por-sucursal', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Reporte - Ventas por sucursal y cuenta contable: GL20000 (SOURCDOC=SJ) agrupado por
// sucursal (vía SOP30200.PHONE3) y cuenta, excluyendo la cuenta de deudores por ventas
validacionRouter.get('/reportes/ventas-por-sucursal-cuenta', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, soloConP } = req.query;
    const data = await getVentasPorSucursalCuenta({ fechaDesde, fechaHasta, soloConP });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/ventas-por-sucursal-cuenta', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Reporte - Asiento contable de ventas (resumen Debe/Haber), opcionalmente por sucursal
validacionRouter.get('/reportes/asiento-ventas', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, sucursal, soloConP } = req.query;
    const data = await getAsientoVentas({ fechaDesde, fechaHasta, sucursal, soloConP });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/asiento-ventas', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Lista de sucursales para poblar el selector de los reportes de ventas
validacionRouter.get('/reportes/sucursales-ventas', async (req, res) => {
  try {
    const data = await getSucursalesVentas();
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/sucursales-ventas', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Reporte - Ventas por categoría de cuenta (USERDEF2) y tipo de contribuyente
validacionRouter.get('/reportes/ventas-categoria-contribuyente', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, soloConP } = req.query;
    const data = await getVentasPorCategoriaContribuyente({ fechaDesde, fechaHasta, soloConP });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/ventas-categoria-contribuyente', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Reporte - Compras por sucursal: GL20000 (SOURCDOC=PMTRX/PMVVR) agrupado por zona de
// Contabilidad Analítica (AATransactions), normalizando la descripción de zona
validacionRouter.get('/reportes/compras-por-sucursal', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta } = req.query;
    const data = await getComprasPorSucursal({ fechaDesde, fechaHasta });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/compras-por-sucursal', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Reporte - Compras por sucursal y cuenta contable: todas las cuentas de GL20000
// (SOURCDOC=PMTRX/PMVVR), sin excluir nada por SQL - el control queda en los checkbox
validacionRouter.get('/reportes/compras-por-sucursal-cuenta', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta } = req.query;
    const data = await getComprasPorSucursalCuenta({ fechaDesde, fechaHasta });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/compras-por-sucursal-cuenta', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Reporte - Asiento contable de compras (resumen Debe/Haber), opcionalmente por sucursal
validacionRouter.get('/reportes/asiento-compras', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta /* , sucursal */ } = req.query;
    const data = await getAsientoCompras({ fechaDesde, fechaHasta /* , sucursal */ });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/asiento-compras', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Lista de sucursales (zona) para poblar el selector de los reportes de compras
validacionRouter.get('/reportes/sucursales-compras', async (req, res) => {
  try {
    const data = await getSucursalesCompras();
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/sucursales-compras', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Reporte - Compras por categoría de cuenta (USERDEF2) y tipo de contribuyente del proveedor
validacionRouter.get('/reportes/compras-categoria-contribuyente', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta } = req.query;
    const data = await getComprasPorCategoriaContribuyente({ fechaDesde, fechaHasta });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/compras-categoria-contribuyente', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

module.exports = validacionRouter;
