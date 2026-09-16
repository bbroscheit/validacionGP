const { buscarCliente } = require('../../services/clientesGp');

// Bancos Cobranzas > Resumen: cada banco entrega un excel de movimientos con formato
// propio (columnas distintas) - se sube tal cual, se busca el cliente de GP para cada
// fila y se agrega una columna "Número de Cliente" al final, para descargar el mismo
// excel ya procesado. `filas` llega como array de arrays (fila 0 = encabezados, tal
// cual las lee la librería xlsx en el cliente con {header:1}) para no depender de que
// los nombres de columna sean exactamente los mismos en todos los bancos.

const COLUMNA_NUEVA = 'Número de Cliente';
const SIN_MATCH = 'NO ENCONTRADO';
const AMBIGUO = (custnmbrs) => `VARIOS: ${custnmbrs.join(', ')}`;

// El CUIT no viene en una columna propia, está incrustado en CONCEPTO junto con la
// descripción de la operación (confirmado contra excels reales de Credicoop, Francés y
// Provincia: "Transf. Inmediata e/Ctas. Dist. Titular 30546694719-VAR-SUC...",
// "...Ord.:30710472439-LABOREM...", "...Cuit/l:20251348937-DOMINGUEZ...",
// "CTE 30712012737 COOPERATIVA...", "CR.TRAN. 30664149113ECONSORCIO..." - varios
// prefijos distintos, siempre un número de 11 dígitos). OBSERVACIONES trae el nombre (no
// siempre limpio en todos los bancos - en Provincia a veces repite el CONCEPTO entero),
// se usa como respaldo si el CUIT no matchea ningún cliente.
//
// La condición es "no pegado a OTRO DÍGITO" en ninguna punta, NO "rodeado de espacio":
// Provincia pega el CUIT directo a la primera letra del nombre sin separador ("CR.TRAN.
// 30664149113ECONSORCIO DE GESTION..." - son 11 dígitos limpios seguidos de "ECONSORCIO",
// la letra glue varía según la fila, no es parte del CUIT). Por eso NO se puede usar \b
// (letra-a-letra no es un límite de palabra en regex, dígito-a-letra tampoco) - se usan
// lookaround negativos que solo miran si el vecino es otro DÍGITO, dejando pasar letras.
// Esto sigue rechazando los códigos largos de Francés ("007-002389330101", 15 dígitos
// pegados) porque cualquier ventana de 11 dentro de ese bloque queda pegada a más
// dígitos de un lado o del otro.
const CUIT_EN_TEXTO_RE = /(?<!\d)(\d{11})(?!\d)/;
const COL_CONCEPTO = 1;
const COL_OBSERVACIONES = 3;

// Credicoop, Francés, Provincia y Chubut resultaron tener exactamente el mismo layout de
// columnas (FECHA/CONCEPTO/IMPORTE/OBSERVACIONES/ESTADO) y la misma convención de CUIT
// incrustado en CONCEPTO - confirmado probando filas reales de los cuatro bancos, se
// reusa el mismo parser en vez de duplicarlo. Chubut suma casos sin CUIT en absoluto
// (ej. "CRED DEBIN - CRED DEBIN", "MONCOBRA SUC ARGENTINA") que ya caían bien al
// respaldo por nombre (OBSERVACIONES) sin necesitar ningún cambio. Si algún banco futuro
// trae el CUIT en otro lado, se le escribe su propia función acá.
const procesarPorConceptoConCuit = async (filas) => {
  const [encabezado, ...datos] = filas;
  const filasProcesadas = await Promise.all(
    datos.map(async (fila) => {
      const concepto = String(fila[COL_CONCEPTO] ?? '');
      const observaciones = String(fila[COL_OBSERVACIONES] ?? '');
      const cuitMatch = concepto.match(CUIT_EN_TEXTO_RE);
      const resultado = await buscarCliente({ cuit: cuitMatch ? cuitMatch[1] : null, nombre: observaciones });

      let valor;
      if (!resultado) valor = SIN_MATCH;
      else if (resultado.ambiguo) valor = AMBIGUO(resultado.ambiguo);
      else valor = resultado.custnmbr;

      return [...fila, valor];
    })
  );
  return [[...encabezado, COLUMNA_NUEVA], ...filasProcesadas];
};

const BANCOS_IMPLEMENTADOS = {
  credicoop: procesarPorConceptoConCuit,
  frances: procesarPorConceptoConCuit,
  provincia: procesarPorConceptoConCuit,
  chubut: procesarPorConceptoConCuit,
};

const procesarCobranzasBanco = async ({ banco, filas }) => {
  if (!banco || !Array.isArray(filas) || filas.length === 0) {
    throw new Error('banco y filas (con encabezado) son requeridos');
  }
  const procesador = BANCOS_IMPLEMENTADOS[banco];
  if (!procesador) {
    throw new Error(`El formato del banco "${banco}" todavía no está implementado`);
  }
  return procesador(filas);
};

module.exports = { procesarCobranzasBanco, BANCOS_IMPLEMENTADOS };
