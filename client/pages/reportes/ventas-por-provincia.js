import { useState } from "react";
import { exportToExcelMultiHoja } from "@/functions/exportToExcel";

function formatMonto(n) {
  return (n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatEntero(n) {
  return (n ?? 0).toLocaleString("es-AR");
}

export default function VentasPorProvincia() {
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [soloConP, setSoloConP] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const buscar = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("fechaDesde", fechaDesde);
      params.set("fechaHasta", fechaHasta);
      params.set("soloConP", soloConP);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/reportes/ventas-por-provincia?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al consultar");
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Ventas por provincia</h1>
      <p className="text-sm text-gray-600 mb-4">
        SOP30200 agrupado por provincia (STATE). El monto facturado es el neto (SUBTOTAL - BCKTXAMT,
        con signo invertido en notas de crédito) - la suma total debe cerrar contra el subtotal del
        libro IVA Ventas del mismo período.
      </p>

      <form onSubmit={buscar} className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="block text-sm mb-1">Fecha desde</label>
          <input required type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
        </div>
        <div>
          <label className="block text-sm mb-1">Fecha hasta</label>
          <input required type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
        </div>
        <label className="flex items-center gap-2 text-sm pb-1.5">
          <input type="checkbox" checked={soloConP} onChange={(e) => setSoloConP(e.target.checked)} />
          Solo comprobantes fiscales (SOPNUMBE con &quot;P&quot;: FVPA, FVPB, NCPA...)
        </label>
        <button type="submit" disabled={loading} className="bg-[var(--color-primary)] text-white rounded px-4 py-1.5">
          {loading ? "Buscando..." : "Buscar"}
        </button>
      </form>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      {data && data.truncated && (
        <p className="text-red-600 mb-4 font-semibold">
          ⚠ Hay {data.totalCount} comprobantes y solo se usaron los primeros 100000 para calcular. Acotá el rango antes de sumar totales.
        </p>
      )}

      {data && (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-gray-50">
            <h2 className="font-semibold">Ventas por provincia</h2>
            <button
              onClick={() => exportToExcelMultiHoja(
                [
                  { name: "Base", rows: data.base, columns: data.baseColumns },
                  { name: "Resultado", rows: data.rows, columns: data.columns },
                ],
                "ventas-por-provincia"
              )}
              className="text-xs bg-green-700 text-white rounded px-3 py-1"
            >
              Descargar Excel
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Provincia</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Comprobantes</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Neto</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Impuestos</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={row.Provincia} className={i % 2 ? "" : "bg-gray-50/60"}>
                    <td className="px-4 py-2 border-b border-[var(--color-border)]">{row.Provincia}</td>
                    <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatEntero(row.CantidadComprobantes)}</td>
                    <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(row.Neto)}</td>
                    <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(row.Impuestos)}</td>
                    <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(row.Total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 font-semibold">
                  <td className="px-4 py-2 border-t-2 border-[var(--color-border)]">Total general</td>
                  <td className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">{formatEntero(data.totalComprobantes)}</td>
                  <td className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">{formatMonto(data.totalNeto)}</td>
                  <td className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">{formatMonto(data.totalImpuestos)}</td>
                  <td className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">{formatMonto(data.totalGeneral)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
