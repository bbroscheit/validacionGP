const { fetchVentas, fetchCompras } = require('../../services/libroIvaDigitalData');
const {
  construirVentasCbte,
  construirVentasAlicuotas,
  construirComprasCbte,
  construirComprasAlicuotas,
} = require('../../services/libroIvaDigitalTxt');

// Arma los 4 archivos .txt del Libro IVA Digital (ARCA, R.G. 4597) que necesita este
// contribuyente: VENTAS_CBTE, VENTAS_ALICUOTAS, COMPRAS_CBTE, COMPRAS_ALICUOTAS. Quedan
// afuera IMPORTACIONES y CREDITO_FISCAL_IMP_SERVICIOS porque esta empresa no tiene
// operaciones de comercio exterior (ver NOTAS.md).
//
// El archivo debe presentarse en Windows-1252/ISO-8859-1, no UTF-8 (instructivo, sección
// "Consideraciones generales"). Por eso el contenido se manda codificado en base64 desde
// acá (Buffer.from(texto, 'latin1') - los caracteres que usamos, incluyendo tildes y ñ,
// caen en el rango 0x00-0xFF donde latin1/windows-1252 coinciden con el código Unicode) y
// el cliente arma el .txt a partir de esos bytes, no del string JS directamente.
const getLibroIvaDigitalExport = async ({ fechaDesde, fechaHasta }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const [ventas, compras] = await Promise.all([
    fetchVentas(fechaDesde, fechaHasta),
    fetchCompras(fechaDesde, fechaHasta),
  ]);

  const archivos = [
    { nombre: 'LIBRO_IVA_DIGITAL_VENTAS_CBTE.txt', contenido: construirVentasCbte(ventas) },
    { nombre: 'LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS.txt', contenido: construirVentasAlicuotas(ventas) },
    { nombre: 'LIBRO_IVA_DIGITAL_COMPRAS_CBTE.txt', contenido: construirComprasCbte(compras) },
    { nombre: 'LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS.txt', contenido: construirComprasAlicuotas(compras) },
  ];

  return {
    archivos: archivos.map((a) => ({
      nombre: a.nombre,
      contenidoBase64: Buffer.from(a.contenido, 'latin1').toString('base64'),
      lineas: a.contenido ? a.contenido.split('\r\n').length : 0,
    })),
    cantidadVentas: ventas.length,
    cantidadCompras: compras.length,
  };
};

module.exports = getLibroIvaDigitalExport;
