import { useEffect, useRef, useState } from "react";
import { exportToExcel, exportToExcelMultiHoja } from "@/functions/exportToExcel";

const CLIENTES_POR_PAGINA = 10;

function formatMonto(n) {
  return (n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatFecha(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-AR", { timeZone: "UTC" });
}

export default function CuentaCorrienteSist2() {
  const [busqueda, setBusqueda] = useState("");
  const [opciones, setOpciones] = useState([]);
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pagina, setPagina] = useState(1);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (clienteSeleccionado && busqueda === `${clienteSeleccionado.CUSTNMBR} - ${clienteSeleccionado.CUSTNAME}`) return;
    setClienteSeleccionado(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (busqueda.trim().length < 2) {
      setOpciones([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setBuscandoCliente(true);
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/reportes/sist2/clientes?q=${encodeURIComponent(busqueda.trim())}`);
        const json = await res.json();
        setOpciones(Array.isArray(json) ? json : []);
      } catch {
        setOpciones([]);
      } finally {
        setBuscandoCliente(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda]);

  const elegirCliente = (c) => {
    setClienteSeleccionado(c);
    setBusqueda(`${c.CUSTNMBR} - ${c.CUSTNAME}`);
    setOpciones([]);
  };

  const consultar = async (custnmbr) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (custnmbr) params.set("cliente", custnmbr);
      if (fechaDesde) params.set("fechaDesde", fechaDesde);
      if (fechaHasta) params.set("fechaHasta", fechaHasta);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/reportes/sist2/cuenta-corriente?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al consultar");
      setData(json);
      setPagina(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const buscar = (e) => {
    e.preventDefault();
    // Sin cliente elegido trae el listado de todos los clientes con saldo.
    consultar(clienteSeleccionado ? clienteSeleccionado.CUSTNMBR : null);
  };

  // El Excel siempre exporta TODOS los clientes de data.clientes, no solo la página
  // que se está viendo - dos pestañas: un resumen (un renglón por cliente) y el
  // detalle completo (todos los movimientos de todos los clientes, uno debajo del otro).
  const descargarExcelListado = () => {
    if (!data || data.modo !== "listado") return;
    const resumen = data.clientes.map((c) => ({
      Cliente: c.CUSTNMBR, Nombre: c.CUSTNAME, SaldoInicial: c.saldoInicial, SaldoFinal: c.saldoFinal,
    }));
    const detalle = data.clientes.flatMap((c) => c.movimientos.map((m) => ({
      Cliente: c.CUSTNMBR, Nombre: c.CUSTNAME, Fecha: m.Fecha, Documento: m.Documento, Monto: m.Monto, Saldo: m.Saldo,
    })));
    exportToExcelMultiHoja(
      [
        { name: "Resumen", rows: resumen, columns: ["Cliente", "Nombre", "SaldoInicial", "SaldoFinal"] },
        { name: "Detalle", rows: detalle, columns: ["Cliente", "Nombre", "Fecha", "Documento", "Monto", "Saldo"] },
      ],
      "cuenta-corriente-todos-los-clientes"
    );
  };

  const totalPaginas = data && data.modo === "listado" ? Math.max(1, Math.ceil(data.clientes.length / CLIENTES_POR_PAGINA)) : 1;
  const clientesPagina = data && data.modo === "listado"
    ? data.clientes.slice((pagina - 1) * CLIENTES_POR_PAGINA, pagina * CLIENTES_POR_PAGINA)
    : [];

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Cuenta corriente de cliente (Sist2)</h1>
      <p className="text-sm text-gray-600 mb-4">
        Historial completo del cliente (RM20101 - facturas, devoluciones, notas de crédito/débito
        y recibos, todas en una sola tabla). El saldo inicial suma TODO lo anterior a la fecha
        &quot;desde&quot;, no solo el rango elegido, para que el saldo corrido sea el saldo real.
        Dejando el campo Cliente en blanco trae el listado de todos los clientes con saldo -
        hacé clic en uno para ver su detalle.
      </p>

      <form onSubmit={buscar} className="flex flex-wrap gap-3 items-end mb-6">
        <div className="relative">
          <label className="block text-sm mb-1">Cliente</label>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por código o nombre (en blanco = todos)..."
            className="border border-[var(--color-border)] rounded px-2 py-1 w-64"
          />
          {busqueda.trim().length >= 2 && !clienteSeleccionado && (
            <div className="absolute left-0 top-full mt-1 w-full max-h-60 overflow-y-auto rounded border border-[var(--color-border)] bg-white shadow-lg z-10">
              {buscandoCliente && <div className="px-3 py-2 text-sm text-gray-500">Buscando...</div>}
              {!buscandoCliente && opciones.length === 0 && (
                <div className="px-3 py-2 text-sm text-gray-500">Sin resultados</div>
              )}
              {opciones.map((c) => (
                <button
                  type="button"
                  key={c.CUSTNMBR}
                  onClick={() => elegirCliente(c)}
                  className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                >
                  <span className="font-medium">{c.CUSTNMBR}</span> - {c.CUSTNAME}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm mb-1">Fecha desde</label>
          <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
        </div>
        <div>
          <label className="block text-sm mb-1">Fecha hasta</label>
          <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
        </div>
        <button type="submit" disabled={loading} className="bg-[var(--color-primary)] text-white rounded px-4 py-1.5">
          {loading ? "Buscando..." : "Buscar"}
        </button>
      </form>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      {data && data.truncated && (
        <p className="text-red-600 mb-4 font-semibold">
          ⚠ Este cliente tiene más de 20000 movimientos - se usaron solo los primeros. Avisá si esto pasa de verdad.
        </p>
      )}

      {data && data.modo === "listado" && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-600">
              {data.clientes.length} clientes con movimientos - página {pagina} de {totalPaginas}
            </p>
            <button
              onClick={descargarExcelListado}
              className="text-xs bg-green-700 text-white rounded px-3 py-1"
            >
              Descargar Excel (todos los clientes)
            </button>
          </div>

          {data.clientes.length === 0 && (
            <p className="text-gray-500 text-sm">Sin clientes con movimientos en el rango elegido.</p>
          )}

          <div className="flex flex-col gap-6">
            {clientesPagina.map((c) => (
              <div key={c.CUSTNMBR} className="border border-[var(--color-border)] rounded-lg overflow-hidden">
                <div className="px-4 py-2 border-b border-[var(--color-border)] bg-gray-50">
                  <h2 className="font-semibold">{c.CUSTNMBR} - {c.CUSTNAME}</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Fecha</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Documento</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Monto</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="bg-gray-100 italic">
                        <td className="px-4 py-2 border-b border-[var(--color-border)]" colSpan={3}>Saldo inicial</td>
                        <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(c.saldoInicial)}</td>
                      </tr>
                      {c.movimientos.map((m, i) => (
                        <tr key={`${m.Documento}-${i}`} className={i % 2 ? "" : "bg-gray-50/60"}>
                          <td className="px-4 py-2 border-b border-[var(--color-border)] whitespace-nowrap">{formatFecha(m.Fecha)}</td>
                          <td className="px-4 py-2 border-b border-[var(--color-border)] whitespace-nowrap">{m.Documento}</td>
                          <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(m.Monto)}</td>
                          <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(m.Saldo)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-100 font-semibold">
                        <td className="px-4 py-2 border-t-2 border-[var(--color-border)]" colSpan={3}>Saldo final</td>
                        <td className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">{formatMonto(c.saldoFinal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ))}
          </div>

          {totalPaginas > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                type="button"
                disabled={pagina <= 1}
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                className="border border-[var(--color-border)] rounded px-3 py-1 text-sm disabled:opacity-40"
              >
                ← Anterior
              </button>
              <span className="text-sm text-gray-600">Página {pagina} de {totalPaginas}</span>
              <button
                type="button"
                disabled={pagina >= totalPaginas}
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                className="border border-[var(--color-border)] rounded px-3 py-1 text-sm disabled:opacity-40"
              >
                Siguiente →
              </button>
            </div>
          )}
        </div>
      )}

      {data && data.modo === "detalle" && (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-gray-50">
            <h2 className="font-semibold">
              {data.cliente.CUSTNMBR} - {data.cliente.CUSTNAME}
            </h2>
            <button
              onClick={() => exportToExcel(data.movimientos, data.columns, `cuenta-corriente-${data.cliente.CUSTNMBR}`)}
              className="text-xs bg-green-700 text-white rounded px-3 py-1"
            >
              Descargar Excel
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Fecha</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Tipo</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Documento</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Debe</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Haber</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Saldo</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-gray-100 italic">
                  <td className="px-4 py-2 border-b border-[var(--color-border)]" colSpan={5}>Saldo inicial</td>
                  <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(data.saldoInicial)}</td>
                </tr>
                {data.movimientos.map((row, i) => (
                  <tr key={`${row.Documento}-${i}`} className={i % 2 ? "" : "bg-gray-50/60"}>
                    <td className="px-4 py-2 border-b border-[var(--color-border)] whitespace-nowrap">{formatFecha(row.Fecha)}</td>
                    <td className="px-4 py-2 border-b border-[var(--color-border)] whitespace-nowrap">{row.Tipo}</td>
                    <td className="px-4 py-2 border-b border-[var(--color-border)] whitespace-nowrap">{row.Documento}</td>
                    <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{row.Debe ? formatMonto(row.Debe) : ""}</td>
                    <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{row.Haber ? formatMonto(row.Haber) : ""}</td>
                    <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums font-medium">{formatMonto(row.Saldo)}</td>
                  </tr>
                ))}
                {data.movimientos.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-3 text-center text-gray-500">Sin movimientos en el rango elegido.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 font-semibold">
                  <td className="px-4 py-2 border-t-2 border-[var(--color-border)]" colSpan={5}>Saldo final</td>
                  <td className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">{formatMonto(data.saldoFinal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
