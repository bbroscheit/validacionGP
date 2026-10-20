import * as XLSX from "xlsx";

// Lee TODAS las hojas de un archivo .xlsx/.xls subido por el usuario, cada una como array
// de arrays (fila 0 = encabezado), sin asumir nombres de columna. Bancos Cobranzas: el
// usuario ahora entrega un solo excel con una hoja por banco (credicoop/chubut/provincia/
// frances) en vez de un excel por banco - el que sube el archivo decide a qué banco
// corresponde cada hoja mirando su nombre (ver movimientos.js).
//
// `cellDates: true` + `raw: true` (en vez de `raw: false`, que tenía esto antes): las
// celdas de FECHA/IMPORTE del excel real de los bancos son celdas de fecha/moneda
// genuinas de Excel, no texto. `raw: false` las reformatea con el formateador propio de
// la librería (SheetJS), que no respeta el formato con el que se ve la celda en Excel ni
// la zona horaria local - confirmado con un excel real: una celda de fecha mostrada como
// "9/10/2026" en Excel llegaba como "10/8/26" (mes/día invertido, año a 2 dígitos, Y UN
// DÍA MENOS por la conversión de huso horario al formatear). Con `raw: true` la fecha
// llega como un objeto Date en UTC (se serializa solo, vía JSON.stringify, a
// "2026-10-09T00:00:00.000Z" al mandarla al servidor - ver parsearFecha en
// movimientosBanco.js) y el importe llega como el número de JS tal cual, sin pasar por
// ningún formato de miles/decimales. Las celdas de texto (CONCEPTO, OBSERVACIONES,
// ESTADO) no cambian con este flag - solo afecta a celdas tipadas como fecha/número.
export function leerExcelHojas(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target.result, { type: "array", cellDates: true });
        const hojas = workbook.SheetNames.map((nombreHoja) => ({
          nombreHoja,
          filas: XLSX.utils.sheet_to_json(workbook.Sheets[nombreHoja], { header: 1, raw: true, defval: "" }),
        }));
        resolve(hojas);
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}
