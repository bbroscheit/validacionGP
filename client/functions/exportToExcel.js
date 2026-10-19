import * as XLSX from "xlsx";

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

export function exportToExcel(rows, columns, filename) {
  if (!rows || rows.length === 0) return;

  const worksheet = XLSX.utils.json_to_sheet(aPlano(rows, columns), { header: columns });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Datos");
  XLSX.writeFile(workbook, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

// Para los reportes armados sobre una base (agregaciones, pivots): la primera hoja trae
// el detalle sin agrupar que se usó para calcular, la segunda el resultado que se ve en
// pantalla - así se puede controlar la cuenta línea por línea en el mismo Excel.
export function exportToExcelMultiHoja(sheets, filename) {
  const workbook = XLSX.utils.book_new();
  sheets.forEach(({ name, rows, columns }) => {
    const worksheet = XLSX.utils.json_to_sheet(aPlano(rows || [], columns), { header: columns });
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  });
  XLSX.writeFile(workbook, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}
