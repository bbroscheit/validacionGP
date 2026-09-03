// Export con formato para Cuentas Corrientes (sist2), en archivo propio para que
// Next.js lo separe en su propio chunk (se pide con import() dinámico desde
// cuenta-corriente.js) y así "xlsx-js-style" (~400kb) no se sume al bundle de las demás
// páginas, que siguen usando "xlsx" (exportToExcel.js) sin este peso extra.
//
// "xlsx-js-style" es un fork de SheetJS que sí escribe estilos de celda al guardar - la
// "xlsx" community que usa el resto de la app los ignora aunque se los asignes.
import * as XLSX from "xlsx-js-style";

function aPlano(rows, columns) {
  return rows.map((row) => {
    const plain = {};
    columns.forEach((col) => {
      const value = row[col];
      plain[col] = value && value.type === "Buffer" ? "" : value;
    });
    return plain;
  });
}

const BORDE_FINO = { style: "thin", color: { rgb: "D1D5DB" } };
const ESTILO_BORDE = { top: BORDE_FINO, bottom: BORDE_FINO, left: BORDE_FINO, right: BORDE_FINO };
const ESTILO_HEADER = {
  font: { bold: true, color: { rgb: "FFFFFF" } },
  fill: { fgColor: { rgb: "1F2937" } },
  alignment: { vertical: "center" },
  border: ESTILO_BORDE,
};
const ESTILO_SALDO_INICIAL = {
  font: { italic: true },
  fill: { fgColor: { rgb: "F3F4F6" } },
  border: ESTILO_BORDE,
};
const ESTILO_SALDO_FINAL = {
  font: { bold: true },
  fill: { fgColor: { rgb: "BFDBFE" } },
  border: { ...ESTILO_BORDE, top: { style: "medium", color: { rgb: "6B7280" } } },
};
const ESTILO_NORMAL = { border: ESTILO_BORDE };

const ANCHOS_COLUMNA_CC = { Cliente: 10, Nombre: 32, Fecha: 12, Tipo: 20, Documento: 22, Debe: 15, Haber: 15, Saldo: 16 };
const COLUMNAS_MONTO_CC = ["Debe", "Haber", "Saldo"];
const MARCADORES_CC = ["Saldo inicial", "Saldo final"];

// Encabezado oscuro en negrita, bordes finos en toda la grilla, columnas Debe/Haber/Saldo
// con formato moneda alineadas a la derecha, y filas "Saldo inicial"/"Saldo final"
// resaltadas igual que en pantalla.
export function exportCuentaCorrienteExcel(sheets, filename) {
  const workbook = XLSX.utils.book_new();

  sheets.forEach(({ name, rows, columns }) => {
    // json_to_sheet no crea celda cuando el valor es null/undefined (queda "hueco" en el
    // XML) - eso corta el borde de la grilla en Debe/Haber vacíos. Se reemplaza por "" acá
    // para que toda fila tenga sus celdas y el borde cierre.
    const filas = aPlano(rows || [], columns).map((row) => {
      const copia = { ...row };
      columns.forEach((col) => {
        if (copia[col] === null || copia[col] === undefined) copia[col] = "";
      });
      return copia;
    });

    const worksheet = XLSX.utils.json_to_sheet(filas, { header: columns });

    columns.forEach((col, c) => {
      const headerCell = worksheet[XLSX.utils.encode_cell({ r: 0, c })];
      if (headerCell) headerCell.s = ESTILO_HEADER;
    });

    filas.forEach((row, r) => {
      // Fila separadora entre clientes (armarFilasCuentaCorriente empuja un objeto vacío):
      // sin contenido en ninguna columna - se deja sin bordes ni relleno, como un espacio
      // real entre tablas, no una fila más de la grilla.
      const esVacia = columns.every((col) => row[col] === "" || row[col] === null || row[col] === undefined);
      if (esVacia) return;

      const esMarcador = MARCADORES_CC.includes(row.Documento);
      const esFinal = row.Documento === "Saldo final";
      const estiloFila = esFinal ? ESTILO_SALDO_FINAL : esMarcador ? ESTILO_SALDO_INICIAL : ESTILO_NORMAL;

      columns.forEach((col, c) => {
        const cellRef = XLSX.utils.encode_cell({ r: r + 1, c });
        const cell = worksheet[cellRef];
        if (!cell) return;
        const esMonto = COLUMNAS_MONTO_CC.includes(col);
        cell.s = {
          ...estiloFila,
          ...(esMonto ? { numFmt: "#,##0.00", alignment: { horizontal: "right" } } : {}),
        };
      });
    });

    worksheet["!cols"] = columns.map((col) => ({ wch: ANCHOS_COLUMNA_CC[col] || 16 }));

    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  });

  XLSX.writeFile(workbook, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}
