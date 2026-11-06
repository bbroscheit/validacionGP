const { getGpPoolEcobahia, getGpPoolEcosistemas, getGpPoolEcoportatiles, getGpPoolBaxpa, sql } = require('../../config/gpPool');
const { bindInList } = require('../../services/sist2Ventas');

const POOLS = { ecobahia: getGpPoolEcobahia, ecosistemas: getGpPoolEcosistemas, ecoportatiles: getGpPoolEcoportatiles, baxpa: getGpPoolBaxpa };

// Reporte - Ventas por categoría de cuenta y tipo de contribuyente
// Categoría = GL00100.USERDEF2 (uno de los 4 campos "definidos por el usuario" de la
// cuenta contable: SERVICIOS, ALQUILERES, INV. BIENES DE USO, VENTA DE BS DE USO,
// COMPRA DE BIENES, LOCACIONES - en blanco para deudores/impuestos).
// Tipo de contribuyente: no vive en SOP30200, se resuelve por cliente cruzando
// II_DATOS_CLIE.codigo (columna CodigoCliente = CUSTNMBR) contra DYNAMICS..AWLI40330
// (RESPBLE: RI/MO/CF/EX/Iva No Alcanzado) - mismo camino que getVentas.js.
// OJO: no usar AWLI_RM00101.RESP_TYPE para esto - ese campo viene "colapsado" a
// propósito (queda "01/RI" tanto para RI como para Monotributistas, porque hace años
// la facturación era igual para ambos y nadie lo separó). II_DATOS_CLIE.codigo es el
// mismo dato pero sin ese colapso (viene de New_TipodeContribuyente en el CRM), y es
// el que realmente distingue RI de MO. Confirmado contra PRD08: factura
// FVPA0040-00001281 (cliente 727) da MO con este join, RI con el viejo - y el total
// general de julio no cambia (473.560.303,27 en ambos casos, ver más abajo).
// Se llega al cliente cruzando G.ORDOCNUM contra SOP30200.SOPNUMBE, igual que en
// getVentasPorSucursalCuenta.js.
// Se excluyen dos cosas nada más: las cuentas que actúan como contrapartida de cobro
// (deudores por ventas y, cuando aplica, cuentas de cobro directo/reclasificación - ver
// detalle de BAXPA abajo) y las cuentas de impuestos (A.ACCATNUM = 30 - categoría de
// cuenta de GP que agrupa TODAS las cuentas de IVA/IIBB/retenciones, no solo las 3 más
// usadas). Probamos primero filtrar por A.PSTNGTYP = 1 (Estado de Resultados) pero eso
// también sacaba las cuentas "V.A." (123xxx, activo) que sí tienen que quedar - el saldo
// dejaba de cerrar contra el Neto. Confirmado contra PRD08 (julio/2026): excluyendo solo
// deudores + ACCATNUM=30 el total da 473.560.303,27, exacto contra el Neto de
// "Ventas por sucursal".
//
// OJO: ACCATNUM y los números de cuenta son configuración propia de cada compañía GP,
// no códigos universales (mismo hallazgo que en getComprasPorSucursal.js). Mapeo de
// Ecosistemas (PRD02) confirmado contra su plan de cuentas real: categoría 13 = "I.V.A
// Saldo a Pagar/Débito Fiscal/Retenciones" (equivalente a "Cargas Fiscales a pagar" de
// PRD08), cuenta 112110-02-000 = "DEUDORES POR VENTAS". Ecoportatiles (PRD09) confirmado
// contra su plan de cuentas real: categoría 27 = "Cargas Fiscales a pagar" (incluye
// "DEBITO FISCAL IVA"), cuenta 113110-01-000 = "DEUDORES POR VENTAS LOCALES" (mismo
// número que PRD08). BAXPA (PRD06) confirmado contra su plan de cuentas real (sin sufijo
// "-01-000" en los números de cuenta acá): categoría 17 = "Cargas Fiscales - A.F.I.P a
// Pagar" (incluye "IVA-DEBITO F.21% Y 19%"), cuenta 113110 = "DEUDORES POR VENTAS" (mismo
// número que Ecobahia, sin el sufijo).
//
// BAXPA tiene además otras 3 cuentas que actúan de contrapartida sin ser Deudores -
// confirmado contra el detalle real de GL20000 (SOURCDOC='SJ') de cada una: 111153
// "MERCADO PAGO" (cobro directo sin pasar por Deudores - 4 comprobantes reales), 111155
// "COMPENSACION CLIENTE/PROVEEDOR" (reclasificación de saldo, siempre en el mismo
// asiento que un débito a 113110, sin ninguna línea de ingreso/impuesto - 4 Notas de
// Débito internas), 113116 "CHEQUES RECHAZADOS" (reclasifica el saldo de Deudores a esta
// cuenta cuando rechazan un cheque - mayor impacto encontrado, +14,3M acumulado) y 111321
// "BANCO FRANCES C/C5804/2" (mismo patrón, 1 comprobante). Ninguna es un ingreso nuevo;
// sin excluirlas, cada una se sumaba/restaba como si fuera una venta real.
const MONEDA_VACIA = 'En Blanco';
const CONFIG_EMPRESA = {
  ecobahia: { cuentasContrapartida: ['113110-01-000'], accatnumImpuestos: 30 },
  ecosistemas: { cuentasContrapartida: ['112110-02-000'], accatnumImpuestos: 13 },
  ecoportatiles: { cuentasContrapartida: ['113110-01-000'], accatnumImpuestos: 27 },
  baxpa: { cuentasContrapartida: ['113110', '111153', '111155', '113116', '111321'], accatnumImpuestos: 17 },
};
const MAX_ROWS = 100000;

const getVentasPorCategoriaContribuyente = async ({ fechaDesde, fechaHasta, soloConP = true, empresa = 'ecobahia' }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const pool = await POOLS[empresa]();
  const soloConPBool = soloConP === false || soloConP === 'false' ? false : true;
  const { cuentasContrapartida: CUENTAS_CONTRAPARTIDA, accatnumImpuestos: ACCATNUM_IMPUESTOS } = CONFIG_EMPRESA[empresa];

  const bindFilters = (request) => {
    request.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
    request.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
    request.input('soloConP', sql.Bit, soloConPBool);
    request.input('accatnumImpuestos', sql.Int, ACCATNUM_IMPUESTOS);
    return request;
  };

  const countRequest = bindFilters(pool.request());
  const contrapartidaListCount = bindInList(countRequest, 'cuentaContrapartida', CUENTAS_CONTRAPARTIDA);
  const count = await countRequest.query(`
    SELECT COUNT(*) AS total
    FROM GL20000 AS G
    INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
    INNER JOIN GL00100 AS A ON A.ACTINDX = G.ACTINDX
    WHERE
      LTRIM(RTRIM(G.SOURCDOC)) = 'SJ'
      AND G.TRXDATE >= @fechaDesde
      AND G.TRXDATE <= @fechaHasta
      AND LTRIM(RTRIM(N.ACTNUMST)) NOT IN (${contrapartidaListCount})
      AND A.ACCATNUM <> @accatnumImpuestos
      AND (@soloConP = 0 OR LTRIM(RTRIM(G.ORDOCNUM)) LIKE '%P%')
  `);
  const totalCount = count.recordset[0].total;

  const detalleRequest = bindFilters(pool.request());
  const contrapartidaListDetalle = bindInList(detalleRequest, 'cuentaContrapartida', CUENTAS_CONTRAPARTIDA);
  const detalle = await detalleRequest.query(`
    SELECT TOP (${MAX_ROWS})
      NULLIF(LTRIM(RTRIM(A.USERDEF2)), '') AS Categoria,
      NULLIF(LTRIM(RTRIM(CT.RESPBLE)), '') AS TipoContribuyente,
      LTRIM(RTRIM(G.ORDOCNUM)) AS Comprobante,
      LTRIM(RTRIM(N.ACTNUMST)) AS Cuenta,
      LTRIM(RTRIM(A.ACTDESCR)) AS CuentaDescripcion,
      G.DEBITAMT,
      G.CRDTAMNT
    FROM GL20000 AS G
    INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
    INNER JOIN GL00100 AS A ON A.ACTINDX = G.ACTINDX
    LEFT JOIN SOP30200 AS H ON LTRIM(RTRIM(H.SOPNUMBE)) = LTRIM(RTRIM(G.ORDOCNUM))
    LEFT JOIN II_DATOS_CLIE AS RT ON LTRIM(RTRIM(RT.CodigoCliente)) = LTRIM(RTRIM(H.CUSTNMBR))
    LEFT JOIN DYNAMICS..AWLI40330 AS CT ON LTRIM(RTRIM(CT.RESP_TYPE)) = LTRIM(RTRIM(RT.codigo))
    WHERE
      LTRIM(RTRIM(G.SOURCDOC)) = 'SJ'
      AND G.TRXDATE >= @fechaDesde
      AND G.TRXDATE <= @fechaHasta
      AND LTRIM(RTRIM(N.ACTNUMST)) NOT IN (${contrapartidaListDetalle})
      AND A.ACCATNUM <> @accatnumImpuestos
      AND (@soloConP = 0 OR LTRIM(RTRIM(G.ORDOCNUM)) LIKE '%P%')
    ORDER BY Categoria ASC
  `);

  const base = detalle.recordset.map((row) => ({
    Categoria: row.Categoria || MONEDA_VACIA,
    TipoContribuyente: row.TipoContribuyente || MONEDA_VACIA,
    Comprobante: row.Comprobante,
    Cuenta: row.Cuenta,
    CuentaDescripcion: row.CuentaDescripcion,
    Monto: (row.CRDTAMNT || 0) - (row.DEBITAMT || 0),
  }));

  const agrupado = new Map();
  base.forEach((row) => {
    const key = `${row.Categoria}||${row.TipoContribuyente}`;
    if (!agrupado.has(key)) {
      agrupado.set(key, { Categoria: row.Categoria, TipoContribuyente: row.TipoContribuyente, Monto: 0 });
    }
    agrupado.get(key).Monto += row.Monto;
  });

  const rows = [...agrupado.values()].sort((a, b) => a.Categoria.localeCompare(b.Categoria) || a.TipoContribuyente.localeCompare(b.TipoContribuyente));

  const totalGeneral = rows.reduce((acc, row) => acc + row.Monto, 0);

  return {
    totalCount,
    truncated: totalCount > MAX_ROWS,
    base,
    baseColumns: ['Categoria', 'TipoContribuyente', 'Comprobante', 'Cuenta', 'CuentaDescripcion', 'Monto'],
    rows,
    columns: ['Categoria', 'TipoContribuyente', 'Monto'],
    totalGeneral,
  };
};

module.exports = getVentasPorCategoriaContribuyente;
