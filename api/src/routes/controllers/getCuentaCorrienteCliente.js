const { getGpPoolEcobahia, sql } = require('../../config/gpPool');
const { coincideSucursal } = require('../../services/autorizacion');
const { getOverridesMap } = require('../../services/clasificacionOverrides');
const getSucursalesVentas = require('./getSucursalesVentas.js');

// Reporte - Cuenta corriente de cliente (Ecobahia / "sistema 1", menú "Ventas").
// Port de getCuentaCorrienteSist2.js, simplificado: acá PHONE3 solo ya alcanza para
// resolver la sucursal de un comprobante (confirmado, mismo criterio que
// getVentasPorSucursal.js) - no hace falta la cadena de fallback PHONE3->DOCID->USERDEF2
// que necesita sist2 (de hecho RM00101.USERDEF2 está SIEMPRE vacío en Ecobahia,
// confirmado contra PRD08 - no serviría como fallback ni aunque se portara). Se reusa el
// mismo override manual que ya usa "Ventas por sucursal" (Postgres,
// clasificacionOverrides.js, tipo 'sucursal') para cuando PHONE3 viene vacío o mal
// cargado en un comprobante puntual - una corrección ya hecha ahí corrige también acá.
//
// Fuente: RM20101 (Receivables) - confirmado igual que en sist2: en esta instalación
// nunca se corre el proceso de "quitar historial" de GP (RM30101/RM30201 dan 0 filas, ya
// confirmado contra PRD08), así que RM20101 sola tiene el 100% del historial del cliente.
// RMDTYPAL (tipo de documento) - mismos códigos y mismo signo que sist2 (ver
// getCuentaCorrienteSist2.js para el detalle completo de cada código, confirmado también
// contra datos reales de PRD08: se ven 1/3/7/8/9, el resto no apareció todavía).
const RMDTYPAL_SIGNO = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: -1, 7: -1, 8: -1, 9: -1 };
const RMDTYPAL_LABEL = {
  1: 'Factura', 2: 'Nota de Débito', 3: 'Cargo Financiero', 4: 'Servicio/Reparación',
  5: 'Garantía', 6: 'Nota de Crédito', 7: 'Devolución', 8: 'Devolución', 9: 'Recibo',
};
const tipoDeMovimiento = (rmdtypal) => RMDTYPAL_LABEL[rmdtypal] ?? `RMDTYPAL ${rmdtypal} (desconocido)`;

const MAX_ROWS = 20000;
const LOTE_MAXIMO = 1500; // margen bajo el límite de ~2100 parámetros por query de SQL Server

const bindInList = (request, prefix, values) => values
  .map((value, i) => {
    const name = `${prefix}${i}`;
    request.input(name, sql.VarChar(75), value);
    return `@${name}`;
  })
  .join(',');

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

// Atribuye cada movimiento (fila de RM20101, ya con Monto con signo) a una sucursal -
// misma lógica que atribuirSucursales en getCuentaCorrienteSist2.js, sin la parte de
// DOCID/USERDEF2 (no aplica a Ecobahia). Una fila que no se puede atar a ningún
// comprobante de Ventas (ej. Cargo Financiero, o el resto de un Recibo que no se pudo
// aplicar a ninguna factura resuelta) queda con Sucursal null - no entra en ningún filtro
// de sucursal puntual (ni aparece bajo "Completo" porque ese modo no pasa por acá, ver
// resolverMontosPorSucursal).
const atribuirSucursales = async (pool, rows, modoPendiente, overridesMap) => {
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
    SELECT LTRIM(RTRIM(SOPNUMBE)) AS SOPNUMBE, SOPTYPE, NULLIF(LTRIM(RTRIM(PHONE3)), '') AS PHONE3
    FROM SOP30200 WHERE LTRIM(RTRIM(SOPNUMBE)) IN (${lista}) AND SOPTYPE IN (3, 4)
  `, sopNums, 's');
  const invoiceMap = new Map();
  sopRows.forEach((row) => {
    const key = `${row.SOPNUMBE}|${row.SOPTYPE}`;
    if (!invoiceMap.has(key)) invoiceMap.set(key, row);
  });

  const sucursalDeFactura = (documento, tipoEsperado) => {
    const factura = invoiceMap.get(`${documento}|${tipoEsperado}`);
    if (!factura) return null;
    return overridesMap.get(documento) || factura.PHONE3 || null;
  };

  rows.forEach((row) => {
    if (row.RMDTYPAL === 9 && modoPendiente) {
      row.atribuciones = [{ Sucursal: null, Monto: row.Monto }];
      return;
    }

    if (row.RMDTYPAL === 9) {
      const lineas = applyLinesByRecibo.get(row.Documento) || [];
      let sumResuelto = 0;
      const atribuciones = [];
      lineas.forEach((linea) => {
        const sucursal = sucursalDeFactura(linea.Factura, 3);
        if (!sucursal) return;
        sumResuelto += linea.APPTOAMT;
        atribuciones.push({ Sucursal: sucursal, Monto: -linea.APPTOAMT });
      });
      const residual = row.Monto + sumResuelto;
      if (Math.abs(residual) > 0.004) {
        atribuciones.push({ Sucursal: null, Monto: residual });
      }
      row.atribuciones = atribuciones;
      return;
    }

    if (row.RMDTYPAL === 1 || row.RMDTYPAL === 7 || row.RMDTYPAL === 8) {
      const tipoEsperado = row.RMDTYPAL === 1 ? 3 : 4;
      row.atribuciones = [{ Sucursal: sucursalDeFactura(row.Documento, tipoEsperado), Monto: row.Monto }];
      return;
    }

    row.atribuciones = [{ Sucursal: null, Monto: row.Monto }];
  });
};

const filtrarPendientes = (rows) => rows
  .map((row) => {
    const signo = RMDTYPAL_SIGNO[row.RMDTYPAL];
    return { ...row, Monto: signo === undefined ? 0 : signo * row.CURTRXAM };
  })
  .filter((row) => Math.abs(row.Monto) > 0.004);

const resolverMontosPorSucursal = async (pool, rows, sucursalFiltro, modoPendiente, overridesMap) => {
  if (!sucursalFiltro) return rows;
  await atribuirSucursales(pool, rows, modoPendiente, overridesMap);
  return rows
    .map((row) => ({
      ...row,
      Monto: row.atribuciones.filter((a) => a.Sucursal === sucursalFiltro).reduce((acc, a) => acc + a.Monto, 0),
    }))
    .filter((row) => Math.abs(row.Monto) > 0.004);
};

const listadoClientes = async (pool, desde, hasta, sucursalFiltro, pendientes, overridesMap) => {
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
  const rows = await resolverMontosPorSucursal(pool, rowsFirmadas, sucursalFiltro, pendientes, overridesMap);

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
    .filter((c) => Math.abs(c.saldoInicial) > 0.004 || c.movimientos.length > 0)
    .sort((a, b) => b.saldoFinal - a.saldoFinal);

  return {
    modo: 'listado',
    clientes,
    columns: ['Fecha', 'Tipo', 'Documento', 'Debe', 'Haber', 'Saldo'],
  };
};

const getCuentaCorrienteCliente = async ({ cliente, fechaDesde, fechaHasta, sucursal, pendientes, sucursalRestringida = null }) => {
  const pool = await getGpPoolEcobahia();
  const overridesMap = await getOverridesMap({ empresa: 'ecobahia', tipo: 'sucursal' });
  const desdeListado = fechaDesde ? new Date(fechaDesde) : null;
  const hastaListado = fechaHasta ? new Date(fechaHasta) : null;

  // Acceso restringido por sucursal: se fuerza el filtro a la sucursal real del usuario
  // (buscando cuál de las sucursales reales de Ecobahia coincide con su valor de AD, con
  // el mismo helper que ya usa el resto de los reportes de Ventas) - ignorando lo que
  // pida el cliente. Si ninguna coincide, se fuerza un valor que no matchea nada.
  let sucursalFiltro = sucursal && sucursal.trim() ? sucursal.trim() : null;
  if (sucursalRestringida) {
    const sucursalesReales = await getSucursalesVentas({ empresa: 'ecobahia' });
    sucursalFiltro = sucursalesReales.find((s) => coincideSucursal(s, sucursalRestringida)) || '__SIN_ACCESO__';
  }
  const pendientesBool = pendientes === true || pendientes === 'true';

  if (!cliente || !cliente.trim()) {
    return listadoClientes(pool, desdeListado, hastaListado, sucursalFiltro, pendientesBool, overridesMap);
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
      return { ...row, Monto: signo === undefined ? 0 : signo * row.ORTRXAMT };
    }));
  const movimientosTodos = await resolverMontosPorSucursal(pool, movimientosFirmados, sucursalFiltro, pendientesBool, overridesMap);

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

module.exports = getCuentaCorrienteCliente;
