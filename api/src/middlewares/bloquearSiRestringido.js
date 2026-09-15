// Para reportes que no tienen (todavía) una dimensión de sucursal/zona confiable para
// filtrar (bases sin ese campo, reportes agrupados por categoría contable, el Libro IVA
// Digital que por naturaleza es de toda la empresa, etc.) - en vez de dejarlos sin
// filtrar (fuga de datos de otras sucursales) se bloquean del todo para usuarios
// restringidos. Ver services/autorizacion.js.
const bloquearSiRestringido = (req, res, next) => {
  if (req.sucursalRestringida) {
    res.status(403).json({
      state: 'error',
      message: 'Tu usuario no tiene acceso a este reporte (no se puede filtrar por sucursal).',
    });
    return;
  }
  next();
};

module.exports = bloquearSiRestringido;
