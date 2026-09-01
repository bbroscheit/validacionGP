const { fetchVentas, fetchCompras } = require('../../services/libroIvaDigitalData');

// Resumen Neto / Impuestos / Total de ventas y compras, para el link de "Bases" que
// muestra de un vistazo lo que después se exporta en el Libro IVA Digital. Reusa el
// mismo armado de datos que el generador de TXT (fetchVentas/fetchCompras) - así el
// resumen y el archivo exportado siempre coinciden entre sí.
function resumir(documentos) {
  let neto = 0;
  let impuestos = 0;
  let total = 0;
  documentos.forEach((doc) => {
    neto += doc.alicuotas.reduce((acc, al) => acc + al.neto, 0) + doc.importeExento + doc.importeNoGravado;
    impuestos += doc.alicuotas.reduce((acc, al) => acc + al.iva, 0) + doc.percepcionIIBB + doc.percepcionIVA + doc.otrosTributos;
    total += doc.importeTotal;
  });
  return { neto, impuestos, total, cantidadComprobantes: documentos.length };
}

const getLibroIvaDigitalResumen = async ({ fechaDesde, fechaHasta }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const [ventas, compras] = await Promise.all([
    fetchVentas(fechaDesde, fechaHasta),
    fetchCompras(fechaDesde, fechaHasta),
  ]);

  return {
    ventas: resumir(ventas),
    compras: resumir(compras),
  };
};

module.exports = getLibroIvaDigitalResumen;
