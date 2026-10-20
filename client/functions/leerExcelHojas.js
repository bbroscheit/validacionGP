import * as XLSX from "xlsx";

// Lee TODAS las hojas de un archivo .xlsx/.xls subido por el usuario, cada una como array
// de arrays (fila 0 = encabezado), sin asumir nombres de columna. Bancos Cobranzas: el
// usuario ahora entrega un solo excel con una hoja por banco (credicoop/chubut/provincia/
// frances) en vez de un excel por banco - el que sube el archivo decide a qué banco
// corresponde cada hoja mirando su nombre (ver movimientos.js).
export function leerExcelHojas(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target.result, { type: "array" });
        const hojas = workbook.SheetNames.map((nombreHoja) => ({
          nombreHoja,
          filas: XLSX.utils.sheet_to_json(workbook.Sheets[nombreHoja], { header: 1, raw: false, defval: "" }),
        }));
        resolve(hojas);
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}
