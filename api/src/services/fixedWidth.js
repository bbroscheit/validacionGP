// Helpers de formato de ancho fijo para los archivos .txt del Libro IVA Digital (ARCA).
// Reglas generales del instructivo: numéricos rellenan con ceros a la izquierda,
// alfanuméricos con blancos a la derecha; importes van en 15 dígitos (13 enteros + 2
// decimales, sin coma ni punto, signo "-" en la primera posición si son negativos).

function num(value, length) {
  const n = Math.trunc(Number(value) || 0);
  const negativo = n < 0;
  let s = String(Math.abs(n));
  const anchoDigitos = negativo ? length - 1 : length;
  if (s.length > anchoDigitos) throw new Error(`Valor numérico "${value}" excede el ancho de ${length}`);
  s = s.padStart(anchoDigitos, '0');
  return negativo ? `-${s}` : s;
}

function alpha(value, length) {
  const s = (value ?? '').toString();
  return s.length > length ? s.slice(0, length) : s.padEnd(length, ' ');
}

// Importe: 15 dígitos = 13 enteros + 2 decimales, sin separador. Redondea a centavos.
function importe(value, length = 15) {
  const centavos = Math.round((Number(value) || 0) * 100);
  const negativo = centavos < 0;
  let s = String(Math.abs(centavos));
  const anchoDigitos = negativo ? length - 1 : length;
  if (s.length > anchoDigitos) throw new Error(`Importe "${value}" excede el ancho de ${length}`);
  s = s.padStart(anchoDigitos, '0');
  return negativo ? `-${s}` : s;
}

// Fecha AAAAMMDD a partir de un Date o string parseable. GP guarda DOCDATE como fecha
// sin horario (medianoche UTC); hay que leerla con los getters UTC, no los locales - con
// getters locales, en un huso horario detrás de UTC (Argentina, UTC-3), la fecha se corre
// un día para atrás.
function fecha(value) {
  const d = value instanceof Date ? value : new Date(value);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// Tipo de cambio: 4 enteros + 6 decimales. Siempre 1.000000 en esta empresa (opera en ARS).
function tipoCambio() {
  return '0001000000';
}

module.exports = { num, alpha, importe, fecha, tipoCambio };
