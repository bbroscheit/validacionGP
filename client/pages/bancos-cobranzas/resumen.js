import { useRef, useState } from "react";
import { apiFetch } from "@/functions/apiFetch";
import { leerExcelFilas } from "@/functions/leerExcelFilas";
import { exportAoaToExcel } from "@/functions/exportToExcel";

// Bancos con parser implementado en el servidor (procesarCobranzasBanco.js) - los demás
// muestran el botón de subida pero avisan que falta el formato hasta tener un excel de
// ejemplo de ese banco.
const BANCOS = [
  { id: "credicoop", nombre: "Credicoop", implementado: true },
  { id: "frances", nombre: "Banco Francés", implementado: true },
  { id: "provincia", nombre: "Banco Provincia", implementado: true },
  { id: "chubut", nombre: "Banco Chubut", implementado: true },
];

function TarjetaBanco({ banco }) {
  const inputRef = useRef(null);
  const [estado, setEstado] = useState({ filas: null, nombreArchivo: "", cargando: false, error: "" });

  const subirArchivo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!banco.implementado) {
      setEstado((prev) => ({ ...prev, error: `El formato de ${banco.nombre} todavía no está implementado.` }));
      return;
    }

    setEstado({ filas: null, nombreArchivo: file.name, cargando: true, error: "" });
    try {
      const filas = await leerExcelFilas(file);
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/bancos-cobranzas/${banco.id}/procesar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filas }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al procesar el archivo");
      setEstado({ filas: json.filas, nombreArchivo: file.name, cargando: false, error: "" });
    } catch (err) {
      setEstado({ filas: null, nombreArchivo: file.name, cargando: false, error: err.message });
    }
  };

  const descargar = () => {
    if (!estado.filas) return;
    exportAoaToExcel(estado.filas, `cobranzas-${banco.id}-procesado`);
  };

  return (
    <div className="border border-[var(--color-border)] rounded-lg p-4 flex flex-col gap-3">
      <h2 className="font-semibold">{banco.nombre}</h2>

      {!banco.implementado && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">Formato pendiente de implementar</p>
      )}

      <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={subirArchivo} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={estado.cargando}
        className="bg-[var(--color-primary)] text-white rounded px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {estado.cargando ? "Procesando..." : "Subir Excel"}
      </button>

      {estado.nombreArchivo && !estado.error && (
        <p className="text-xs text-gray-600 truncate">{estado.nombreArchivo}</p>
      )}
      {estado.error && <p className="text-xs text-red-600">{estado.error}</p>}
      {estado.filas && (
        <p className="text-xs text-green-700">{estado.filas.length - 1} movimientos procesados</p>
      )}

      <button
        type="button"
        onClick={descargar}
        disabled={!estado.filas}
        className="bg-green-700 text-white rounded px-3 py-1.5 text-sm disabled:opacity-40"
      >
        Descargar Excel procesado
      </button>
    </div>
  );
}

export default function BancosCobranzasResumen() {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Bancos Cobranzas - Resumen</h1>
      <p className="text-sm text-gray-600 mb-4">
        Subí el excel de movimientos de cada banco (tal cual lo entrega, cada uno tiene su
        propio formato) y descargá el mismo archivo con una columna &quot;Número de
        Cliente&quot; agregada, buscando cada movimiento por CUIT o nombre en la base de
        clientes de GP. Si el CUIT coincide con más de un cliente, la columna queda
        marcada como &quot;VARIOS&quot; para revisar a mano; si no se encuentra ninguno,
        queda &quot;NO ENCONTRADO&quot;.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {BANCOS.map((banco) => (
          <TarjetaBanco key={banco.id} banco={banco} />
        ))}
      </div>
    </div>
  );
}
