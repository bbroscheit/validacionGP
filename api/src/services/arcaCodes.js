// Tablas de códigos del Libro IVA Digital (R.G. 4597, ARCA/AFIP).
// Fuente: "Tablas del Sistema" (Libro-IVA-Digital-Tablas-del-Sistema.pdf, revisión vigente
// al 27/08/2026). Solo se transcriben los códigos que puede necesitar esta empresa - no
// es la tabla completa (ver el PDF oficial para el resto, ej. monedas extranjeras).

// Tipo de comprobante: se arma a partir de {tipo de documento GP}+{letra}, que es como
// vienen los datos en GP (SOP30200.DOCID = "FV A0040", PM30200/PM20000.DOCNUMBR = "FC
// A0044-..."). "FC" (compras) y "FV" (ventas) mapean al mismo código AFIP - es el mismo
// concepto de "Factura", solo cambia si la genera el proveedor o la emite la empresa.
const TIPO_COMPROBANTE = {
  'FV-A': '001', 'FC-A': '001',
  'ND-A': '002',
  'NC-A': '003',
  'FV-B': '006', 'FC-B': '006',
  'ND-B': '007',
  'NC-B': '008',
  'FV-C': '011', 'FC-C': '011',
  'ND-C': '012',
  'NC-C': '013',
};

// Alícuotas de IVA
const ALICUOTA_CODIGO = {
  0: '0003',
  10.5: '0004',
  21: '0005',
  27: '0006',
  5: '0008',
  2.5: '0009',
};

const CODIGO_MONEDA_PESOS = 'PES';

function tipoComprobante(tipoDoc, letra) {
  const key = `${tipoDoc}-${letra}`;
  const code = TIPO_COMPROBANTE[key];
  if (!code) throw new Error(`Tipo de comprobante no mapeado: ${key}`);
  return code;
}

function alicuotaCodigo(tasa) {
  const code = ALICUOTA_CODIGO[tasa];
  if (!code) throw new Error(`Alícuota de IVA no mapeada: ${tasa}%`);
  return code;
}

module.exports = { TIPO_COMPROBANTE, ALICUOTA_CODIGO, CODIGO_MONEDA_PESOS, tipoComprobante, alicuotaCodigo };
