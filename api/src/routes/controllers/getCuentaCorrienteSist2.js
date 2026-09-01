const { getGpPoolSist2, sql } = require('../../config/gpPool');

// Reporte - Cuenta corriente de cliente (solo sist2)
// Fuente: RM20101 (Receivables Management) tiene UNA fila por cada movimiento real que
// afecta la deuda del cliente (factura, nota de crédito/devolución, recibo, cargo
// financiero) - es el mismo dato que usa GP para su propia consulta de "Transacciones
// de clientes". Confirmado que en esta instalación NUNCA se corre el proceso de "quitar
// historial" de GP (RM30101/RM30201, las tablas de historial, dan 0 filas siempre) - así
// que RM20101 sola tiene el 100% del historial, no hace falta unir con ninguna otra
// tabla de movimientos.
//
// OJO: no cruzar esto contra GL20000 esperando que cierre - GL20000 (la contabilidad)
// en esta instalación solo tiene detalle desde el 02/06/2026 en adelante (~3 meses),
// mientras que RM20101 tiene movimientos reales desde febrero/2026 (confirmado: el
// saldo neto de TODOS los clientes en RM20101 no coincide ni de cerca con el saldo de
// la cuenta 113110-01-000 en GL20000 - $66,2M contra $19,8M - exactamente por esta
// diferencia de ventana, no por un error de datos). Es normal en GP que el subdiario de
// Clientes retenga el historial completo aunque el mayor contable tenga una ventana más
// corta - por eso el saldo inicial de este reporte usa RM20101 y NO tiene forma (ni
// falta) de cruzarse contra la contabilidad para una fecha anterior a junio/2026.
//
// RMDTYPAL (tipo de documento) - visto en datos reales de sist2, códigos y su efecto en
// el saldo (ORTRXAMT viene siempre en positivo, el signo lo da el tipo):
//   1 = Factura                    -> aumenta la deuda (Debe)
//   2 = Nota de Débito             -> aumenta la deuda (Debe)  [no visto en sist2 todavía]
//   3 = Cargo financiero (interés) -> aumenta la deuda (Debe)
//   4 = Servicio/Reparación        -> aumenta la deuda (Debe)  [no visto en sist2 todavía]
//   5 = Garantía                   -> aumenta la deuda (Debe)  [no visto en sist2 todavía]
//   6 = Nota de Crédito            -> disminuye la deuda (Haber) [no visto en sist2 todavía]
//   7 = Devolución                 -> disminuye la deuda (Haber)
//   8 = Devolución (SOP, post-03/07)-> disminuye la deuda (Haber) - código propio de esta
//       instalación para devoluciones cargadas desde el módulo de Ventas después del
//       cambio de nomenclatura (confirmado 1:1 contra SOP30200.SOPTYPE=4 para todos los
//       casos con documento encontrado ahí).
//   9 = Recibo (cobranza)          -> disminuye la deuda (Haber)
// Confirmado además que NO hace falta cruzar contra SOP30200 para desambiguar: los casos
// donde un mismo número de comprobante existe dos veces en SOP30200 (Factura y
// Devolución con la serie pisada, ver getVentasPorSucursalCuenta.js) tienen igual UNA
// sola fila en RM20101 cada uno, con el RMDTYPAL correcto - el "cruce" que parecía dar
// resultados contradictorios era nada más un artefacto de JOIN sin desambiguar por
// SOPTYPE, RM20101 solo (sin join) ya viene bien.
const RMDTYPAL_SIGNO = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: -1, 7: -1, 8: -1, 9: -1 };
const RMDTYPAL_LABEL = {
  1: 'Factura', 2: 'Nota de Débito', 3: 'Cargo Financiero', 4: 'Servicio/Reparación',
  5: 'Garantía', 6: 'Nota de Crédito', 7: 'Devolución', 8: 'Devolución', 9: 'Recibo',
};

const MAX_ROWS = 20000;

// Sin cliente elegido: listado de TODOS los clientes con movimientos, cada uno con su
// propia tabla de documentos (Fecha, Documento, Monto, Saldo corrido) - a pedido del
// usuario, para poder ver el detalle de todos sin tener que entrar cliente por cliente.
// Se arma acá completo (sin paginar) - el paginado de a 10 clientes es solo de
// presentación en el frontend, así el Excel puede exportar siempre todo.
// Una sola query trae todo RM20101 (2074 filas en total en sist2, no hay problema de
// volumen) y se agrupa por cliente en JS con la misma lógica de signo que el detalle
// individual.
const listadoClientes = async (pool, desde, hasta) => {
  const result = await pool.request().query(`
    SELECT LTRIM(RTRIM(R.CUSTNMBR)) AS CUSTNMBR, LTRIM(RTRIM(C.CUSTNAME)) AS CUSTNAME,
      LTRIM(RTRIM(R.DOCNUMBR)) AS Documento, R.RMDTYPAL, R.DOCDATE, R.ORTRXAMT
    FROM RM20101 AS R
    INNER JOIN RM00101 AS C ON C.CUSTNMBR = R.CUSTNMBR
    WHERE ISNULL(R.VOIDSTTS, 0) = 0
    ORDER BY R.CUSTNMBR ASC, R.DOCDATE ASC, R.DOCNUMBR ASC
  `);

  const porCliente = new Map();
  result.recordset.forEach((row) => {
    const signo = RMDTYPAL_SIGNO[row.RMDTYPAL];
    const monto = signo === undefined ? 0 : signo * row.ORTRXAMT;
    if (!porCliente.has(row.CUSTNMBR)) {
      porCliente.set(row.CUSTNMBR, { CUSTNMBR: row.CUSTNMBR, CUSTNAME: row.CUSTNAME, previos: [], enRango: [] });
    }
    const c = porCliente.get(row.CUSTNMBR);
    const item = { Fecha: row.DOCDATE, Documento: row.Documento, Monto: monto };
    if (desde && row.DOCDATE < desde) {
      c.previos.push(item);
    } else if (!hasta || row.DOCDATE <= hasta) {
      c.enRango.push(item);
    }
    // movimientos posteriores a "hasta" no cuentan para el saldo a esa fecha - se ignoran.
  });

  const clientes = [...porCliente.values()]
    .map((c) => {
      const saldoInicial = c.previos.reduce((acc, m) => acc + m.Monto, 0);
      let saldoCorrido = saldoInicial;
      const movimientos = c.enRango.map((m) => {
        saldoCorrido += m.Monto;
        return { Fecha: m.Fecha, Documento: m.Documento, Monto: m.Monto, Saldo: saldoCorrido };
      });
      return {
        CUSTNMBR: c.CUSTNMBR, CUSTNAME: c.CUSTNAME,
        saldoInicial, movimientos, saldoFinal: saldoCorrido,
      };
    })
    .filter((c) => Math.abs(c.saldoInicial) > 0.004 || c.movimientos.length > 0)
    .sort((a, b) => b.saldoFinal - a.saldoFinal);

  return {
    modo: 'listado',
    clientes,
    columns: ['Fecha', 'Documento', 'Monto', 'Saldo'],
  };
};

const getCuentaCorrienteSist2 = async ({ cliente, fechaDesde, fechaHasta }) => {
  const pool = await getGpPoolSist2();
  const desdeListado = fechaDesde ? new Date(fechaDesde) : null;
  const hastaListado = fechaHasta ? new Date(fechaHasta) : null;

  if (!cliente || !cliente.trim()) {
    return listadoClientes(pool, desdeListado, hastaListado);
  }
  const clienteTrim = cliente.trim();

  const clienteRequest = pool.request();
  clienteRequest.input('cliente', sql.VarChar(15), clienteTrim);
  const clienteResult = await clienteRequest.query(`
    SELECT LTRIM(RTRIM(CUSTNMBR)) AS CUSTNMBR, LTRIM(RTRIM(CUSTNAME)) AS CUSTNAME
    FROM RM00101 WHERE LTRIM(RTRIM(CUSTNMBR)) = @cliente
  `);
  if (clienteResult.recordset.length === 0) {
    throw new Error(`No se encontró el cliente "${clienteTrim}"`);
  }
  const clienteInfo = clienteResult.recordset[0];

  const movRequest = pool.request();
  movRequest.input('cliente', sql.VarChar(15), clienteTrim);
  const movResult = await movRequest.query(`
    SELECT TOP (${MAX_ROWS})
      LTRIM(RTRIM(DOCNUMBR)) AS Documento, RMDTYPAL, DOCDATE, ORTRXAMT
    FROM RM20101
    WHERE LTRIM(RTRIM(CUSTNMBR)) = @cliente AND ISNULL(VOIDSTTS, 0) = 0
    ORDER BY DOCDATE ASC, DOCNUMBR ASC
  `);

  const movimientosTodos = movResult.recordset.map((row) => {
    const signo = RMDTYPAL_SIGNO[row.RMDTYPAL];
    if (signo === undefined) {
      // Tipo de documento no contemplado (no visto todavía en datos reales) - se deja
      // en 0 en vez de arriesgar un signo incorrecto, y se marca para que se note.
      return { ...row, Monto: 0, TipoMovimiento: `RMDTYPAL ${row.RMDTYPAL} (desconocido)` };
    }
    return { ...row, Monto: signo * row.ORTRXAMT, TipoMovimiento: RMDTYPAL_LABEL[row.RMDTYPAL] };
  });

  const desde = fechaDesde ? new Date(fechaDesde) : null;
  const hasta = fechaHasta ? new Date(fechaHasta) : null;

  const saldoInicial = movimientosTodos
    .filter((m) => desde && m.DOCDATE < desde)
    .reduce((acc, m) => acc + m.Monto, 0);

  const enRango = movimientosTodos.filter((m) => (
    (!desde || m.DOCDATE >= desde) && (!hasta || m.DOCDATE <= hasta)
  ));

  let saldoCorrido = saldoInicial;
  const movimientos = enRango.map((m) => {
    saldoCorrido += m.Monto;
    return {
      Fecha: m.DOCDATE,
      Tipo: m.TipoMovimiento,
      Documento: m.Documento,
      Debe: m.Monto > 0 ? m.Monto : 0,
      Haber: m.Monto < 0 ? -m.Monto : 0,
      Saldo: saldoCorrido,
    };
  });

  return {
    modo: 'detalle',
    cliente: clienteInfo,
    saldoInicial,
    saldoFinal: movimientos.length > 0 ? movimientos[movimientos.length - 1].Saldo : saldoInicial,
    movimientos,
    columns: ['Fecha', 'Tipo', 'Documento', 'Debe', 'Haber', 'Saldo'],
    truncated: movResult.recordset.length >= MAX_ROWS,
  };
};

module.exports = getCuentaCorrienteSist2;
