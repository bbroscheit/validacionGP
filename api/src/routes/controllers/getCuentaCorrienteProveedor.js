const { getGpPoolEcobahia, getGpPoolEcosistemas, getGpPoolEcoportatiles, getGpPoolBaxpa, getGpPoolCylius, getGpPoolChile, sql } = require('../../config/gpPool');

const POOLS = { ecobahia: getGpPoolEcobahia, ecosistemas: getGpPoolEcosistemas, ecoportatiles: getGpPoolEcoportatiles, baxpa: getGpPoolBaxpa, cylius: getGpPoolCylius, chile: getGpPoolChile };

// Reporte - Cuenta corriente de proveedor (los 4 emprendimientos, menú "Compras").
// A diferencia de Clientes (RM20101 sola alcanza - ver getCuentaCorrienteCliente.js),
// Proveedores SÍ separa los documentos abiertos (PM20000) de los ya pagados/históricos
// (PM30200) - confirmado contra PRD08 real: las dos tienen datos reales (568 y 2163
// filas). Hace falta UNIR las dos para tener el 100% del historial de un proveedor; usar
// solo PM20000 dejaría afuera todo lo ya pagado.
//
// DOCTYPE (confirmado contra datos reales de PRD08 - 1/2/3/4/5/6 vistos en una u otra
// tabla, convención estándar de GP, mismo criterio direccional que RMDTYPAL del lado de
// Clientes):
//   1 = Factura              -> aumenta la deuda (Debe)
//   2 = Cargo Financiero     -> aumenta la deuda (Debe)
//   3 = Cargo Misceláneo     -> aumenta la deuda (Debe)
//   4 = Devolución           -> disminuye la deuda (Haber)
//   5 = Nota de Crédito      -> disminuye la deuda (Haber)
//   6 = Pago                 -> disminuye la deuda (Haber)
// `DOCAMNT` es el campo de monto confiable del documento - NO `PRCHAMNT`, que en datos
// reales no siempre coincide con `CURTRXAM` (ej. documentos DOCTYPE=2 grandes con
// CURTRXAM casi en cero pero PRCHAMNT igual al monto original completo).
//
// Sin filtro de sucursal (a pedido del usuario): la sucursal de una compra no vive en el
// documento de Proveedores, se calcula cruzando contra Contabilidad Analítica
// (AATransactions) vía el asiento contable posteado - la misma lógica pesada que ya tiene
// getComprasPorSucursal.js. Se deja fuera de alcance por ahora; un usuario restringido
// por sucursal queda bloqueado entero de este reporte (ver bloquearSiRestringido en
// validacionRouter.js) en vez de mostrarle todo sin poder acotarlo.
const PM_DOCTYPE_SIGNO = { 1: 1, 2: 1, 3: 1, 4: -1, 5: -1, 6: -1 };
const PM_DOCTYPE_LABEL = {
  1: 'Factura', 2: 'Cargo Financiero', 3: 'Cargo Misceláneo', 4: 'Devolución', 5: 'Nota de Crédito', 6: 'Pago',
};
const tipoDeMovimiento = (doctype) => PM_DOCTYPE_LABEL[doctype] ?? `DOCTYPE ${doctype} (desconocido)`;

const MONEDA_VACIA = 'En Blanco';
const MAX_ROWS = 20000;

// PM20000 (abiertos) UNION ALL PM30200 (histórico/pagados), mismas columnas de las dos
// tablas - VOIDED existe en ambas con el mismo significado (confirmado, ya usado así en
// getComprasPorSucursal.js).
// Cylius factura en UYU/USD sin tipo de cambio en la base y confirmado que PM20000/
// PM30200 tienen CURNCYID con el mismo significado que en Ventas (moneda original del
// documento, no convertida) - por eso `unionPm` suma esa columna solo cuando hace falta
// separar por moneda (multiMoneda), sin tocar la consulta para el resto de las empresas.
const unionPm = (multiMoneda) => {
  const monedaCols = multiMoneda ? ', LTRIM(RTRIM(CURNCYID)) AS Moneda' : '';
  return `
  SELECT LTRIM(RTRIM(VENDORID)) AS VENDORID, LTRIM(RTRIM(DOCNUMBR)) AS Documento, DOCTYPE, DOCDATE, DOCAMNT, CURTRXAM${monedaCols}
  FROM PM20000 WHERE ISNULL(VOIDED, 0) = 0
  UNION ALL
  SELECT LTRIM(RTRIM(VENDORID)) AS VENDORID, LTRIM(RTRIM(DOCNUMBR)) AS Documento, DOCTYPE, DOCDATE, DOCAMNT, CURTRXAM${monedaCols}
  FROM PM30200 WHERE ISNULL(VOIDED, 0) = 0
`;
};

const firmarConSigno = (rows, campoMonto) => rows.map((row) => {
  const signo = PM_DOCTYPE_SIGNO[row.DOCTYPE];
  return { ...row, Monto: signo === undefined ? 0 : signo * row[campoMonto] };
});

const filtrarPendientes = (rows) => firmarConSigno(rows, 'CURTRXAM').filter((row) => Math.abs(row.Monto) > 0.004);

const listadoProveedores = async (pool, desde, hasta, pendientes, multiMoneda) => {
  const result = await pool.request().query(`
    SELECT P.VENDORID, LTRIM(RTRIM(V.VENDNAME)) AS VENDNAME, P.Documento, P.DOCTYPE, P.DOCDATE, P.DOCAMNT, P.CURTRXAM${multiMoneda ? ', P.Moneda' : ''}
    FROM (${unionPm(multiMoneda)}) AS P
    INNER JOIN PM00200 AS V ON LTRIM(RTRIM(V.VENDORID)) = P.VENDORID
  `);

  const rowsFirmadas = pendientes ? filtrarPendientes(result.recordset) : firmarConSigno(result.recordset, 'DOCAMNT');

  // Cylius factura en UYU/USD sin tipo de cambio en la base - no se puede arrastrar un
  // solo saldo corrido mezclando monedas (ver el mismo criterio en
  // getCuentaCorrienteCliente.js). Cada proveedor queda separado en un sub-libro por
  // moneda cuando multiMoneda, igual que Clientes.
  const claveDe = (row) => (multiMoneda ? `${row.VENDORID}__${row.Moneda || MONEDA_VACIA}` : row.VENDORID);

  const porProveedor = new Map();
  rowsFirmadas.forEach((row) => {
    const clave = claveDe(row);
    if (!porProveedor.has(clave)) {
      porProveedor.set(clave, { VENDORID: row.VENDORID, VENDNAME: row.VENDNAME, Moneda: multiMoneda ? (row.Moneda || MONEDA_VACIA) : undefined, previos: [], enRango: [] });
    }
    const p = porProveedor.get(clave);
    const item = { Fecha: row.DOCDATE, Tipo: tipoDeMovimiento(row.DOCTYPE), Documento: row.Documento, Monto: row.Monto };
    if (desde && row.DOCDATE < desde) {
      p.previos.push(item);
    } else if (!hasta || row.DOCDATE <= hasta) {
      p.enRango.push(item);
    }
  });

  const proveedores = [...porProveedor.values()]
    .map((p) => {
      const saldoInicial = p.previos.reduce((acc, m) => acc + m.Monto, 0);
      let saldoCorrido = saldoInicial;
      const movimientos = p.enRango.map((m) => {
        saldoCorrido += m.Monto;
        return {
          Fecha: m.Fecha, Tipo: m.Tipo, Documento: m.Documento,
          Debe: m.Monto > 0 ? m.Monto : 0, Haber: m.Monto < 0 ? -m.Monto : 0,
          Saldo: saldoCorrido,
        };
      });
      return {
        VENDORID: p.VENDORID, VENDNAME: p.VENDNAME, ...(multiMoneda ? { Moneda: p.Moneda } : {}),
        saldoInicial, movimientos, saldoFinal: saldoCorrido,
      };
    })
    .filter((p) => Math.abs(p.saldoInicial) > 0.004 || p.movimientos.length > 0)
    .sort((a, b) => b.saldoFinal - a.saldoFinal);

  return {
    modo: 'listado',
    proveedores,
    columns: ['Fecha', 'Tipo', 'Documento', 'Debe', 'Haber', 'Saldo'],
    multiMoneda,
  };
};

const getCuentaCorrienteProveedor = async ({ proveedor, fechaDesde, fechaHasta, pendientes, empresa = 'ecobahia' }) => {
  const getPool = POOLS[empresa];
  if (!getPool) throw new Error(`Empresa desconocida: "${empresa}"`);
  const pool = await getPool();
  const desdeListado = fechaDesde ? new Date(fechaDesde) : null;
  const hastaListado = fechaHasta ? new Date(fechaHasta) : null;
  const pendientesBool = pendientes === true || pendientes === 'true';
  const multiMoneda = empresa === 'cylius';

  if (!proveedor || !proveedor.trim()) {
    return listadoProveedores(pool, desdeListado, hastaListado, pendientesBool, multiMoneda);
  }
  const proveedorTrim = proveedor.trim();

  const provRequest = pool.request();
  provRequest.input('proveedor', sql.VarChar(15), proveedorTrim);
  const provResult = await provRequest.query(`
    SELECT LTRIM(RTRIM(VENDORID)) AS VENDORID, LTRIM(RTRIM(VENDNAME)) AS VENDNAME
    FROM PM00200 WHERE LTRIM(RTRIM(VENDORID)) = @proveedor
  `);
  if (provResult.recordset.length === 0) {
    throw new Error(`No se encontró el proveedor "${proveedorTrim}"`);
  }
  const proveedorInfo = provResult.recordset[0];

  const movRequest = pool.request();
  movRequest.input('proveedor', sql.VarChar(15), proveedorTrim);
  const movResult = await movRequest.query(`
    SELECT TOP (${MAX_ROWS}) P.Documento, P.DOCTYPE, P.DOCDATE, P.DOCAMNT, P.CURTRXAM${multiMoneda ? ', P.Moneda' : ''}
    FROM (${unionPm(multiMoneda)}) AS P
    WHERE P.VENDORID = @proveedor
    ORDER BY P.DOCDATE ASC, P.Documento ASC
  `);

  const conTipo = (rows) => rows.map((row) => ({ ...row, TipoMovimiento: tipoDeMovimiento(row.DOCTYPE) }));
  const movimientosFirmados = pendientesBool
    ? conTipo(filtrarPendientes(movResult.recordset))
    : conTipo(firmarConSigno(movResult.recordset, 'DOCAMNT'));

  const desde = fechaDesde ? new Date(fechaDesde) : null;
  const hasta = fechaHasta ? new Date(fechaHasta) : null;

  // Extraído para poder correrlo una vez por moneda cuando multiMoneda (ver
  // getCuentaCorrienteCliente.js para el mismo criterio del lado de Clientes).
  const armarLedger = (movs) => {
    const saldoInicial = movs
      .filter((m) => desde && m.DOCDATE < desde)
      .reduce((acc, m) => acc + m.Monto, 0);
    const enRango = movs.filter((m) => (
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
    return { saldoInicial, movimientos, saldoFinal: movimientos.length > 0 ? movimientos[movimientos.length - 1].Saldo : saldoInicial };
  };

  if (multiMoneda) {
    const porMonedaMap = new Map();
    movimientosFirmados.forEach((m) => {
      const moneda = m.Moneda || MONEDA_VACIA;
      if (!porMonedaMap.has(moneda)) porMonedaMap.set(moneda, []);
      porMonedaMap.get(moneda).push(m);
    });
    const porMoneda = [...porMonedaMap.entries()]
      .map(([Moneda, movs]) => ({ Moneda, ...armarLedger(movs) }))
      .sort((a, b) => a.Moneda.localeCompare(b.Moneda));

    return {
      modo: 'detalle',
      proveedor: proveedorInfo,
      multiMoneda: true,
      porMoneda,
      columns: ['Fecha', 'Tipo', 'Documento', 'Debe', 'Haber', 'Saldo'],
      truncated: movResult.recordset.length >= MAX_ROWS,
    };
  }

  const { saldoInicial, movimientos, saldoFinal } = armarLedger(movimientosFirmados);

  return {
    modo: 'detalle',
    proveedor: proveedorInfo,
    saldoInicial,
    saldoFinal,
    movimientos,
    columns: ['Fecha', 'Tipo', 'Documento', 'Debe', 'Haber', 'Saldo'],
    truncated: movResult.recordset.length >= MAX_ROWS,
  };
};

module.exports = getCuentaCorrienteProveedor;
