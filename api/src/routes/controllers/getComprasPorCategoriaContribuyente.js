const { getGpPoolEcobahia, sql } = require('../../config/gpPool');

// Reporte - Compras por categoría de cuenta y tipo de contribuyente
// Mismo esquema que getVentasPorCategoriaContribuyente.js pero para compras: GL20000
// (SOURCDOC = PMTRX/PMVVR) agrupado por categoría de cuenta (GL00100.USERDEF2) y tipo de
// contribuyente del proveedor (no del cliente - se resuelve vía AWLI_PM00200 usando
// G.ORMSTRID, que ya trae el VENDORID en la línea de asiento, contra
// DYNAMICS..AWLI40330 para RESPBLE).
//
// Se excluyen las mismas dos cosas que en Compras por sucursal (confirmado contra
// PRD08): las cuentas que funcionan como contrapartida de pago (211101 "AV.-PROVEEDORES
// VARIOS" y 223202 "Visa Frances a Pagar" - no son una compra en sí) y las cuentas de
// impuestos (ACCATNUM=9: IVA Crédito Fiscal y percepciones).
// Igual que en Gastos/Compras: GL20000.VOIDED no sirve (siempre da 0), se cruza contra
// PM30200/PM20000.VOIDED=1 por DOCNUMBR+VENDORID.
//
// RI (Gravado) vs RI (No Gravado): dentro de "RI" hay comprobantes sin IVA discriminado
// (ej. órdenes de pago "OPP-...", confirmado contra PRD08 con proveedores RESP_TYPE=01
// y sin impuesto en julio/2026) que no deberían mezclarse con las facturas normales con
// IVA. Se distingue por el detalle impositivo real del comprobante (AWLI_IMPUESTOS,
// una fila por TAXDTLID aplicado al voucher - "IVACF 21%", "IVACF 0% NOGRAV", etc.),
// no por PM30200/PM20000.TAXAMNT del header: se busca el VCHRNMBR del comprobante en
// PM30200/PM20000 y se suma el impuesto de todas sus líneas en AWLI_IMPUESTOS. Si algún
// TAXDTLID tiene importe de impuesto ≠ 0, es "RI (Gravado)"; si no, "RI (No Gravado)".
// Solo se splitea RI - el resto de los tipos de contribuyente quedan como están.
// OJO: un comprobante puede dar Monto negativo (una NC) y aun así clasificar
// correctamente como No Gravado si su propio detalle impositivo es "0% NOGRAV" - eso
// no es un bug de esta query, es el dato real cargado en GP para ese comprobante.
const MONEDA_VACIA = 'En Blanco';
const CUENTAS_CONTRAPARTIDA = ['211101-01-000', '223202-01-000'];
const ACCATNUM_IMPUESTOS = 9;
const MAX_ROWS = 100000;

const getComprasPorCategoriaContribuyente = async ({ fechaDesde, fechaHasta }) => {
  if (!fechaDesde || !fechaHasta) {
    throw new Error('fechaDesde y fechaHasta son requeridos');
  }

  const pool = await getGpPoolEcobahia();

  const bindFilters = (request) => {
    request.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
    request.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
    request.input('cuentaContrapartida1', sql.VarChar(75), CUENTAS_CONTRAPARTIDA[0]);
    request.input('cuentaContrapartida2', sql.VarChar(75), CUENTAS_CONTRAPARTIDA[1]);
    request.input('accatnumImpuestos', sql.Int, ACCATNUM_IMPUESTOS);
    return request;
  };

  const noAnuladaWhere = `
    AND NOT EXISTS (
      SELECT 1 FROM PM30200 P
      WHERE LTRIM(RTRIM(P.DOCNUMBR)) = LTRIM(RTRIM(G.ORDOCNUM))
        AND LTRIM(RTRIM(P.VENDORID)) = LTRIM(RTRIM(G.ORMSTRID))
        AND P.VOIDED = 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM PM20000 P
      WHERE LTRIM(RTRIM(P.DOCNUMBR)) = LTRIM(RTRIM(G.ORDOCNUM))
        AND LTRIM(RTRIM(P.VENDORID)) = LTRIM(RTRIM(G.ORMSTRID))
        AND P.VOIDED = 1
    )
  `;

  const countRequest = bindFilters(pool.request());
  const count = await countRequest.query(`
    SELECT COUNT(*) AS total
    FROM GL20000 AS G
    INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
    INNER JOIN GL00100 AS A ON A.ACTINDX = G.ACTINDX
    WHERE
      LTRIM(RTRIM(G.SOURCDOC)) IN ('PMTRX', 'PMVVR')
      AND G.TRXDATE >= @fechaDesde
      AND G.TRXDATE <= @fechaHasta
      AND LTRIM(RTRIM(N.ACTNUMST)) NOT IN (@cuentaContrapartida1, @cuentaContrapartida2)
      AND A.ACCATNUM <> @accatnumImpuestos
      ${noAnuladaWhere}
  `);
  const totalCount = count.recordset[0].total;

  const detalleRequest = bindFilters(pool.request());
  const detalle = await detalleRequest.query(`
    SELECT TOP (${MAX_ROWS})
      NULLIF(LTRIM(RTRIM(A.USERDEF2)), '') AS Categoria,
      NULLIF(LTRIM(RTRIM(CT.RESPBLE)), '') AS TipoContribuyente,
      TI.TotalTax,
      LTRIM(RTRIM(G.ORDOCNUM)) AS Comprobante,
      LTRIM(RTRIM(N.ACTNUMST)) AS Cuenta,
      LTRIM(RTRIM(A.ACTDESCR)) AS CuentaDescripcion,
      G.DEBITAMT,
      G.CRDTAMNT
    FROM GL20000 AS G
    INNER JOIN GL00105 AS N ON N.ACTINDX = G.ACTINDX
    INNER JOIN GL00100 AS A ON A.ACTINDX = G.ACTINDX
    LEFT JOIN AWLI_PM00200 AS PT ON LTRIM(RTRIM(PT.VENDORID)) = LTRIM(RTRIM(G.ORMSTRID))
    LEFT JOIN DYNAMICS..AWLI40330 AS CT ON CT.RESP_TYPE = PT.RESP_TYPE
    LEFT JOIN PM30200 AS HH ON LTRIM(RTRIM(HH.DOCNUMBR)) = LTRIM(RTRIM(G.ORDOCNUM)) AND LTRIM(RTRIM(HH.VENDORID)) = LTRIM(RTRIM(G.ORMSTRID))
    LEFT JOIN PM20000 AS HO ON LTRIM(RTRIM(HO.DOCNUMBR)) = LTRIM(RTRIM(G.ORDOCNUM)) AND LTRIM(RTRIM(HO.VENDORID)) = LTRIM(RTRIM(G.ORMSTRID))
    LEFT JOIN (
      SELECT LTRIM(RTRIM(VCHRNMBR)) AS VCHRNMBR, SUM(ABS(TAXAMNT)) AS TotalTax
      FROM AWLI_IMPUESTOS
      GROUP BY LTRIM(RTRIM(VCHRNMBR))
    ) AS TI ON TI.VCHRNMBR = LTRIM(RTRIM(COALESCE(HH.VCHRNMBR, HO.VCHRNMBR)))
    WHERE
      LTRIM(RTRIM(G.SOURCDOC)) IN ('PMTRX', 'PMVVR')
      AND G.TRXDATE >= @fechaDesde
      AND G.TRXDATE <= @fechaHasta
      AND LTRIM(RTRIM(N.ACTNUMST)) NOT IN (@cuentaContrapartida1, @cuentaContrapartida2)
      AND A.ACCATNUM <> @accatnumImpuestos
      ${noAnuladaWhere}
    ORDER BY Categoria ASC
  `);

  const base = detalle.recordset.map((row) => {
    let tipoContribuyente = row.TipoContribuyente || MONEDA_VACIA;
    if (tipoContribuyente === 'RI') {
      tipoContribuyente = row.TotalTax ? 'RI (Gravado)' : 'RI (No Gravado)';
    }
    return {
      Categoria: row.Categoria || MONEDA_VACIA,
      TipoContribuyente: tipoContribuyente,
      Comprobante: row.Comprobante,
      Cuenta: row.Cuenta,
      CuentaDescripcion: row.CuentaDescripcion,
      Monto: (row.DEBITAMT || 0) - (row.CRDTAMNT || 0),
    };
  });

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

module.exports = getComprasPorCategoriaContribuyente;
