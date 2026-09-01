const { num, alpha, importe, fecha, tipoCambio } = require('./fixedWidth');
const { tipoComprobante, alicuotaCodigo, CODIGO_MONEDA_PESOS } = require('./arcaCodes');

// Anchos de campo adoptados para los campos "Var." del instructivo (no traen longitud
// exacta en la revisión 30/07/2025 - ver NOTAS.md / aviso en el chat). Son los anchos
// convencionales usados por otros generadores de este mismo régimen (heredado de la RG
// 3685). Antes de la primera presentación real, validar un archivo de prueba contra el
// importador de ARCA y ajustar acá si observa algo distinto.
const ANCHO = {
  numeroComprobante: 8,
  numeroIdentificacion: 20,
  nombre: 30,
  despachoImportacion: 16,
  cuitEmisorCorredor: 11,
  denominacionEmisorCorredor: 30,
};

// Código de operación (campo 20 en ambos CBTE): solo aplica cuando el comprobante no
// tiene ninguna alícuota gravada > 0 (todo exento y/o no gravado). Con alícuotas
// gravadas presentes va en blanco.
function codigoOperacion(doc) {
  if (doc.alicuotas.length > 0) return ' ';
  if (doc.importeExento > 0) return 'E';
  if (doc.importeNoGravado > 0) return 'N';
  return ' ';
}

function lineaVentaCbte(doc) {
  const campos = [
    fecha(doc.fecha),
    num(tipoComprobante(doc.tipoDoc, doc.letra), 3),
    num(doc.pdv, 5),
    num(doc.numero, ANCHO.numeroComprobante),
    num(doc.numero, ANCHO.numeroComprobante), // campo 5: número "hasta" = igual al 4 (no se agrupa por totales diarios)
    num(doc.codigoDocumento, 2),
    alpha(doc.numeroIdentificacion, ANCHO.numeroIdentificacion),
    alpha(doc.nombre, ANCHO.nombre),
    importe(doc.importeTotal),
    importe(0), // 10 - conceptos que no integran el neto
    importe(0), // 11 - percepción a no categorizados
    importe(doc.importeExento), // 12
    importe(0), // 13 - percep/pagos impuestos nacionales
    importe(doc.percepcionIIBB), // 14
    importe(0), // 15 - percep municipales
    importe(0), // 16 - impuestos internos
    alpha(CODIGO_MONEDA_PESOS, 3),
    tipoCambio(),
    num(doc.alicuotas.length, 1),
    alpha(codigoOperacion(doc), 1),
    importe(doc.otrosTributos), // 21
    num(0, 8), // 22 - fecha vencimiento/pago (n/a, no es servicio público)
    importe(0), // 23 - reintegro TurIVA
  ];
  return campos.join('');
}

function lineasVentaAlicuotas(doc) {
  return doc.alicuotas.map((al) => [
    num(tipoComprobante(doc.tipoDoc, doc.letra), 3),
    num(doc.pdv, 5),
    num(doc.numero, ANCHO.numeroComprobante),
    importe(al.neto),
    num(alicuotaCodigo(al.tasa), 4),
    importe(al.iva),
  ].join(''));
}

function lineaCompraCbte(doc) {
  // Comprobantes B/C no discriminan IVA - cantidad de alícuotas va en 0 (indicación
  // explícita del instructivo), aunque GP tenga detalle impositivo interno para ellos.
  const cantidadAlicuotas = doc.letra === 'A' ? doc.alicuotas.length : 0;
  const ivaLiquidadoTotal = doc.alicuotas.reduce((acc, al) => acc + al.iva, 0);

  const campos = [
    fecha(doc.fecha),
    num(tipoComprobante(doc.tipoDoc, doc.letra), 3),
    num(doc.pdv, 5),
    num(doc.numero, ANCHO.numeroComprobante),
    num(0, ANCHO.despachoImportacion), // 5 - despacho de importación (no aplica)
    num(doc.codigoDocumento, 2),
    alpha(doc.numeroIdentificacion, ANCHO.numeroIdentificacion),
    alpha(doc.nombre, ANCHO.nombre),
    importe(doc.importeTotal),
    importe(0), // 10 - conceptos que no integran el neto
    importe(doc.importeExento), // 11
    importe(doc.percepcionIVA), // 12
    importe(0), // 13 - percep otros impuestos nacionales
    importe(doc.percepcionIIBB), // 14
    importe(0), // 15 - percep municipales
    importe(0), // 16 - impuestos internos
    alpha(CODIGO_MONEDA_PESOS, 3),
    tipoCambio(),
    num(cantidadAlicuotas, 1),
    alpha(codigoOperacion(doc), 1),
    importe(ivaLiquidadoTotal), // 21 - crédito fiscal computable (sin prorrateo = igual al IVA liquidado)
    importe(doc.otrosTributos), // 22
    num(0, ANCHO.cuitEmisorCorredor), // 23 - CUIT emisor/corredor (no aplica, no hay granos/corredores)
    alpha('', ANCHO.denominacionEmisorCorredor), // 24
    importe(0), // 25 - IVA comisión
    importe(0), // 26 - reintegro TurIVA
  ];
  return campos.join('');
}

function lineasCompraAlicuotas(doc) {
  if (doc.letra !== 'A') return [];
  return doc.alicuotas.map((al) => [
    num(tipoComprobante(doc.tipoDoc, doc.letra), 3),
    num(doc.pdv, 5),
    num(doc.numero, ANCHO.numeroComprobante),
    num(doc.codigoDocumento, 2),
    alpha(doc.numeroIdentificacion, ANCHO.numeroIdentificacion),
    importe(al.neto),
    num(alicuotaCodigo(al.tasa), 4),
    importe(al.iva),
  ].join(''));
}

function construirVentasCbte(ventas) {
  return ventas.map(lineaVentaCbte).join('\r\n');
}

function construirVentasAlicuotas(ventas) {
  return ventas.flatMap(lineasVentaAlicuotas).join('\r\n');
}

function construirComprasCbte(compras) {
  return compras.map(lineaCompraCbte).join('\r\n');
}

function construirComprasAlicuotas(compras) {
  return compras.flatMap(lineasCompraAlicuotas).join('\r\n');
}

module.exports = { construirVentasCbte, construirVentasAlicuotas, construirComprasCbte, construirComprasAlicuotas };
