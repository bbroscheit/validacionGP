import * as XLSX from "xlsx";

// Lee un archivo .xlsx/.xls subido por el usuario y lo devuelve como array de arrays
// (fila 0 = encabezado), sin asumir nombres de columna - necesario para Bancos Cobranzas,
// donde cada banco entrega un formato distinto.
export function leerExcelFilas(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target.result, { type: "array" });
        const hoja = workbook.Sheets[workbook.SheetNames[0]];
        const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: "" });
        resolve(filas);
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}
