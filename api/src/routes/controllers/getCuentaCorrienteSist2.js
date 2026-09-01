const { getGpPoolSist2, sql } = require('../../config/gpPool');
const { resolverSucursalSist2, bindInList } = require('../../services/sist2Ventas');

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
// Confirmado además que NO hace falta cruzar contra SOP30200 para desambiguar el SIGNO:
// los casos donde un mismo número de comprobante existe dos veces en SOP30200 (Factura y
// Devolución con la serie pisada, ver getVentasPorSucursalCuenta.js) tienen igual UNA
// sola fila en RM20101 cada uno, con el RMDTYPAL correcto - el "cruce" que parecía dar
// resultados contradictorios era nada más un artefacto de JOIN sin desambiguar por
// SOPTYPE, RM20101 solo (sin join) ya viene bien. El cruce contra SOP30200 SÍ hace falta
// para el filtro de SUCURSAL (ver atribuirSucursales más abajo) - ahí se desambigua bien
// buscando el SOPTYPE esperado según RMDTYPAL, así no repite el problema de fan-out.
const RMDTYPAL_SIGNO = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: -1, 7: -1, 8: -1, 9: -1 };
const RMDTYPAL_LABEL = {
  1: 'Factura', 2: 'Nota de Débito', 3: 'Cargo Financiero', 4: 'Servicio/Reparación',
  5: 'Garantía', 6: 'Nota de Crédito', 7: 'Devolución', 8: 'Devolución', 9: 'Recibo',
};
const tipoDeMovimiento = (rmdtypal) => RMDTYPAL_LABEL[rmdtypal] ?? `RMDTYPAL ${rmdtypal} (desconocido)`;

const MAX_ROWS = 20000;
const LOTE_MAXIMO = 1500; // margen bajo el límite de ~2100 parámetros por query de SQL Server

// Trae en varias tandas si hace falta (listas largas, ej. el listado completo de todos
// los clientes puede referenciar >1000 comprobantes distintos).
const fetchEnLotes = async (pool, armarQuery, valores, prefix) => {
  if (valores.length === 0) return [];
  const resultados = [];
  for (let i = 0; i < valores.length; i += LOTE_MAXIMO) {
    const lote = valores.slice(i, i + LOTE_MAXIMO);
    const request = pool.request();
    const lista = bindInList(request, prefix, lote);
    // eslint-disable-next-line no-await-in-loop
    const result = await request.query(armarQuery(lista));
    resultados.push(...result.recordset);
  }
  return resultados;
};

// Atribuye cada movimiento (fila de RM20101, ya con Monto con signo) a una o más
// sucursales - a pedido del usuario, reutilizando exactamente los mismos métodos ya
// usados en otros reportes:
//   - Factura/Devolución (RMDTYPAL 1/7/8): se busca el comprobante en SOP30200 (con el
//     SOPTYPE esperado según el tipo - 3 para Factura, 4 para Devolución, para no caer
//     en el fan-out de números repetidos) y se resuelve con resolverSucursalSist2 (misma
//     lógica que los reportes de Ventas: PHONE3 -> DOCID -> ficha del cliente DE LA
//     FACTURA).
//   - Recibo (RMDTYPAL 9): igual que en getCobranzasSist2.js - se busca a qué factura(s)
//     está aplicado (RM20201) y se prorratea el monto por aplicación; lo que no se pueda
//     atar a una factura resuelta cae en la ficha del cliente DEL RECIBO.
//     EXCEPCIÓN - `modoPendiente`: en modo "montos pendientes" el Monto de un recibo ya
//     es su saldo SIN aplicar (CURTRXAM, ver más abajo) - las líneas de RM20201 son la
//     parte YA aplicada (lo contrario de lo que se quiere mostrar), así que no
//     corresponde prorratear por factura: todo el saldo sin aplicar va directo a la
//     ficha del cliente del recibo.
//   - Cualquier otro tipo (Nota de Débito/Crédito, Cargo Financiero, etc. - no se ven
//     todavía en sist2, no tienen comprobante en SOP30200) - directo a la ficha del
//     cliente del movimiento.
// Cada fila queda con `.atribuciones = [{ Sucursal, Monto }, ...]` que suman el Monto
// original de la fila - puede ser más de una si un recibo se aplicó a facturas de más
// de una sucursal.
const atribuirSucursales = async (pool, rows, modoPendiente) => {
  const reciboRows = modoPendiente ? [] : rows.filter((r) => r.RMDTYPAL === 9);
  const documentoRows = rows.filter((r) => r.RMDTYPAL === 1 || r.RMDTYPAL === 7 || r.RMDTYPAL === 8);

  const reciboDocs = [...new Set(reciboRows.map((r) => r.Documento))];
  const applyRows = await fetchEnLotes(pool, (lista) => `
    SELECT LTRIM(RTRIM(APFRDCNM)) AS Recibo, LTRIM(RTRIM(APTODCNM)) AS Factura, APPTOAMT
    FROM RM20201 WHERE LTRIM(RTRIM(APFRDCNM)) IN (${lista}) AND APTODCTY = 1
  `, reciboDocs, 'r');
  const applyLinesByRecibo = new Map();
  applyRows.forEach((row) => {
    if (!applyLinesByRecibo.has(row.Recibo)) applyLinesByRecibo.set(row.Recibo, []);
    applyLinesByRecibo.get(row.Recibo).push(row);
  });

  const sopNums = [...new Set([
    ...documentoRows.map((r) => r.Documento),
    ...applyRows.map((r) => r.Factura),
  ])];
  const sopRows = await fetchEnLotes(pool, (lista) => `
    SELECT LTRIM(RTRIM(SOPNUMBE)) AS SOPNUMBE, SOPTYPE, NULLIF(LTRIM(RTRIM(PHONE3)), '') AS PHONE3,
      LTRIM(RTRIM(DOCID)) AS DOCID, LTRIM(RTRIM(CUSTNMBR)) AS CUSTNMBR
    FROM SOP30200 WHERE LTRIM(RTRIM(SOPNUMBE)) IN (${lista}) AND SOPTYPE IN (3, 4)
  `, sopNums, 's');
  const invoiceMap = new Map();
  sopRows.forEach((row) => {
    const key = `${row.SOPNUMBE}|${row.SOPTYPE}`;
    if (!invoiceMap.has(key)) invoiceMap.set(key, row);
  });

  const clientesNecesarios = new Set(rows.map((r) => r.CUSTNMBR));
  invoiceMap.forEach((inv) => { if (inv.CUSTNMBR) clientesNecesarios.add(inv.CUSTNMBR); });
  const clienteRows = await fetchEnLotes(pool, (lista) => `
    SELECT LTRIM(RTRIM(CUSTNMBR)) AS CUSTNMBR, USERDEF2 FROM RM00101 WHERE LTRIM(RTRIM(CUSTNMBR)) IN (${lista})
  `, [...clientesNecesarios].filter(Boolean), 'c');
  const userdef2PorCliente = new Map();
  clienteRows.forEach((row) => userdef2PorCliente.set(row.CUSTNMBR, row.USERDEF2));

  const sucursalDeCliente = (custnmbr) => resolverSucursalSist2({
    phone3: null, docid: null, clienteUserdef2: userdef2PorCliente.get(custnmbr),
  });

  rows.forEach((row) => {
    if (row.RMDTYPAL === 9 && modoPendiente) {
      row.atribuciones = [{ Sucursal: sucursalDeCliente(row.CUSTNMBR), Monto: row.Monto }];
      return;
    }

    if (row.RMDTYPAL === 9) {
      const lineas = applyLinesByRecibo.get(row.Documento) || [];
      let sumResuelto = 0;
      const atribuciones = [];
      lineas.forEach((linea) => {
        const factura = invoiceMap.get(`${linea.Factura}|3`);
        if (!factura) return;
        const sucursal = resolverSucursalSist2({
          phone3: factura.PHONE3, docid: factura.DOCID, clienteUserdef2: userdef2PorCliente.get(factura.CUSTNMBR),
        });
        if (!sucursal) return;
        sumResuelto += linea.APPTOAMT;
        atribuciones.push({ Sucursal: sucursal, Monto: -linea.APPTOAMT });
      });
      const residual = row.Monto + sumResuelto;
      if (Math.abs(residual) > 0.004) {
        atribuciones.push({ Sucursal: sucursalDeCliente(row.CUSTNMBR), Monto: residual });
      }
      row.atribuciones = atribuciones;
      return;
    }

    if (row.RMDTYPAL === 1 || row.RMDTYPAL === 7 || row.RMDTYPAL === 8) {
      const tipoEsperado = row.RMDTYPAL === 1 ? 3 : 4;
      const factura = invoiceMap.get(`${row.Documento}|${tipoEsperado}`);
      const sucursal = factura
        ? resolverSucursalSist2({ phone3: factura.PHONE3, docid: factura.DOCID, clienteUserdef2: userdef2PorCliente.get(factura.CUSTNMBR) })
        : null;
      row.atribuciones = [{ Sucursal: sucursal || sucursalDeCliente(row.CUSTNMBR), Monto: row.Monto }];
      return;
    }

    row.atribuciones = [{ Sucursal: sucursalDeCliente(row.CUSTNMBR), Monto: row.Monto }];
  });
};

// "Montos pendientes": en vez del monto original del documento (ORTRXAMT), usa el
// saldo TODAVÍA sin saldar de ese documento puntual (CURTRXAM - lo actualiza GP mismo
// cada vez que se aplica un pago) y descarta los que ya están en $0. OJO: CURTRXAM es
// una foto de HOY, no de la fecha "hasta" elegida - un documento viejo que se terminó
// de pagar hoy ya no va a aparecer, aunque el rango de fechas incluya el momento en que
// todavía estaba pendiente (confirmado con el usuario que es el comportamiento
// esperado: "saldo pendiente a hoy", no una foto histórica - GP no la guarda acá).
const filtrarPendientes = (rows) => rows
  .map((row) => {
    const signo = RMDTYPAL_SIGNO[row.RMDTYPAL];
    return { ...row, Monto: signo === undefined ? 0 : signo * row.CURTRXAM };
  })
  .filter((row) => Math.abs(row.Monto) > 0.004);

// Arma el ledger (saldo inicial + movimientos con saldo corrido) a partir de filas ya
// resueltas {CUSTNMBR, CUSTNAME, Documento, DOCDATE, Monto, TipoMovimiento?}. Si viene
// `sucursalFiltro`, primero se llama a atribuirSucursales y se reemplaza el Monto de
// cada fila por la porción atribuida a esa sucursal (0 si no le corresponde nada - esas
// filas se descartan, un documento que no es de la sucursal elegida no debe aparecer).
const resolverMontosPorSucursal = async (pool, rows, sucursalFiltro, modoPendiente) => {
  if (!sucursalFiltro) return rows;
  await atribuirSucursales(pool, rows, modoPendiente);
  return rows
    .map((row) => ({
      ...row,
      Monto: row.atribuciones.filter((a) => a.Sucursal === sucursalFiltro).reduce((acc, a) => acc + a.Monto, 0),
    }))
    .filter((row) => Math.abs(row.Monto) > 0.004);
};

// Sin cliente elegido: listado de TODOS los clientes con movimientos, cada uno con su
// propia tabla de documentos (Fecha, Documento, Monto, Saldo corrido) - a pedido del
// usuario, para poder ver el detalle de todos sin tener que entrar cliente por cliente.
// Se arma acá completo (sin paginar) - el paginado de a 10 clientes es solo de
// presentación en el frontend, así el Excel puede exportar siempre todo.
const listadoClientes = async (pool, desde, hasta, sucursalFiltro, pendientes) => {
  const result = await pool.request().query(`
    SELECT LTRIM(RTRIM(R.CUSTNMBR)) AS CUSTNMBR, LTRIM(RTRIM(C.CUSTNAME)) AS CUSTNAME,
      LTRIM(RTRIM(R.DOCNUMBR)) AS Documento, R.RMDTYPAL, R.DOCDATE, R.ORTRXAMT, R.CURTRXAM
    FROM RM20101 AS R
    INNER JOIN RM00101 AS C ON C.CUSTNMBR = R.CUSTNMBR
    WHERE ISNULL(R.VOIDSTTS, 0) = 0
  `);

  const rowsFirmadas = pendientes
    ? filtrarPendientes(result.recordset)
    : result.recordset.map((row) => {
      const signo = RMDTYPAL_SIGNO[row.RMDTYPAL];
      return { ...row, Monto: signo === undefined ? 0 : signo * row.ORTRXAMT };
    });
  const rows = await resolverMontosPorSucursal(pool, rowsFirmadas, sucursalFiltro, pendientes);

  const porCliente = new Map();
  rows.forEach((row) => {
    if (!porCliente.has(row.CUSTNMBR)) {
      porCliente.set(row.CUSTNMBR, { CUSTNMBR: row.CUSTNMBR, CUSTNAME: row.CUSTNAME, previos: [], enRango: [] });
    }
    const c = porCliente.get(row.CUSTNMBR);
    const item = { Fecha: row.DOCDATE, Tipo: tipoDeMovimiento(row.RMDTYPAL), Documento: row.Documento, Monto: row.Monto };
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
        return {
          Fecha: m.Fecha, Tipo: m.Tipo, Documento: m.Documento,
          Debe: m.Monto > 0 ? m.Monto : 0, Haber: m.Monto < 0 ? -m.Monto : 0,
          Saldo: saldoCorrido,
        };
      });
      return {
        CUSTNMBR: c.CUSTNMBR, CUSTNAME: c.CUSTNAME,
        saldoInicial, movimientos, saldoFinal: saldoCorrido,
      };
    })
    // Si se filtró por sucursal, un cliente sin ningún documento de esa sucursal (ni
    // antes ni durante el rango) no debe mostrarse - a pedido del usuario.
    .filter((c) => Math.abs(c.saldoInicial) > 0.004 || c.movimientos.length > 0)
    .sort((a, b) => b.saldoFinal - a.saldoFinal);

  return {
    modo: 'listado',
    clientes,
    columns: ['Fecha', 'Tipo', 'Documento', 'Debe', 'Haber', 'Saldo'],
  };
};

const getCuentaCorrienteSist2 = async ({ cliente, fechaDesde, fechaHasta, sucursal, pendientes }) => {
  const pool = await getGpPoolSist2();
  const desdeListado = fechaDesde ? new Date(fechaDesde) : null;
  const hastaListado = fechaHasta ? new Date(fechaHasta) : null;
  const sucursalFiltro = sucursal && sucursal.trim() ? sucursal.trim() : null;
  const pendientesBool = pendientes === true || pendientes === 'true';

  if (!cliente || !cliente.trim()) {
    return listadoClientes(pool, desdeListado, hastaListado, sucursalFiltro, pendientesBool);
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
      LTRIM(RTRIM(CUSTNMBR)) AS CUSTNMBR, LTRIM(RTRIM(DOCNUMBR)) AS Documento, RMDTYPAL, DOCDATE, ORTRXAMT, CURTRXAM
    FROM RM20101
    WHERE LTRIM(RTRIM(CUSTNMBR)) = @cliente AND ISNULL(VOIDSTTS, 0) = 0
    ORDER BY DOCDATE ASC, DOCNUMBR ASC
  `);

  const conTipo = (rows) => rows.map((row) => ({ ...row, TipoMovimiento: tipoDeMovimiento(row.RMDTYPAL) }));
  const movimientosFirmados = pendientesBool
    ? conTipo(filtrarPendientes(movResult.recordset))
    : conTipo(movResult.recordset.map((row) => {
      const signo = RMDTYPAL_SIGNO[row.RMDTYPAL];
      // Tipo de documento no contemplado (no visto todavía en datos reales) - se deja
      // en 0 en vez de arriesgar un signo incorrecto, y se marca para que se note.
      return { ...row, Monto: signo === undefined ? 0 : signo * row.ORTRXAMT };
    }));
  const movimientosTodos = await resolverMontosPorSucursal(pool, movimientosFirmados, sucursalFiltro, pendientesBool);

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
      Tipo: m.TipoMovimiento ?? '',
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
