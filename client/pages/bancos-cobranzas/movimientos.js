import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/functions/apiFetch";
import { leerExcelFilas } from "@/functions/leerExcelFilas";

const BANCOS = [
  { id: "credicoop", nombre: "Credicoop" },
  { id: "frances", nombre: "Banco Francés" },
  { id: "provincia", nombre: "Banco Provincia" },
  { id: "chubut", nombre: "Banco Chubut" },
];

function hoyIso() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
}

function primerDiaDelMesIso() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`;
}

function formatMonto(n) {
  return (n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatFecha(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function BadgeResuelto({ fila }) {
  const numero = fila.custnmbrManual || fila.custnmbrCalculado;
  const nota = fila.custnmbrManual ? "Asignado manualmente" : null;
  return (
    <div>
      <span className="inline-block bg-green-50 text-green-700 border border-green-200 rounded px-2 py-0.5 text-xs font-semibold">
        {numero}
      </span>
      {nota && <div className="text-[11px] text-gray-500 mt-0.5">{nota}</div>}
    </div>
  );
}

export default function BancosCobranzasMovimientos() {
  const [banco, setBanco] = useState(BANCOS[0].id);
  const [desde, setDesde] = useState(primerDiaDelMesIso());
  const [hasta, setHasta] = useState(hoyIso());
  const [busquedaInput, setBusquedaInput] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [soloFaltantes, setSoloFaltantes] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [erroresFormato, setErroresFormato] = useState(null);
  const [conflictos, setConflictos] = useState(null);
  const [resumenSubida, setResumenSubida] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [borrador, setBorrador] = useState({});
  const [guardandoId, setGuardandoId] = useState(null);
  const inputFileRef = useRef(null);
  const debounceRef = useRef(null);

  const nombreBanco = BANCOS.find((b) => b.id === banco)?.nombre || banco;

  const consultar = async () => {
    if (!desde || !hasta) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ desde, hasta });
      if (busqueda) params.set("busqueda", busqueda);
      if (soloFaltantes) params.set("soloFaltantes", "true");
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/bancos-cobranzas/${banco}/movimientos?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al consultar");
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    consultar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banco, desde, hasta, busqueda, soloFaltantes]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setBusqueda(busquedaInput.trim()), 300);
    return () => clearTimeout(debounceRef.current);
  }, [busquedaInput]);

  const subirArchivo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSubiendo(true);
    setError("");
    setConflictos(null);
    setErroresFormato(null);
    setResumenSubida(null);
    try {
      const filas = await leerExcelFilas(file);
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/bancos-cobranzas/${banco}/movimientos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filas }),
      });
      const json = await res.json();
      if (res.status === 409) {
        setConflictos(json.conflictos || []);
        return;
      }
      if (res.status === 422) {
        setErroresFormato(json.errores || []);
        return;
      }
      if (!res.ok) throw new Error(json.message || "Error al procesar el archivo");
      setResumenSubida(json);
      await consultar();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubiendo(false);
    }
  };

  const guardarNumeroManual = async (fila) => {
    const valor = borrador[fila.id];
    if (valor === undefined) return;
    if (valor.trim() === (fila.custnmbrManual || "")) {
      setBorrador((prev) => {
        const { [fila.id]: _omit, ...resto } = prev;
        return resto;
      });
      return;
    }
    setGuardandoId(fila.id);
    setError("");
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/bancos-cobranzas/movimientos/${fila.id}/numero-cliente`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ custnmbrManual: valor }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al guardar");
      setBorrador((prev) => {
        const { [fila.id]: _omit, ...resto } = prev;
        return resto;
      });
      await consultar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoId(null);
    }
  };

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Bancos Cobranzas - Movimientos</h1>
      {/* <p className="text-sm text-gray-600 mb-4">
        Subí el excel de cada banco (queda guardado, no hace falta volver a subirlo para consultarlo),
        filtrá por rango de fechas y completá el número de cliente cuando GP no pudo identificarlo solo.
      </p> */}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div role="tablist" aria-label="Banco" className="inline-flex gap-1 bg-gray-100 rounded-lg p-1">
          {BANCOS.map((b) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={b.id === banco}
              onClick={() => setBanco(b.id)}
              className={`text-sm font-medium px-3 py-1.5 rounded-md ${
                b.id === banco ? "bg-white shadow-sm text-gray-900" : "text-gray-600"
              }`}
            >
              {b.nombre}
            </button>
          ))}
        </div>

        <label className="inline-flex items-center gap-2 bg-[var(--color-primary)] text-white rounded px-3 py-1.5 text-sm font-medium cursor-pointer disabled:opacity-60">
          {subiendo ? "Procesando..." : `Subir Excel de ${nombreBanco}`}
          <input
            ref={inputFileRef}
            type="file"
            accept=".xlsx,.xls"
            disabled={subiendo}
            onChange={subirArchivo}
            className="hidden"
            aria-label={`Subir Excel de ${nombreBanco}`}
          />
        </label>
      </div>

      <div className="bg-white border border-[var(--color-border)] rounded-lg p-4 flex flex-wrap items-end gap-4 mb-4">
        <div>
          <label className="block text-sm mb-1">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
        </div>
        <div>
          <label className="block text-sm mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
        </div>
        <div className="flex-1 min-w-[220px]">
          <label className="block text-sm mb-1">Buscar por cliente, concepto u observaciones</label>
          <input
            value={busquedaInput}
            onChange={(e) => setBusquedaInput(e.target.value)}
            placeholder="Ej: cooperativa, C-04821..."
            className="border border-[var(--color-border)] rounded px-2 py-1 w-full"
          />
        </div>
        <label className="flex items-center gap-2 text-sm pb-1.5 cursor-pointer whitespace-nowrap">
          <input type="checkbox" checked={soloFaltantes} onChange={(e) => setSoloFaltantes(e.target.checked)} />
          Mostrar solo sin identificar
        </label>
      </div>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      {resumenSubida && (
        <p className="text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 text-sm mb-4">
          Archivo procesado: {resumenSubida.insertados} fila(s) nueva(s), {resumenSubida.actualizados} actualizada(s) de {resumenSubida.totalFilas} en total.
        </p>
      )}

      {erroresFormato && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <p className="text-sm font-semibold text-red-700 mb-2">
            No se cargó el archivo: hay filas con fecha o importe que no se pudieron interpretar
          </p>
          <ul className="text-xs text-red-700 list-disc pl-5">
            {erroresFormato.map((e, i) => (
              <li key={i}>Fila {e.numeroFila}, columna {e.columna}: &quot;{e.valorCrudo}&quot;</li>
            ))}
          </ul>
        </div>
      )}

      {conflictos && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-red-700 mb-1">No se cargó el archivo: hay filas iguales entre sí</p>
              <p className="text-xs text-red-700 max-w-2xl">
                Estas filas tienen la misma fecha, concepto, importe y observaciones, así que no se puede saber si son
                una sola operación repetida en el excel o dos operaciones reales. Si es la misma operación repetida,
                borrá la fila de más; si son operaciones reales, agregale a una algo que la distinga (por ejemplo un
                comentario en Observaciones) y volvé a subirlo.
              </p>
            </div>
            <button type="button" onClick={() => setConflictos(null)} className="text-red-700 text-xl leading-none px-1" aria-label="Cerrar">
              &times;
            </button>
          </div>
          <table className="w-full text-xs mt-3">
            <thead>
              <tr className="text-left text-red-700">
                <th className="py-1 pr-3">Filas en el excel</th>
                <th className="py-1 pr-3">Fecha</th>
                <th className="py-1 pr-3">Concepto</th>
                <th className="py-1 pr-3 text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {conflictos.map((c, i) => (
                <tr key={i} className="text-red-700 border-t border-red-200">
                  <td className="py-1 pr-3">{c.filas.join(", ")}</td>
                  <td className="py-1 pr-3">{formatFecha(c.fecha)}</td>
                  <td className="py-1 pr-3">{c.concepto}</td>
                  <td className="py-1 pr-3 text-right">{formatMonto(c.importe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="flex items-center gap-3 text-sm text-gray-600 mb-3">
          <span><strong className="text-gray-900">{data.totalFilas}</strong> movimientos en el rango</span>
          <span className="text-gray-300">&bull;</span>
          <span><strong className="text-red-600">{data.totalFaltantes}</strong> sin identificar</span>
          {loading && <span className="text-gray-400">Actualizando...</span>}
        </div>
      )}

      {data && data.truncated && (
        <p className="text-red-600 mb-4 font-semibold">
          ⚠ Hay más de 20000 movimientos en este rango - se usaron solo los primeros. Avisá si esto pasa de verdad.
        </p>
      )}

      <div className="bg-white border border-[var(--color-border)] rounded-lg overflow-hidden">
        <div className="overflow-auto max-h-[560px]">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Fecha</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Concepto</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Importe</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Observaciones</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Estado</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Número de cliente</th>
              </tr>
            </thead>
            <tbody>
              {data?.filas.map((fila) => (
                <tr key={fila.id} className="border-b border-[var(--color-border)]">
                  <td className="px-4 py-2 whitespace-nowrap">{formatFecha(fila.fecha)}</td>
                  <td className="px-4 py-2">{fila.concepto}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap tabular-nums">{formatMonto(fila.importe)}</td>
                  <td className="px-4 py-2">{fila.observaciones}</td>
                  <td className="px-4 py-2 text-xs text-gray-600">{fila.estadoBanco}</td>
                  <td className="px-4 py-2">
                    {fila.pendiente ? (
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-block w-fit rounded px-2 py-0.5 text-xs font-semibold border ${
                            fila.estadoMatch === "varios"
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-red-50 text-red-700 border-red-200"
                          }`}
                        >
                          {fila.estadoMatch === "varios" ? `VARIOS: ${fila.candidatosAmbiguos}` : "NO ENCONTRADO"}
                        </span>
                        <input
                          type="text"
                          value={borrador[fila.id] !== undefined ? borrador[fila.id] : fila.custnmbrManual || ""}
                          onChange={(e) => setBorrador((prev) => ({ ...prev, [fila.id]: e.target.value }))}
                          onBlur={() => guardarNumeroManual(fila)}
                          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                          placeholder="Escribir N° de cliente"
                          disabled={guardandoId === fila.id}
                          aria-label="Número de cliente para este movimiento"
                          className="border border-[var(--color-border)] rounded px-2 py-1 text-xs w-44 disabled:opacity-60"
                        />
                      </div>
                    ) : (
                      <BadgeResuelto fila={fila} />
                    )}
                  </td>
                </tr>
              ))}
              {data && data.filas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                    Sin movimientos en el rango elegido.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-2">
        Los cambios de número de cliente se guardan solos apenas se escriben (al salir del campo); no hace falta volver
        a subir el excel.
      </p>
    </div>
  );
}
