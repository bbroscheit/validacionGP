const crypto = require('crypto');
const { Op } = require('sequelize');
const MovimientoBanco = require('../models/MovimientoBanco.js');
const { buscarCliente } = require('./clientesGp.js');

// "Bancos Cobranzas > Movimientos": persiste en Postgres (app propia, no GP) los
// movimientos de cada excel subido, buscando el cliente de GP para cada fila (igual que
// antes hacía controllers/procesarCobranzasBanco.js, ahora eliminado - esta es la
// continuación de esa lógica con persistencia agregada).
//
// Layout de columnas compartido por los 4 bancos "genéricos" (confirmado contra excels
// reales de Credicoop/Francés/Provincia/Chubut): FECHA/CONCEPTO/IMPORTE/OBSERVACIONES/
// ESTADO (ver también el comentario de CUIT_EN_TEXTO_RE más abajo, el mismo regex ya
// validado contra los 4). "echeq" (cheques de terceros) tiene un layout totalmente
// distinto - ver parsearFilasEcheq más abajo y la nota larga en el modelo.
const BANCOS_GENERICOS = ['credicoop', 'frances', 'provincia', 'chubut'];
const BANCOS_IMPLEMENTADOS = [...BANCOS_GENERICOS, 'echeq'];
const COL_FECHA = 0;
const COL_CONCEPTO = 1;
const COL_IMPORTE = 2;
const COL_OBSERVACIONES = 3;
const COL_ESTADO = 4;

const ECHEQ_COL_EMITIDO = 0;
const ECHEQ_COL_ENDOSADO = 1;
const ECHEQ_COL_BANCO_EMISOR = 2;
const ECHEQ_COL_FECHA_EMISION = 3;
const ECHEQ_COL_FECHA_PAGO = 4;
const ECHEQ_COL_MONTO = 5;
const ECHEQ_COL_NUMERO_CHEQUE = 6;
const ECHEQ_COL_CUIT = 7; // rotulada "Tipo de Documento" en el excel de origen, pero el dato real es el CUIT del emisor

const hoyIso = () => {
  const hoy = new Date();
  const yyyy = hoy.getFullYear();
  const mm = String(hoy.getMonth() + 1).padStart(2, '0');
  const dd = String(hoy.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// Mismo regex que procesarCobranzasBanco.js tenía: condición "no pegado a otro DÍGITO" en
// ninguna punta (no \b, porque letra-a-dígito no es un límite de palabra), confirmado
// contra los 4 bancos reales incluyendo el caso de Provincia que pega el CUIT directo
// contra la primera letra del nombre sin separador.
const CUIT_EN_TEXTO_RE = /(?<!\d)(\d{11})(?!\d)/;

// echeq SÍ trae el CUIT en una columna propia y dedicada (a diferencia de los 4 bancos
// genéricos, que lo tienen mezclado en CONCEPTO/OBSERVACIONES) - no hace falta el regex
// de arriba, alcanza con limpiar separadores (guiones/espacios) y validar los 11 dígitos.
const cuitDeColumnaDedicada = (valorCrudo) => {
  const soloDigitos = String(valorCrudo ?? '').replace(/\D/g, '');
  return soloDigitos.length === 11 ? soloDigitos : null;
};

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

// Cada registro ya sale de su parser (genérico o echeq) con su propia `claveFila`
// calculada - detectarConflictos/subirMovimientos la usan tal cual, sin recalcularla, así
// no hay riesgo de que las dos fórmulas (genérica/echeq) queden desincronizadas entre sí.
const calcularClaveFilaGenerica = ({ banco, fecha, concepto, importe, observaciones }) =>
  crypto
    .createHash('md5')
    .update(`${banco}|${fecha}|${concepto}|${importe.toFixed(2)}|${observaciones || ''}`)
    .digest('hex');

// Parsea las filas crudas del excel (array de arrays, fila 0 = encabezado) a registros
// estructurados, buscando el cliente de GP para cada una. Si alguna fila tiene FECHA o
// IMPORTE que no se puede interpretar, NO se guarda nada - se rechaza el archivo entero
// con el detalle de qué filas y qué columna fallaron (mismo principio que los conflictos
// de detectarConflictos: nunca persistir a medias).
const parsearFilasGenerico = async ({ banco, filas }) => {
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
      const claveFila = calcularClaveFilaGenerica({ banco, fecha, concepto, importe, observaciones });

      return { numeroFila, fecha, concepto, importe, observaciones, estadoBanco, match, claveFila };
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

// echeq (cheques de terceros): layout de columnas totalmente distinto a los 4 bancos
// genéricos - ver la nota larga en el modelo (MovimientoBanco.js) para el porqué de cada
// decisión (fecha = fecha de subida, CUIT en columna propia, clave natural sin la fecha).
// `fecha` queda fija en HOY (fecha de subida del archivo) porque el excel de e-cheq no
// trae una fecha de "movimiento" propia (a pedido del usuario) - por eso la clave natural
// NO puede incluir `fecha` (cambiaría en cada re-upload de un día distinto y duplicaría
// filas); se arma en cambio con N° de cheque + CUIT + monto + Fecha de Pago (intrínsecos
// al cheque, no al momento de subida).
const parsearFilasEcheq = async (filas) => {
  const [, ...datos] = filas;
  const erroresFormato = [];
  const hoy = hoyIso();

  const registros = await Promise.all(
    datos.map(async (fila, i) => {
      const numeroFila = i + 2;
      const fechaEmisionCruda = fila[ECHEQ_COL_FECHA_EMISION];
      const fechaPagoCruda = fila[ECHEQ_COL_FECHA_PAGO];
      const montoCrudo = fila[ECHEQ_COL_MONTO];
      const fechaEmision = parsearFecha(fechaEmisionCruda);
      const fechaPago = parsearFecha(fechaPagoCruda);
      const importe = parsearImporte(montoCrudo);

      if (!fechaEmision) erroresFormato.push({ numeroFila, columna: 'Fecha de emisión', valorCrudo: fechaEmisionCruda });
      if (!fechaPago) erroresFormato.push({ numeroFila, columna: 'Fecha de Pago', valorCrudo: fechaPagoCruda });
      if (importe === null) erroresFormato.push({ numeroFila, columna: 'Monto', valorCrudo: montoCrudo });
      if (!fechaEmision || !fechaPago || importe === null) return null;

      const emitidoPor = String(fila[ECHEQ_COL_EMITIDO] ?? '').trim();
      const endosadoPor = String(fila[ECHEQ_COL_ENDOSADO] ?? '').trim();
      const bancoEmisor = String(fila[ECHEQ_COL_BANCO_EMISOR] ?? '').trim();
      const numeroCheque = String(fila[ECHEQ_COL_NUMERO_CHEQUE] ?? '').trim();
      const cuitEcheq = cuitDeColumnaDedicada(fila[ECHEQ_COL_CUIT]);
      const match = await buscarCliente({ cuit: cuitEcheq, nombre: emitidoPor });
      const claveFila = crypto
        .createHash('md5')
        .update(`echeq|${numeroCheque}|${cuitEcheq || ''}|${importe.toFixed(2)}|${fechaPago}`)
        .digest('hex');

      return {
        numeroFila,
        fecha: hoy,
        concepto: `${emitidoPor} - cheque ${numeroCheque}`.trim(),
        importe,
        observaciones: [endosadoPor, bancoEmisor].filter(Boolean).join(' / '),
        estadoBanco: null,
        match,
        claveFila,
        emitidoPor,
        endosadoPor,
        bancoEmisor,
        fechaEmision,
        fechaPago,
        numeroCheque,
        cuitEcheq,
      };
    })
  );

  if (erroresFormato.length) {
    const error = new Error('Hay filas con fecha o monto que no se pudieron interpretar.');
    error.tipo = 'FORMATO_INVALIDO';
    error.errores = erroresFormato;
    throw error;
  }

  return registros;
};

// Dentro de un mismo excel, dos o más filas con la misma clave natural (fecha+concepto+
// importe+observaciones para bancos genéricos; N° de cheque+CUIT+monto+Fecha de Pago para
// echeq) quedan indistinguibles entre sí - no se puede saber si es la misma operación
// repetida por error o dos operaciones reales iguales, así que se devuelven para que el
// usuario corrija el excel.
const detectarConflictos = (registros) => {
  const grupos = new Map();
  registros.forEach((r) => {
    if (!grupos.has(r.claveFila)) grupos.set(r.claveFila, []);
    grupos.get(r.claveFila).push(r);
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
const CAMPOS_ECHEQ = ['emitidoPor', 'endosadoPor', 'bancoEmisor', 'fechaEmision', 'fechaPago', 'numeroCheque', 'cuitEcheq'];

const subirMovimientos = async ({ banco, filas }) => {
  if (!BANCOS_IMPLEMENTADOS.includes(banco)) {
    throw new Error(`El formato del banco "${banco}" todavía no está implementado`);
  }
  if (!Array.isArray(filas) || filas.length < 2) {
    throw new Error('filas (con encabezado) son requeridas');
  }

  const registros = banco === 'echeq' ? await parsearFilasEcheq(filas) : await parsearFilasGenerico({ banco, filas });

  const conflictos = detectarConflictos(registros);
  if (conflictos.length) {
    const error = new Error('Hay filas que quedan indistinguibles entre sí dentro del mismo excel.');
    error.tipo = 'CONFLICTO_FILAS';
    error.conflictos = conflictos;
    throw error;
  }

  let insertados = 0;
  let actualizados = 0;

  for (const r of registros) {
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
    if (banco === 'echeq') {
      CAMPOS_ECHEQ.forEach((campo) => { camposBase[campo] = r[campo]; });
    }

    const existente = await MovimientoBanco.findOne({ where: { claveFila: r.claveFila } });
    if (existente) {
      await existente.update(camposBase);
      actualizados += 1;
    } else {
      await MovimientoBanco.create({ ...camposBase, claveFila: r.claveFila });
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

const listarMovimientos = async ({ banco, desde, hasta, busqueda = '', soloFaltantes = false, filtroRecibo = '', sucursal = '' }) => {
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

  // La columna ESTADO del excel del banco, en la práctica, identifica la sucursal del
  // movimiento (ej. "MADRYN", "MDQ", "CENTRAL", "LA PAMPA"), no un estado de la
  // transacción - de ahí el desplegable para filtrar por sucursal en esa misma columna.
  // Se calcula sobre el rango de fechas completo (antes de aplicar busqueda/soloFaltantes/
  // filtroRecibo/sucursal), así las opciones del desplegable no cambian solo porque se
  // tocó otro filtro.
  const sucursalesDisponibles = [...new Set(conPendiente.map((f) => f.estadoBanco).filter(Boolean))].sort();

  const busquedaNorm = String(busqueda || '').trim().toLowerCase();
  const soloFaltantesBool = soloFaltantes === true || soloFaltantes === 'true';

  const filtradas = conPendiente
    .filter((f) => !busquedaNorm || [
      f.concepto, f.observaciones, f.custnmbrCalculado, f.custnmbrManual, f.candidatosAmbiguos,
      f.emitidoPor, f.endosadoPor, f.bancoEmisor, f.numeroCheque, f.cuitEcheq,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(busquedaNorm))
    .filter((f) => !soloFaltantesBool || f.pendiente)
    .filter((f) => !filtroRecibo || (filtroRecibo === 'si' ? f.reciboCreado : !f.reciboCreado))
    .filter((f) => !sucursal || f.estadoBanco === sucursal);

  return {
    filas: filtradas,
    totalFilas: filtradas.length,
    totalFaltantes,
    truncated: filas.length >= MAX_ROWS,
    sucursalesDisponibles,
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

const actualizarReciboCreado = async ({ id, reciboCreado, usuario }) => {
  const movimiento = await MovimientoBanco.findByPk(id);
  if (!movimiento) {
    throw new Error('Movimiento no encontrado');
  }
  await movimiento.update({
    reciboCreado: !!reciboCreado,
    usuarioRecibo: reciboCreado ? usuario : null,
    fechaRecibo: reciboCreado ? new Date() : null,
  });
  return aPlano(movimiento.get({ plain: true }));
};

const MONTOS_RETENCION = ['montoGanancias', 'montoIIBB', 'montoIIBBCaba', 'montoIVA', 'montoSUSS', 'montoOtra'];

// Campos de retención que cada sucursal completa a mano (ver nota en el modelo). Si
// retencion='no' se fuerza a null los 6 montos del lado del servidor, sin importar qué
// mande el cliente - así el dato queda consistente aunque el frontend tenga algún bug y
// los mande igual estando deshabilitados.
const actualizarRetencion = async ({ id, retencion, facturaAplicar, montos = {}, usuario }) => {
  const movimiento = await MovimientoBanco.findByPk(id);
  if (!movimiento) {
    throw new Error('Movimiento no encontrado');
  }
  const valorRetencion = retencion === 'si' || retencion === 'no' ? retencion : null;
  const camposMonto = {};
  MONTOS_RETENCION.forEach((campo) => {
    if (valorRetencion === 'no') {
      camposMonto[campo] = null;
      return;
    }
    const crudo = montos[campo];
    camposMonto[campo] = crudo === '' || crudo === undefined || crudo === null ? null : Number(crudo);
  });

  await movimiento.update({
    retencion: valorRetencion,
    facturaAplicar: String(facturaAplicar || '').trim() || null,
    ...camposMonto,
    usuarioRetencion: usuario,
    fechaRetencion: new Date(),
  });
  return aPlano(movimiento.get({ plain: true }));
};

module.exports = { subirMovimientos, listarMovimientos, actualizarNumeroManual, actualizarReciboCreado, actualizarRetencion };
