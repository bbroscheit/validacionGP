import { useState } from "react";

function formatMonto(n) {
  return (n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Modal reutilizable para "Ventas por sucursal" y "Ventas por provincia": muestra los
// comprobantes que componen un grupo (sucursal o provincia) y permite corregir el valor
// de cada uno a mano cuando GP lo trae en blanco o mal cargado. La corrección se guarda
// en Postgres (api/src/models/ClasificacionOverride.js) por comprobante, así persiste
// entre búsquedas en vez de perderse cada vez que se vuelve a generar el reporte.
export default function DocumentosClasificacionModal({
  empresa,
  tipo,
  campo,
  campoLabel,
  valorGrupo,
  documentos,
  sugerencias,
  modoSeleccion = "libre", // "libre": input + datalist (sugiere pero permite texto libre) | "lista": select cerrado a `sugerencias`
  onClose,
  onGuardado,
}) {
  const [editando, setEditando] = useState(null);
  const [valorEdit, setValorEdit] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errorEdit, setErrorEdit] = useState("");

  const datalistId = `sugerencias-${empresa}-${tipo}`;

  const empezarEdicion = (row) => {
    setEditando(row.Comprobante);
    setValorEdit(row[campo] === "En Blanco" ? "" : row[campo]);
    setErrorEdit("");
  };

  const guardar = async (row) => {
    if (!valorEdit.trim()) return;
    setGuardando(true);
    setErrorEdit("");
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/overrides/clasificacion`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empresa,
          tipo,
          comprobante: row.Comprobante,
          valor: valorEdit.trim(),
          valorOriginal: row[campo],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al guardar");
      setEditando(null);
      onGuardado();
    } catch (err) {
      setErrorEdit(err.message);
    } finally {
      setGuardando(false);
    }
  };

  const revertir = async (row) => {
    setGuardando(true);
    setErrorEdit("");
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/overrides/clasificacion`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, tipo, comprobante: row.Comprobante }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al revertir");
      onGuardado();
    } catch (err) {
      setErrorEdit(err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <h2 className="font-semibold">Documentos - {valorGrupo} ({documentos.length})</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-xl leading-none px-2">
            &times;
          </button>
        </div>

        {errorEdit && <p className="text-red-600 text-sm px-4 pt-2">{errorEdit}</p>}

        {modoSeleccion === "libre" && (
          <datalist id={datalistId}>
            {sugerencias.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}

        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Comprobante</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Fecha</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Cliente</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Nombre</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">{campoLabel}</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Neto</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Impuestos</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Total</th>
              </tr>
            </thead>
            <tbody>
              {documentos.map((row, i) => (
                <tr key={row.Comprobante} className={i % 2 ? "" : "bg-gray-50/60"}>
                  <td className="px-4 py-2 border-b border-[var(--color-border)]">{row.Comprobante}</td>
                  <td className="px-4 py-2 border-b border-[var(--color-border)]">{row.DOCDATE ? new Date(row.DOCDATE).toLocaleDateString("es-AR") : ""}</td>
                  <td className="px-4 py-2 border-b border-[var(--color-border)]">{row.Cliente}</td>
                  <td className="px-4 py-2 border-b border-[var(--color-border)]">{row.NombreCliente}</td>
                  <td className="px-4 py-2 border-b border-[var(--color-border)]">
                    {editando === row.Comprobante ? (
                      <div className="flex items-center gap-1">
                        {modoSeleccion === "lista" ? (
                          <select
                            autoFocus
                            value={valorEdit}
                            onChange={(e) => setValorEdit(e.target.value)}
                            className="border border-[var(--color-border)] rounded px-1 py-0.5 text-sm w-40"
                          >
                            <option value="" disabled>Elegir...</option>
                            {sugerencias.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            list={datalistId}
                            autoFocus
                            value={valorEdit}
                            onChange={(e) => setValorEdit(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && guardar(row)}
                            className="border border-[var(--color-border)] rounded px-1 py-0.5 text-sm w-36"
                          />
                        )}
                        <button disabled={guardando} onClick={() => guardar(row)} className="text-green-700 text-xs px-1" title="Guardar">
                          ✓
                        </button>
                        <button disabled={guardando} onClick={() => setEditando(null)} className="text-gray-500 text-xs px-1" title="Cancelar">
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span>{row[campo]}</span>
                        {row.Editado && (
                          <span className="text-[10px] bg-amber-100 text-amber-700 rounded px-1 leading-4">editado</span>
                        )}
                        <button onClick={() => empezarEdicion(row)} className="text-blue-600 text-xs hover:underline">
                          editar
                        </button>
                        {row.Editado && (
                          <button disabled={guardando} onClick={() => revertir(row)} className="text-gray-500 text-xs hover:underline">
                            revertir
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(row.Neto)}</td>
                  <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(row.Impuestos)}</td>
                  <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(row.Total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
