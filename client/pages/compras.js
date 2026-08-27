import { useState } from "react";
import ResultTable from "@/components/ResultTable";

export default function Compras() {
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const buscar = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (fechaDesde) params.set("fechaDesde", fechaDesde);
      if (fechaHasta) params.set("fechaHasta", fechaHasta);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/compras?${params.toString()}`);
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
      <h1 className="text-xl font-semibold mb-4">Compras — PM10000 / PM20000 / PM30200 (facturas y NC)</h1>

      <form onSubmit={buscar} className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="block text-sm mb-1">Fecha contable desde (PSTGDATE)</label>
          <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
        </div>
        <div>
          <label className="block text-sm mb-1">Fecha contable hasta (PSTGDATE)</label>
          <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
        </div>
        <button type="submit" disabled={loading} className="bg-[var(--color-primary)] text-white rounded px-4 py-1.5">
          {loading ? "Buscando..." : "Buscar"}
        </button>
      </form>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      {data && (data.workTruncated || data.openTruncated || data.historyTruncated) && (
        <p className="text-red-600 mb-4 font-semibold">
          ⚠ Hay más filas de las mostradas ({data.workTotalCount} en work, {data.openTotalCount} en abiertas, {data.historyTotalCount} en historial).
          Acotá el rango de fechas antes de sumar totales.
        </p>
      )}

      {data && (
        <>
          <p className="text-sm text-gray-600 mb-2">
            Total: {data.workTotalCount} en work, {data.openTotalCount} abiertas (posteadas, sin pagar del todo), {data.historyTotalCount} en historial (pagadas)
          </p>
          <ResultTable title="PM10000 (work, sin postear)" rows={data.work} columns={data.workColumns} filename="compras-work" />
          <ResultTable title="PM20000 (abiertas, posteadas sin pagar)" rows={data.open} columns={data.openColumns} filename="compras-abiertas" />
          <ResultTable title="PM30200 (historial, pagadas)" rows={data.history} columns={data.historyColumns} filename="compras-historial" />
        </>
      )}
    </div>
  );
}
