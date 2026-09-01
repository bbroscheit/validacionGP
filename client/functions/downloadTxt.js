// Baja un .txt a partir de contenido en base64 (bytes Windows-1252, no UTF-8 - así lo
// exige ARCA para el Libro IVA Digital). No se puede usar TextEncoder ni Blob con un
// string JS común porque eso codificaría en UTF-8 y rompería tildes/ñ en el archivo.
export function downloadTxtFromBase64(base64, filename) {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);

  const blob = new Blob([bytes], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
