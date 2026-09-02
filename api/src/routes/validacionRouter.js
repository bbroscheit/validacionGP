const validacionRouter = require('express').Router();

const getVentas = require('./controllers/getVentas.js');
const getCompras = require('./controllers/getCompras.js');
const getGastos = require('./controllers/getGastos.js');
const getOpb = require('./controllers/getOpb.js');
const getVentasPorSucursal = require('./controllers/getVentasPorSucursal.js');
const getVentasPorProvincia = require('./controllers/getVentasPorProvincia.js');
const getVentasPorSucursalCuenta = require('./controllers/getVentasPorSucursalCuenta.js');
const getAsientoVentas = require('./controllers/getAsientoVentas.js');
const getSucursalesVentas = require('./controllers/getSucursalesVentas.js');
const getVentasPorCategoriaContribuyente = require('./controllers/getVentasPorCategoriaContribuyente.js');
const getComprasPorSucursal = require('./controllers/getComprasPorSucursal.js');
const getComprasPorSucursalCuenta = require('./controllers/getComprasPorSucursalCuenta.js');
const getAsientoCompras = require('./controllers/getAsientoCompras.js');
const getSucursalesCompras = require('./controllers/getSucursalesCompras.js');
const getComprasPorCategoriaContribuyente = require('./controllers/getComprasPorCategoriaContribuyente.js');
const getLibroIvaDigitalResumen = require('./controllers/getLibroIvaDigitalResumen.js');
const getLibroIvaDigitalExport = require('./controllers/getLibroIvaDigitalExport.js');
const getCobranzasSist2 = require('./controllers/getCobranzasSist2.js');
const getClientesSist2 = require('./controllers/getClientesSist2.js');
const getCuentaCorrienteSist2 = require('./controllers/getCuentaCorrienteSist2.js');
const { putOverrideClasificacion, deleteOverrideClasificacion } = require('./controllers/overridesClasificacion.js');

// Endpoint 1 - Ventas: SOP30200/SOP30300 filtrado por sucursal y fechas
validacionRouter.get('/ventas', async (req, res) => {
  try {
    const { sucursal, fechaDesde, fechaHasta, soloConP, empresa } = req.query;
    const data = await getVentas({ sucursal, fechaDesde, fechaHasta, soloConP, empresa });
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
    const { cuentaDesde, cuentaHasta, fechaDesde, fechaHasta, empresa } = req.query;
    const data = await getGastos({ cuentaDesde, cuentaHasta, fechaDesde, fechaHasta, empresa });
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

// Reporte 1 - Ventas por sucursal: SOP30200 agrupado por sucursal, monto facturado neto
validacionRouter.get('/reportes/ventas-por-sucursal', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, soloConP, empresa } = req.query;
    const data = await getVentasPorSucursal({ fechaDesde, fechaHasta, soloConP, empresa });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/ventas-por-sucursal', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Reporte - Ventas por provincia (solo Ecobahia): SOP30200 agrupado por STATE, monto
// facturado neto (misma lógica que ventas-por-sucursal)
validacionRouter.get('/reportes/ventas-por-provincia', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, soloConP } = req.query;
    const data = await getVentasPorProvincia({ fechaDesde, fechaHasta, soloConP });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/ventas-por-provincia', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Reporte - Ventas por sucursal y cuenta contable: GL20000 (SOURCDOC=SJ) agrupado por
// sucursal y cuenta, excluyendo la cuenta de deudores por ventas
validacionRouter.get('/reportes/ventas-por-sucursal-cuenta', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, soloConP, empresa } = req.query;
    const data = await getVentasPorSucursalCuenta({ fechaDesde, fechaHasta, soloConP, empresa });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/ventas-por-sucursal-cuenta', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Reporte - Asiento contable de ventas (resumen Debe/Haber), opcionalmente por sucursal
validacionRouter.get('/reportes/asiento-ventas', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, sucursal, soloConP, empresa } = req.query;
    const data = await getAsientoVentas({ fechaDesde, fechaHasta, sucursal, soloConP, empresa });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/asiento-ventas', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Lista de sucursales para poblar el selector de los reportes de ventas
validacionRouter.get('/reportes/sucursales-ventas', async (req, res) => {
  try {
    const { empresa } = req.query;
    const data = await getSucursalesVentas({ empresa });
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

// Libro IVA Digital (ARCA, R.G. 4597) - resumen Neto/Impuestos/Total de ventas y compras
validacionRouter.get('/reportes/libro-iva-digital/resumen', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta } = req.query;
    const data = await getLibroIvaDigitalResumen({ fechaDesde, fechaHasta });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/libro-iva-digital/resumen', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Libro IVA Digital (ARCA, R.G. 4597) - genera los 4 .txt (ventas/compras x cbte/alicuotas)
validacionRouter.get('/reportes/libro-iva-digital/export', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta } = req.query;
    const data = await getLibroIvaDigitalExport({ fechaDesde, fechaHasta });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/libro-iva-digital/export', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Reporte - Cobranzas por sucursal (solo sist2): recibos (GL20000, CRJ/RMJ) agrupados
// por sucursal, resuelta vía la factura aplicada o, si no hay, la ficha del cliente
validacionRouter.get('/reportes/sist2/cobranzas', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta } = req.query;
    const data = await getCobranzasSist2({ fechaDesde, fechaHasta });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/sist2/cobranzas', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Búsqueda de clientes (sist2) para el selector de Cuenta Corriente
validacionRouter.get('/reportes/sist2/clientes', async (req, res) => {
  try {
    const { q } = req.query;
    const data = await getClientesSist2({ q });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/sist2/clientes', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Reporte - Cuenta corriente de cliente (solo sist2): historial completo (RM20101) con
// saldo inicial arrastrado + movimientos del período con saldo corrido
validacionRouter.get('/reportes/sist2/cuenta-corriente', async (req, res) => {
  try {
    const { cliente, fechaDesde, fechaHasta, sucursal, pendientes } = req.query;
    const data = await getCuentaCorrienteSist2({ cliente, fechaDesde, fechaHasta, sucursal, pendientes });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en /reportes/sist2/cuenta-corriente', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

// Overrides de clasificación (Postgres, app propia): corrección manual por comprobante
// de Sucursal/Provincia cuando el dato de GP viene en blanco o mal cargado. Se aplican
// dentro de getVentasPorSucursal.js / getVentasPorProvincia.js antes de agrupar.
validacionRouter.put('/overrides/clasificacion', async (req, res) => {
  try {
    const { empresa, tipo, comprobante, valor, valorOriginal, usuario } = req.body;
    const data = await putOverrideClasificacion({ empresa, tipo, comprobante, valor, valorOriginal, usuario });
    res.status(200).json(data);
  } catch (e) {
    console.log('error en PUT /overrides/clasificacion', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

validacionRouter.delete('/overrides/clasificacion', async (req, res) => {
  try {
    const { empresa, tipo, comprobante } = req.body;
    const eliminado = await deleteOverrideClasificacion({ empresa, tipo, comprobante });
    res.status(200).json({ eliminado });
  } catch (e) {
    console.log('error en DELETE /overrides/clasificacion', e.message);
    res.status(500).json({ state: 'error', message: e.message });
  }
});

module.exports = validacionRouter;
