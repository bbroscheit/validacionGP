const { getGpPoolEcobahia, sql } = require('../../config/gpPool');

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
// Se excluyen dos cosas nada más: la cuenta de deudores por ventas (113110-01-000, la
// contrapartida de cobro) y las cuentas de impuestos (A.ACCATNUM = 30 - categoría de
// cuenta de GP que agrupa TODAS las cuentas de IVA/IIBB/retenciones, no solo las 3 más
// usadas). Probamos primero filtrar por A.PSTNGTYP = 1 (Estado de Resultados) pero eso
// también sacaba las cuentas "V.A." (123xxx, activo) que sí tienen que quedar - el saldo
// dejaba de cerrar contra el Neto. Confirmado contra PRD08 (julio/2026): excluyendo solo
// deudores + ACCATNUM=30 el total da 473.560.303,27, exacto contra el Neto de
// "Ventas por sucursal".
const MONEDA_VACIA = 'En Blanco';
const CUENTA_DEUDORES = '113110-01-000';
const ACCATNUM_IMPUESTOS = 30;
const MAX_ROWS = 100000;

const getVentasPorCategoriaContribuyente = async ({ fechaDesde, fechaHasta, soloConP = true }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const pool = await getGpPoolEcobahia();
  const soloConPBool = soloConP === false || soloConP === 'false' ? false : true;

  const bindFilters = (request) => {
    request.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
    request.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
    request.input('soloConP', sql.Bit, soloConPBool);
    request.input('cuentaDeudores', sql.VarChar(75), CUENTA_DEUDORES);
    request.input('accatnumImpuestos', sql.Int, ACCATNUM_IMPUESTOS);
    return request;
  };

  const countRequest = bindFilters(pool.request());
  const count = await countRequest.query(`
    SELECT COUNT(*) AS total
    FROM GL20000 AS G
    INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
    INNER JOIN GL00100 AS A ON A.ACTINDX = G.ACTINDX
    WHERE
      LTRIM(RTRIM(G.SOURCDOC)) = 'SJ'
      AND G.TRXDATE >= @fechaDesde
      AND G.TRXDATE <= @fechaHasta
      AND LTRIM(RTRIM(N.ACTNUMST)) <> @cuentaDeudores
      AND A.ACCATNUM <> @accatnumImpuestos
      AND (@soloConP = 0 OR LTRIM(RTRIM(G.ORDOCNUM)) LIKE '%P%')
  `);
  const totalCount = count.recordset[0].total;

  const detalleRequest = bindFilters(pool.request());
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
      AND LTRIM(RTRIM(N.ACTNUMST)) <> @cuentaDeudores
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
