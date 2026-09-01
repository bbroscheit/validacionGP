const { getGpPoolSist2, sql } = require('../../config/gpPool');
const { resolverSucursalSist2, bindInList } = require('../../services/sist2Ventas');

// Reporte - Cobranzas por sucursal (solo sist2)
// Los recibos (GL20000, SOURCDOC IN ('CRJ','RMJ'), igual clasificación que usa
// getGastos.js) no tienen sucursal propia - GP no la guarda ahí. Se resuelve así, en
// este orden (a pedido del usuario):
//   1) La sucursal de la factura a la que el recibo está aplicado/vinculado (tabla
//      RM20201 - "Aplicado a", GP la deja siempre en estado "abierta" en esta instalación,
//      RM30201/historial de aplicaciones da 0 filas siempre - confirmado). Un mismo
//      recibo puede estar aplicado a varias facturas (parcial), cada una prorratea su
//      propio monto (RM20201.APPTOAMT) - y cada factura puede resolver su sucursal por
//      cualquiera de las 3 fuentes normales (PHONE3/DOCID/ficha del cliente de LA
//      FACTURA, ver services/sist2Ventas.js).
//   2) Si el recibo no tiene ninguna aplicación resuelta (recibo sin aplicar todavía,
//      factura no encontrada en SOP30200, o la factura tampoco resuelve sucursal) - la
//      "Def. de usuario 2" del CLIENTE DEL RECIBO directamente (mismo campo, pero del
//      cliente que pagó, no de la factura).
//   3) Si ni eso hay - "En Blanco".
// El monto de cada recibo sale de su línea contra la cuenta de deudores por ventas
// (113110-01-000, la misma que usan los reportes de Ventas) dentro de GL20000 - ahí
// vive el importe real cobrado (crédito neto = reduce la deuda del cliente).
// Se separan los montos en dos columnas (MontoDocumento/MontoCliente) para que se vea
// cuánto de la cobranza de cada sucursal viene de una factura real vs. del dato del
// cliente (menos confiable) - a pedido del usuario. Por construcción, para cada recibo
// MontoDocumento + MontoCliente = el monto total del recibo (lo no resuelto por
// factura, incluida cualquier diferencia por descuentos de pronto pago tomados en la
// aplicación, cae íntegro en MontoCliente - así el total general siempre cierra exacto
// contra la suma de recibos del período, sin inventar precisión que no hay).
const CUENTA_DEUDORES = '113110-01-000';
const MAX_ROWS = 100000;
const MONEDA_VACIA = 'En Blanco';

const getCobranzasSist2 = async ({ fechaDesde, fechaHasta }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const pool = await getGpPoolSist2();

  const countRequest = pool.request();
  countRequest.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
  countRequest.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
  countRequest.input('cuentaDeudores', sql.VarChar(75), CUENTA_DEUDORES);
  const count = await countRequest.query(`
    SELECT COUNT(DISTINCT LTRIM(RTRIM(G.ORDOCNUM))) AS total
    FROM GL20000 AS G
    INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
    WHERE LTRIM(RTRIM(G.SOURCDOC)) IN ('CRJ', 'RMJ')
      AND LTRIM(RTRIM(N.ACTNUMST)) = @cuentaDeudores
      AND G.TRXDATE >= @fechaDesde AND G.TRXDATE <= @fechaHasta
  `);
  const totalCount = count.recordset[0].total;

  const recibosRequest = pool.request();
  recibosRequest.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
  recibosRequest.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
  recibosRequest.input('cuentaDeudores', sql.VarChar(75), CUENTA_DEUDORES);
  const recibosResult = await recibosRequest.query(`
    SELECT TOP (${MAX_ROWS})
      LTRIM(RTRIM(G.ORDOCNUM)) AS Recibo,
      LTRIM(RTRIM(G.ORMSTRID)) AS ClienteRecibo,
      MIN(G.TRXDATE) AS TRXDATE,
      SUM(G.CRDTAMNT - G.DEBITAMT) AS Monto
    FROM GL20000 AS G
    INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
    WHERE LTRIM(RTRIM(G.SOURCDOC)) IN ('CRJ', 'RMJ')
      AND LTRIM(RTRIM(N.ACTNUMST)) = @cuentaDeudores
      AND G.TRXDATE >= @fechaDesde AND G.TRXDATE <= @fechaHasta
    GROUP BY LTRIM(RTRIM(G.ORDOCNUM)), LTRIM(RTRIM(G.ORMSTRID))
    ORDER BY MIN(G.TRXDATE) ASC
  `);
  const recibos = recibosResult.recordset;

  if (recibos.length === 0) {
    return {
      totalCount, truncated: totalCount > MAX_ROWS,
      base: [], baseColumns: ['Sucursal', 'Origen', 'Recibo', 'Fecha', 'Cliente', 'ClienteNombre', 'Factura', 'Monto'],
      rows: [], columns: ['Sucursal', 'MontoDocumento', 'MontoCliente', 'Total'],
      totalMontoDocumento: 0, totalMontoCliente: 0, totalGeneral: 0,
    };
  }

  // Aplicaciones (RM20201, "Aplicado a" - solo queda en la tabla "abierta" en esta
  // instalación, RM30201/historial siempre da 0 filas, confirmado). APTODCTY = 1 =
  // aplicado a una Factura (el único tipo visto en la data real).
  const reciboNums = [...new Set(recibos.map((r) => r.Recibo))];
  const applyRequest = pool.request();
  const reciboList = bindInList(applyRequest, 'r', reciboNums);
  const applyResult = await applyRequest.query(`
    SELECT LTRIM(RTRIM(APFRDCNM)) AS Recibo, LTRIM(RTRIM(APTODCNM)) AS Factura, APPTOAMT
    FROM RM20201
    WHERE LTRIM(RTRIM(APFRDCNM)) IN (${reciboList}) AND APTODCTY = 1
  `);
  const applyLinesByRecibo = new Map();
  applyResult.recordset.forEach((row) => {
    if (!applyLinesByRecibo.has(row.Recibo)) applyLinesByRecibo.set(row.Recibo, []);
    applyLinesByRecibo.get(row.Recibo).push(row);
  });

  // Facturas referenciadas: se filtra SOPTYPE = 3 (Factura) a propósito - evita el
  // problema ya conocido de números de comprobante repetidos entre Factura/Devolución
  // en sist2 (ver getVentasPorSucursalCuenta.js), y además es justo lo que corresponde
  // acá (RM20201.APTODCTY = 1 = Factura, nunca Devolución).
  const facturaNums = [...new Set(applyResult.recordset.map((r) => r.Factura))];
  const invoiceMap = new Map();
  if (facturaNums.length > 0) {
    const invoiceRequest = pool.request();
    const facturaList = bindInList(invoiceRequest, 'f', facturaNums);
    const invoiceResult = await invoiceRequest.query(`
      SELECT LTRIM(RTRIM(SOPNUMBE)) AS SOPNUMBE, NULLIF(LTRIM(RTRIM(PHONE3)), '') AS PHONE3,
        LTRIM(RTRIM(DOCID)) AS DOCID, LTRIM(RTRIM(CUSTNMBR)) AS CUSTNMBR
      FROM SOP30200
      WHERE LTRIM(RTRIM(SOPNUMBE)) IN (${facturaList}) AND SOPTYPE = 3
    `);
    invoiceResult.recordset.forEach((row) => {
      if (!invoiceMap.has(row.SOPNUMBE)) invoiceMap.set(row.SOPNUMBE, row);
    });
  }

  // Ficha del cliente (RM00101.USERDEF2): hace falta tanto para el cliente de cada
  // factura (fuente 3 de resolverSucursalSist2) como para el cliente del recibo (el
  // fallback final si no hay factura que resuelva).
  const clientesInvolucrados = new Set(recibos.map((r) => r.ClienteRecibo));
  invoiceMap.forEach((inv) => clientesInvolucrados.add(inv.CUSTNMBR));
  const clienteNums = [...clientesInvolucrados].filter(Boolean);
  const clienteInfo = new Map();
  if (clienteNums.length > 0) {
    const clienteRequest = pool.request();
    const clienteList = bindInList(clienteRequest, 'c', clienteNums);
    const clienteResult = await clienteRequest.query(`
      SELECT LTRIM(RTRIM(CUSTNMBR)) AS CUSTNMBR, LTRIM(RTRIM(CUSTNAME)) AS CUSTNAME, USERDEF2
      FROM RM00101
      WHERE LTRIM(RTRIM(CUSTNMBR)) IN (${clienteList})
    `);
    clienteResult.recordset.forEach((row) => clienteInfo.set(row.CUSTNMBR, row));
  }

  const base = [];
  recibos.forEach((recibo) => {
    const lineas = applyLinesByRecibo.get(recibo.Recibo) || [];
    let sumAplicadoResuelto = 0;
    lineas.forEach((linea) => {
      const factura = invoiceMap.get(linea.Factura);
      if (!factura) return; // sin factura encontrada -> cae en el residual (cliente)
      const clienteFactura = clienteInfo.get(factura.CUSTNMBR);
      const sucursal = resolverSucursalSist2({
        phone3: factura.PHONE3,
        docid: factura.DOCID,
        clienteUserdef2: clienteFactura ? clienteFactura.USERDEF2 : null,
      });
      if (!sucursal) return; // factura sin sucursal resoluble -> cae en el residual
      sumAplicadoResuelto += linea.APPTOAMT;
      base.push({
        Sucursal: sucursal,
        Origen: 'Documento',
        Recibo: recibo.Recibo,
        Fecha: recibo.TRXDATE,
        Cliente: recibo.ClienteRecibo,
        ClienteNombre: clienteFactura ? clienteFactura.CUSTNAME : null,
        Factura: linea.Factura,
        Monto: linea.APPTOAMT,
      });
    });

    const residual = recibo.Monto - sumAplicadoResuelto;
    if (Math.abs(residual) > 0.004) {
      const clienteRecibo = clienteInfo.get(recibo.ClienteRecibo);
      const sucursalCliente = resolverSucursalSist2({
        phone3: null,
        docid: null,
        clienteUserdef2: clienteRecibo ? clienteRecibo.USERDEF2 : null,
      }) || MONEDA_VACIA;
      base.push({
        Sucursal: sucursalCliente,
        Origen: 'Cliente',
        Recibo: recibo.Recibo,
        Fecha: recibo.TRXDATE,
        Cliente: recibo.ClienteRecibo,
        ClienteNombre: clienteRecibo ? clienteRecibo.CUSTNAME : null,
        Factura: null,
        Monto: residual,
      });
    }
  });

  const agrupado = new Map();
  base.forEach((row) => {
    if (!agrupado.has(row.Sucursal)) {
      agrupado.set(row.Sucursal, { Sucursal: row.Sucursal, MontoDocumento: 0, MontoCliente: 0 });
    }
    const grupo = agrupado.get(row.Sucursal);
    if (row.Origen === 'Documento') grupo.MontoDocumento += row.Monto;
    else grupo.MontoCliente += row.Monto;
  });

  const rows = [...agrupado.values()]
    .map((row) => ({ ...row, Total: row.MontoDocumento + row.MontoCliente }))
    .sort((a, b) => a.Sucursal.localeCompare(b.Sucursal));

  const totalMontoDocumento = rows.reduce((acc, row) => acc + row.MontoDocumento, 0);
  const totalMontoCliente = rows.reduce((acc, row) => acc + row.MontoCliente, 0);

  return {
    totalCount,
    truncated: totalCount > MAX_ROWS,
    base,
    baseColumns: ['Sucursal', 'Origen', 'Recibo', 'Fecha', 'Cliente', 'ClienteNombre', 'Factura', 'Monto'],
    rows,
    columns: ['Sucursal', 'MontoDocumento', 'MontoCliente', 'Total'],
    totalMontoDocumento,
    totalMontoCliente,
    totalGeneral: totalMontoDocumento + totalMontoCliente,
  };
};

module.exports = getCobranzasSist2;
