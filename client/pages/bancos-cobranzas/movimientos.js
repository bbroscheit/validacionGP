import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/functions/apiFetch";
import { leerExcelHojas } from "@/functions/leerExcelHojas";
import { exportToExcel } from "@/functions/exportToExcel";

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

function numeroClienteMostrado(fila) {
  if (fila.custnmbrManual) return fila.custnmbrManual;
  if (fila.estadoMatch === "identificado") return fila.custnmbrCalculado;
  if (fila.estadoMatch === "varios") return `VARIOS: ${fila.candidatosAmbiguos}`;
  return "NO ENCONTRADO";
}

const COLUMNAS_EXCEL = ["Fecha", "Concepto", "Importe", "Observaciones", "Estado", "Número de cliente", "Recibo en GP"];

// El excel que entregan los bancos ahora trae las 4 hojas (una por banco) en un solo
// archivo - el nombre de cada hoja debería ser el id del banco, pero no tenemos un excel
// real a mano para confirmar mayúsculas/acentos exactos, así que se normaliza antes de
// comparar (sin tildes, minúscula, sin espacios de más).
function normalizarNombreHoja(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function BadgeResuelto({ fila, onEditar }) {
  const numero = fila.custnmbrManual || fila.custnmbrCalculado;
  const nota = fila.custnmbrManual ? "Asignado manualmente" : null;
  return (
    <div className="flex items-start gap-2">
      <div>
        <span className="inline-block bg-green-50 text-green-700 border border-green-200 rounded px-2 py-0.5 text-xs font-semibold">
          {numero}
        </span>
        {nota && <div className="text-[11px] text-gray-500 mt-0.5">{nota}</div>}
      </div>
      <button type="button" onClick={onEditar} className="text-blue-600 text-xs hover:underline">
        editar
      </button>
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
  const [filtroRecibo, setFiltroRecibo] = useState("");
  const [sucursal, setSucursal] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resultadosSubida, setResultadosSubida] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [borrador, setBorrador] = useState({});
  const [editandoId, setEditandoId] = useState(null);
  const [guardandoId, setGuardandoId] = useState(null);
  const [guardandoReciboId, setGuardandoReciboId] = useState(null);
  const inputFileRef = useRef(null);
  const debounceRef = useRef(null);

  const consultar = async () => {
    if (!desde || !hasta) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ desde, hasta });
      if (busqueda) params.set("busqueda", busqueda);
      if (soloFaltantes) params.set("soloFaltantes", "true");
      if (filtroRecibo) params.set("filtroRecibo", filtroRecibo);
      if (sucursal) params.set("sucursal", sucursal);
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
  }, [banco, desde, hasta, busqueda, soloFaltantes, filtroRecibo, sucursal]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setBusqueda(busquedaInput.trim()), 300);
    return () => clearTimeout(debounceRef.current);
  }, [busquedaInput]);

  // El excel que sube el usuario trae una hoja por banco (credicoop/chubut/provincia/
  // frances, en cualquier orden) - se procesa cada hoja por separado contra el endpoint
  // de siempre (una hoja = un banco = el mismo contrato de antes), así un conflicto o un
  // error de formato en un banco no bloquea a los demás.
  const subirArchivoBancos = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSubiendo(true);
    setError("");
    setResultadosSubida(null);
    try {
      const hojas = await leerExcelHojas(file);
      const resultados = [];

      for (const hoja of hojas) {
        const bancoHoja = BANCOS.find((b) => normalizarNombreHoja(b.id) === normalizarNombreHoja(hoja.nombreHoja));
        if (!bancoHoja) {
          resultados.push({ tipo: "no_reconocida", nombreHoja: hoja.nombreHoja });
          continue;
        }
        if (!Array.isArray(hoja.filas) || hoja.filas.length < 2) {
          resultados.push({ tipo: "vacia", banco: bancoHoja.id, nombreBanco: bancoHoja.nombre });
          continue;
        }
        try {
          const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/bancos-cobranzas/${bancoHoja.id}/movimientos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filas: hoja.filas }),
          });
          const json = await res.json();
          if (res.status === 409) {
            resultados.push({ tipo: "conflicto", banco: bancoHoja.id, nombreBanco: bancoHoja.nombre, conflictos: json.conflictos || [] });
          } else if (res.status === 422) {
            resultados.push({ tipo: "formato_invalido", banco: bancoHoja.id, nombreBanco: bancoHoja.nombre, errores: json.errores || [] });
          } else if (!res.ok) {
            resultados.push({ tipo: "error", banco: bancoHoja.id, nombreBanco: bancoHoja.nombre, mensaje: json.message || "Error al procesar" });
          } else {
            resultados.push({ tipo: "ok", banco: bancoHoja.id, nombreBanco: bancoHoja.nombre, ...json });
          }
        } catch (err) {
          resultados.push({ tipo: "error", banco: bancoHoja.id, nombreBanco: bancoHoja.nombre, mensaje: err.message });
        }
      }

      setResultadosSubida(resultados);
      await consultar();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubiendo(false);
    }
  };

  const toggleRecibo = async (fila, valor) => {
    setGuardandoReciboId(fila.id);
    setError("");
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/bancos-cobranzas/movimientos/${fila.id}/recibo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reciboCreado: valor }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al guardar");
      await consultar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoReciboId(null);
    }
  };

  // Exporta exactamente lo que se ve en pantalla (ya filtrado por banco/fechas/busqueda/
  // sin identificar/recibo/sucursal - data.filas ya viene filtrado del servidor).
  const descargarExcel = () => {
    const filasExport = (data?.filas || []).map((fila) => ({
      Fecha: formatFecha(fila.fecha),
      Concepto: fila.concepto,
      Importe: fila.importe,
      Observaciones: fila.observaciones,
      Estado: fila.estadoBanco,
      "Número de cliente": numeroClienteMostrado(fila),
      "Recibo en GP": fila.reciboCreado ? "Sí" : "No",
    }));
    exportToExcel(filasExport, COLUMNAS_EXCEL, `movimientos-${banco}-${desde}-a-${hasta}`);
  };

  const guardarNumeroManual = async (fila) => {
    const valor = borrador[fila.id];
    if (valor === undefined) return;
    // Comparado contra lo que el input ya mostraba (manual, o si no había manual el
    // calculado por el sistema) - abrir "editar" en una fila ya identificada y cerrar sin
    // tocar nada no debe generar una asignación manual de la nada.
    if (valor.trim() === (fila.custnmbrManual || fila.custnmbrCalculado || "")) {
      setBorrador((prev) => {
        const { [fila.id]: _omit, ...resto } = prev;
        return resto;
      });
      setEditandoId((actual) => (actual === fila.id ? null : actual));
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
      setEditandoId((actual) => (actual === fila.id ? null : actual));
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
      <p className="text-sm text-gray-600 mb-4">
        Subí el excel con las 4 hojas (Credicoop, Chubut, Provincia y Francés) - queda
        guardado, no hace falta volver a subirlo para consultarlo. Elegí un banco con las
        pestañas para ver sus movimientos, filtrar por rango de fechas y completar el
        número de cliente cuando GP no pudo identificarlo solo.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div role="tablist" aria-label="Banco" className="inline-flex gap-1 bg-gray-100 rounded-lg p-1">
          {BANCOS.map((b) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={b.id === banco}
              onClick={() => {
                setBanco(b.id);
                setSucursal("");
              }}
              className={`text-sm font-medium px-3 py-1.5 rounded-md ${
                b.id === banco ? "bg-white shadow-sm text-gray-900" : "text-gray-600"
              }`}
            >
              {b.nombre}
            </button>
          ))}
        </div>

        <label className="inline-flex items-center gap-2 bg-[var(--color-primary)] text-white rounded px-3 py-1.5 text-sm font-medium cursor-pointer disabled:opacity-60">
          {subiendo ? "Procesando..." : "Subir Excel de bancos"}
          <input
            ref={inputFileRef}
            type="file"
            accept=".xlsx,.xls"
            disabled={subiendo}
            onChange={subirArchivoBancos}
            className="hidden"
            aria-label="Subir Excel de bancos (una hoja por banco)"
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
        <div>
          <label className="block text-sm mb-1">Sucursal (columna Estado)</label>
          <select
            value={sucursal}
            onChange={(e) => setSucursal(e.target.value)}
            className="border border-[var(--color-border)] rounded px-2 py-1.5"
          >
            <option value="">Todas</option>
            {(data?.sucursalesDisponibles || []).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm mb-1">Recibo en GP</label>
          <select
            value={filtroRecibo}
            onChange={(e) => setFiltroRecibo(e.target.value)}
            className="border border-[var(--color-border)] rounded px-2 py-1.5"
          >
            <option value="">Todos</option>
            <option value="si">Con recibo creado</option>
            <option value="no">Sin recibo creado</option>
          </select>
        </div>
      </div>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      {resultadosSubida && (
        <div className="flex flex-col gap-3 mb-4">
          {resultadosSubida.map((r, i) => (
            <div
              key={i}
              className={`rounded-lg border p-3 ${
                r.tipo === "ok"
                  ? "bg-green-50 border-green-200"
                  : r.tipo === "vacia" || r.tipo === "no_reconocida"
                  ? "bg-gray-50 border-gray-200"
                  : "bg-red-50 border-red-200"
              }`}
            >
              {r.tipo === "no_reconocida" && (
                <p className="text-sm text-gray-600">
                  La hoja &quot;{r.nombreHoja}&quot; no se reconoce como ninguno de los 4 bancos - se ignoró.
                </p>
              )}
              {r.tipo === "vacia" && (
                <p className="text-sm text-gray-600">{r.nombreBanco}: la hoja no tiene filas de datos.</p>
              )}
              {r.tipo === "ok" && (
                <p className="text-sm text-green-700">
                  {r.nombreBanco}: {r.insertados} fila(s) nueva(s), {r.actualizados} actualizada(s) de {r.totalFilas} en total.
                </p>
              )}
              {r.tipo === "error" && (
                <p className="text-sm text-red-700">{r.nombreBanco}: error al procesar - {r.mensaje}</p>
              )}
              {r.tipo === "formato_invalido" && (
                <div>
                  <p className="text-sm font-semibold text-red-700 mb-2">
                    {r.nombreBanco}: no se cargó, hay filas con fecha o importe que no se pudieron interpretar
                  </p>
                  <ul className="text-xs text-red-700 list-disc pl-5">
                    {r.errores.map((e, j) => (
                      <li key={j}>Fila {e.numeroFila}, columna {e.columna}: &quot;{e.valorCrudo}&quot;</li>
                    ))}
                  </ul>
                </div>
              )}
              {r.tipo === "conflicto" && (
                <div>
                  <p className="text-sm font-semibold text-red-700 mb-1">{r.nombreBanco}: no se cargó, hay filas iguales entre sí</p>
                  <p className="text-xs text-red-700 max-w-2xl mb-2">
                    Estas filas tienen la misma fecha, concepto, importe y observaciones, así que no se puede saber si
                    son una sola operación repetida en el excel o dos operaciones reales. Si es la misma operación
                    repetida, borrá la fila de más; si son operaciones reales, agregale a una algo que la distinga (por
                    ejemplo un comentario en Observaciones) y volvé a subir el excel de nuevo.
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-red-700">
                        <th className="py-1 pr-3">Filas en la hoja</th>
                        <th className="py-1 pr-3">Fecha</th>
                        <th className="py-1 pr-3">Concepto</th>
                        <th className="py-1 pr-3 text-right">Importe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.conflictos.map((c, j) => (
                        <tr key={j} className="text-red-700 border-t border-red-200">
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
            </div>
          ))}
        </div>
      )}

      {data && (
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <span><strong className="text-gray-900">{data.totalFilas}</strong> movimientos en el rango</span>
            <span className="text-gray-300">&bull;</span>
            <span><strong className="text-red-600">{data.totalFaltantes}</strong> sin identificar</span>
            {loading && <span className="text-gray-400">Actualizando...</span>}
          </div>
          <button
            type="button"
            onClick={descargarExcel}
            disabled={data.filas.length === 0}
            className="text-xs bg-green-700 text-white rounded px-3 py-1 disabled:opacity-40"
          >
            Descargar Excel
          </button>
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
                <th className="px-4 py-2 text-center font-medium text-gray-600 border-b border-[var(--color-border)]">Recibo en GP</th>
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
                    {fila.pendiente || editandoId === fila.id ? (
                      <div className="flex flex-col gap-1">
                        {fila.pendiente && (
                          <span
                            className={`inline-block w-fit rounded px-2 py-0.5 text-xs font-semibold border ${
                              fila.estadoMatch === "varios"
                                ? "bg-amber-50 text-amber-700 border-amber-200"
                                : "bg-red-50 text-red-700 border-red-200"
                            }`}
                          >
                            {fila.estadoMatch === "varios" ? `VARIOS: ${fila.candidatosAmbiguos}` : "NO ENCONTRADO"}
                          </span>
                        )}
                        <input
                          type="text"
                          autoFocus={editandoId === fila.id}
                          value={
                            borrador[fila.id] !== undefined
                              ? borrador[fila.id]
                              : fila.custnmbrManual || fila.custnmbrCalculado || ""
                          }
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
                      <BadgeResuelto
                        fila={fila}
                        onEditar={() => {
                          setBorrador((prev) => ({ ...prev, [fila.id]: fila.custnmbrManual || fila.custnmbrCalculado || "" }));
                          setEditandoId(fila.id);
                        }}
                      />
                    )}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={!!fila.reciboCreado}
                      onChange={(e) => toggleRecibo(fila, e.target.checked)}
                      disabled={guardandoReciboId === fila.id}
                      aria-label="Recibo ya creado en GP para este movimiento"
                      className="w-4 h-4 disabled:opacity-60"
                    />
                  </td>
                </tr>
              ))}
              {data && data.filas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                    Sin movimientos en el rango elegido.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-2">
        Los cambios de número de cliente y de recibo en GP se guardan solos (al salir del campo, o al tildar el
        checkbox); no hace falta volver a subir el excel.
      </p>
    </div>
  );
}
