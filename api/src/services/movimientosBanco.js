const crypto = require('crypto');
const { Op } = require('sequelize');
const MovimientoBanco = require('../models/MovimientoBanco.js');
const { buscarCliente } = require('./clientesGp.js');

// "Bancos Cobranzas > Movimientos": persiste en Postgres (app propia, no GP) los
// movimientos de cada excel subido, buscando el cliente de GP para cada fila (igual que
// antes hacía controllers/procesarCobranzasBanco.js, ahora eliminado - esta es la
// continuación de esa lógica con persistencia agregada).
//
// Layout de columnas compartido por los 4 bancos implementados (confirmado contra excels
// reales de Credicoop/Francés/Provincia/Chubut): FECHA/CONCEPTO/IMPORTE/OBSERVACIONES/
// ESTADO. Si algún banco futuro trae otro layout, hay que generalizar esto (ver también
// el comentario de CUIT_EN_TEXTO_RE más abajo, que es el mismo regex ya validado contra
// los 4 bancos).
const BANCOS_IMPLEMENTADOS = ['credicoop', 'frances', 'provincia', 'chubut'];
const COL_FECHA = 0;
const COL_CONCEPTO = 1;
const COL_IMPORTE = 2;
const COL_OBSERVACIONES = 3;
const COL_ESTADO = 4;

// Mismo regex que procesarCobranzasBanco.js tenía: condición "no pegado a otro DÍGITO" en
// ninguna punta (no \b, porque letra-a-dígito no es un límite de palabra), confirmado
// contra los 4 bancos reales incluyendo el caso de Provincia que pega el CUIT directo
// contra la primera letra del nombre sin separador.
const CUIT_EN_TEXTO_RE = /(?<!\d)(\d{11})(?!\d)/;

// FECHA/IMPORTE del excel real son celdas de fecha/moneda genuinas de Excel, no texto -
// el cliente ahora las lee con `cellDates: true` + `raw: true` (ver leerExcelHojas.js)
// para no depender del formateador de SheetJS, que no respeta ni el formato con el que se
// ve la celda en Excel ni la zona horaria local (confirmado con un excel real: una fecha
// mostrada en Excel como "9/10/2026" llegaba, formateada por la librería, como "10/8/26" -
// mes/día invertido, año a 2 dígitos y UN DÍA MENOS). Con el cliente arreglado, una celda
// de fecha real llega acá como el string ISO que produce `JSON.stringify` de un Date de
// JS ("2026-10-09T00:00:00.000Z") y una celda de importe llega directo como número de JS.
// Se mantiene el parseo de texto como respaldo (D/M/AAAA o "D M AAAA", e IMPORTE con
// formato argentino "125.000,00") por si alguna fila viene cargada como texto en vez de
// como celda tipada.
const FECHA_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const FECHA_TEXTO_RE = /^(\d{1,2})[/\s]+(\d{1,2})[/\s]+(\d{4})$/;

const parsearFecha = (valorCrudo) => {
  const texto = String(valorCrudo ?? '').trim();
  const isoMatch = texto.match(FECHA_ISO_RE);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m}-${d}`;
  }
  const match = texto.match(FECHA_TEXTO_RE);
  if (!match) return null;
  const [, d, m, y] = match;
  const dd = d.padStart(2, '0');
  const mm = m.padStart(2, '0');
  if (Number(dd) < 1 || Number(dd) > 31 || Number(mm) < 1 || Number(mm) > 12) return null;
  return `${y}-${mm}-${dd}`;
};

const parsearImporte = (valorCrudo) => {
  if (typeof valorCrudo === 'number') {
    return Number.isFinite(valorCrudo) ? valorCrudo : null;
  }
  const texto = String(valorCrudo ?? '').trim();
  if (!texto) return null;
  const negativo = /^\(.*\)$/.test(texto) || texto.startsWith('-');
  const limpio = texto.replace(/^\(|\)$/g, '').replace(/^-/, '').replace(/\$/g, '').trim();
  const normalizado = limpio.replace(/\./g, '').replace(',', '.');
  if (!normalizado) return null;
  const numero = Number(normalizado);
  if (!Number.isFinite(numero)) return null;
  return negativo ? -numero : numero;
};

const calcularClaveFila = ({ banco, fecha, concepto, importe, observaciones }) =>
  crypto
    .createHash('md5')
    .update(`${banco}|${fecha}|${concepto}|${importe.toFixed(2)}|${observaciones || ''}`)
    .digest('hex');

// Parsea las filas crudas del excel (array de arrays, fila 0 = encabezado) a registros
// estructurados, buscando el cliente de GP para cada una. Si alguna fila tiene FECHA o
// IMPORTE que no se puede interpretar, NO se guarda nada - se rechaza el archivo entero
// con el detalle de qué filas y qué columna fallaron (mismo principio que los conflictos
// de detectarConflictos: nunca persistir a medias).
const parsearFilas = async ({ banco, filas }) => {
  if (!BANCOS_IMPLEMENTADOS.includes(banco)) {
    throw new Error(`El formato del banco "${banco}" todavía no está implementado`);
  }
  if (!Array.isArray(filas) || filas.length < 2) {
    throw new Error('filas (con encabezado) son requeridas');
  }

  const [, ...datos] = filas;
  const erroresFormato = [];

  const registros = await Promise.all(
    datos.map(async (fila, i) => {
      const numeroFila = i + 2; // +1 por encabezado, +1 porque el excel es 1-based
      const fechaCruda = fila[COL_FECHA];
      const importeCrudo = fila[COL_IMPORTE];
      const fecha = parsearFecha(fechaCruda);
      const importe = parsearImporte(importeCrudo);

      if (!fecha) erroresFormato.push({ numeroFila, columna: 'FECHA', valorCrudo: fechaCruda });
      if (importe === null) erroresFormato.push({ numeroFila, columna: 'IMPORTE', valorCrudo: importeCrudo });
      if (!fecha || importe === null) return null;

      const concepto = String(fila[COL_CONCEPTO] ?? '').trim();
      const observaciones = String(fila[COL_OBSERVACIONES] ?? '').trim();
      const estadoBanco = String(fila[COL_ESTADO] ?? '').trim() || null;
      const cuitMatch = concepto.match(CUIT_EN_TEXTO_RE);
      const match = await buscarCliente({ cuit: cuitMatch ? cuitMatch[1] : null, nombre: observaciones });

      return { numeroFila, fecha, concepto, importe, observaciones, estadoBanco, match };
    })
  );

  if (erroresFormato.length) {
    const error = new Error('Hay filas con fecha o importe que no se pudieron interpretar.');
    error.tipo = 'FORMATO_INVALIDO';
    error.errores = erroresFormato;
    throw error;
  }

  return registros;
};

// Dentro de un mismo excel, dos o más filas con la misma fecha+concepto+importe+
// observaciones quedan indistinguibles entre sí (es la misma clave natural que se usa
// para el upsert) - no se puede saber si es la misma operación repetida por error o dos
// operaciones reales iguales, así que se devuelven para que el usuario corrija el excel.
const detectarConflictos = (registros, banco) => {
  const grupos = new Map();
  registros.forEach((r) => {
    const clave = calcularClaveFila({ banco, fecha: r.fecha, concepto: r.concepto, importe: r.importe, observaciones: r.observaciones });
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(r);
  });
  return [...grupos.values()]
    .filter((grupo) => grupo.length > 1)
    .map((grupo) => ({
      fecha: grupo[0].fecha,
      concepto: grupo[0].concepto,
      importe: grupo[0].importe,
      filas: grupo.map((r) => r.numeroFila),
    }));
};

const datosDeMatch = (match) => {
  if (!match) return { estadoMatch: 'no_encontrado', custnmbrCalculado: null, candidatosAmbiguos: null };
  if (match.ambiguo) return { estadoMatch: 'varios', custnmbrCalculado: null, candidatosAmbiguos: match.ambiguo.join(',') };
  return { estadoMatch: 'identificado', custnmbrCalculado: match.custnmbr, candidatosAmbiguos: null };
};

// Upsert por claveFila: una fila nueva se inserta, una que ya existía (re-upload del
// mismo excel, o de uno con rango de fechas superpuesto) actualiza los campos calculados
// (por si cambió la base de clientes de GP) pero nunca toca custnmbrManual/usuarioManual/
// fechaManual - lo que el usuario ya resolvió a mano no se pierde al re-subir.
const subirMovimientos = async ({ banco, filas }) => {
  const registros = await parsearFilas({ banco, filas });

  const conflictos = detectarConflictos(registros, banco);
  if (conflictos.length) {
    const error = new Error('Hay filas que quedan indistinguibles entre sí dentro del mismo excel.');
    error.tipo = 'CONFLICTO_FILAS';
    error.conflictos = conflictos;
    throw error;
  }

  let insertados = 0;
  let actualizados = 0;

  for (const r of registros) {
    const claveFila = calcularClaveFila({ banco, fecha: r.fecha, concepto: r.concepto, importe: r.importe, observaciones: r.observaciones });
    const datosCalculados = datosDeMatch(r.match);
    const camposBase = {
      banco,
      fecha: r.fecha,
      concepto: r.concepto,
      importe: r.importe,
      observaciones: r.observaciones,
      estadoBanco: r.estadoBanco,
      ...datosCalculados,
    };

    const existente = await MovimientoBanco.findOne({ where: { claveFila } });
    if (existente) {
      await existente.update(camposBase);
      actualizados += 1;
    } else {
      await MovimientoBanco.create({ ...camposBase, claveFila });
      insertados += 1;
    }
  }

  return { totalFilas: registros.length, insertados, actualizados };
};

const MAX_ROWS = 20000;

const aPlano = (fila) => ({
  ...fila,
  importe: Number(fila.importe),
  pendiente: fila.estadoMatch !== 'identificado' && !fila.custnmbrManual,
});

const listarMovimientos = async ({ banco, desde, hasta, busqueda = '', soloFaltantes = false }) => {
  if (!banco || !desde || !hasta) {
    throw new Error('banco, desde y hasta son requeridos');
  }

  const filas = await MovimientoBanco.findAll({
    where: { banco, fecha: { [Op.between]: [desde, hasta] } },
    order: [['fecha', 'ASC'], ['id', 'ASC']],
    limit: MAX_ROWS,
    raw: true,
  });

  const conPendiente = filas.map(aPlano);
  const totalFaltantes = conPendiente.filter((f) => f.pendiente).length;

  const busquedaNorm = String(busqueda || '').trim().toLowerCase();
  const soloFaltantesBool = soloFaltantes === true || soloFaltantes === 'true';

  const filtradas = conPendiente
    .filter((f) => !busquedaNorm || [f.concepto, f.observaciones, f.custnmbrCalculado, f.custnmbrManual, f.candidatosAmbiguos]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(busquedaNorm))
    .filter((f) => !soloFaltantesBool || f.pendiente);

  return {
    filas: filtradas,
    totalFilas: filtradas.length,
    totalFaltantes,
    truncated: filas.length >= MAX_ROWS,
  };
};

const actualizarNumeroManual = async ({ id, custnmbrManual, usuario }) => {
  const movimiento = await MovimientoBanco.findByPk(id);
  if (!movimiento) {
    throw new Error('Movimiento no encontrado');
  }
  const valor = String(custnmbrManual || '').trim();
  await movimiento.update({
    custnmbrManual: valor || null,
    usuarioManual: valor ? usuario : null,
    fechaManual: valor ? new Date() : null,
  });
  return aPlano(movimiento.get({ plain: true }));
};

module.exports = { subirMovimientos, listarMovimientos, actualizarNumeroManual };
