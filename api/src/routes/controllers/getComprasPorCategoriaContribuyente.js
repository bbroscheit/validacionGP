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
// RI (Gravado) vs RI (No Gravado): dentro de "RI" hay comprobantes que mezclan, en el
// MISMO comprobante, un tramo gravado y un tramo no gravado (ej. FC A0044-00123808:
// $249.547,69 a IVACF 21% + $39.224,52 a IVACF 0% NOGRAV, confirmado contra PRD08 -
// "Consulta de impuestos ctas. por pagar" en GP). Clasificar el comprobante entero como
// un solo tipo (como se hacía antes, mirando si TENÍA algo de impuesto) esconde ese
// tramo no gravado. Lo correcto es prorratear: por comprobante (VCHRNMBR), se suma la
// base de las líneas IVACF con tasa (10.5%/21%/27% = Gravado) contra la base de las
// líneas IVACF 0% NOGRAV/EXE (= No Gravado) en AWLI_IMPUESTOS, y esa proporción se
// aplica sobre el importe de cada línea contable del comprobante - partiéndola en dos
// filas cuando corresponde. Se ignoran a propósito los TAXDTLID que no son "IVACF"
// (percepciones IIBB "IB-PC-*"/"IB-PV-*", retenciones "IVA-PC-RG3337*", "SIRCREB", y los
// "IVADF*" que son de ventas) porque reusan la misma base ya contada en el IVACF
// correspondiente - sumarlos duplicaría el importe. Si el comprobante no tiene ninguna
// línea IVACF (ej. las órdenes de pago "OPP-...", que no tienen detalle impositivo), va
// entero a "RI (No Gravado)". Solo se splitea RI - el resto de los tipos de
// contribuyente quedan como están.
const MONEDA_VACIA = 'En Blanco';
const CUENTAS_CONTRAPARTIDA = ['211101-01-000', '223202-01-000'];
const ACCATNUM_IMPUESTOS = 9;
const MAX_ROWS = 100000;
const TAXDTLID_GRAVADO = ['IVACF 10.5%', 'IVACF 21%', 'IVACF 27%'];
const TAXDTLID_NO_GRAVADO = ['IVACF 0% NOGRAV', 'IVACF 0% EXE'];

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
      TI.BaseGravado,
      TI.BaseNoGravado,
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
      SELECT
        LTRIM(RTRIM(VCHRNMBR)) AS VCHRNMBR,
        SUM(CASE WHEN LTRIM(RTRIM(TAXDTLID)) IN ('${TAXDTLID_GRAVADO.join("','")}') THEN TAXDTAMT ELSE 0 END) AS BaseGravado,
        SUM(CASE WHEN LTRIM(RTRIM(TAXDTLID)) IN ('${TAXDTLID_NO_GRAVADO.join("','")}') THEN TAXDTAMT ELSE 0 END) AS BaseNoGravado
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

  const base = detalle.recordset.flatMap((row) => {
    const categoria = row.Categoria || MONEDA_VACIA;
    const tipoContribuyente = row.TipoContribuyente || MONEDA_VACIA;
    const monto = (row.DEBITAMT || 0) - (row.CRDTAMNT || 0);
    const comun = {
      Categoria: categoria,
      Comprobante: row.Comprobante,
      Cuenta: row.Cuenta,
      CuentaDescripcion: row.CuentaDescripcion,
    };

    if (tipoContribuyente !== 'RI') {
      return [{ ...comun, TipoContribuyente: tipoContribuyente, Monto: monto }];
    }

    const baseGravado = row.BaseGravado || 0;
    const baseNoGravado = row.BaseNoGravado || 0;
    const totalBase = baseGravado + baseNoGravado;
    const ratioGravado = totalBase ? baseGravado / totalBase : 0;
    const montoGravado = monto * ratioGravado;
    const montoNoGravado = monto - montoGravado;

    const partes = [];
    if (ratioGravado > 0) partes.push({ ...comun, TipoContribuyente: 'RI (Gravado)', Monto: montoGravado });
    if (ratioGravado < 1) partes.push({ ...comun, TipoContribuyente: 'RI (No Gravado)', Monto: montoNoGravado });
    return partes;
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
