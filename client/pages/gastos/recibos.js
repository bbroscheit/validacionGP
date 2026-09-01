import { useState } from "react";
import ResultTable from "@/components/ResultTable";

export default function Recibos() {
  const [empresa, setEmpresa] = useState("ecobahia");
  const [cuentaDesde, setCuentaDesde] = useState("");
  const [cuentaHasta, setCuentaHasta] = useState("");
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
      params.set("empresa", empresa);
      params.set("cuentaDesde", cuentaDesde);
      params.set("cuentaHasta", cuentaHasta);
      if (fechaDesde) params.set("fechaDesde", fechaDesde);
      if (fechaHasta) params.set("fechaHasta", fechaHasta);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/gastos?${params.toString()}`);
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
      <h1 className="text-xl font-semibold mb-4">Recibos</h1>
      <p className="text-sm text-gray-600 mb-4">
        GL20000 filtrado por rango de cuentas, mostrando solo ORGNTSRC = RMCSH.
      </p>

      <form onSubmit={buscar} className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="block text-sm mb-1">Empresa</label>
          <select value={empresa} onChange={(e) => setEmpresa(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1">
            <option value="ecobahia">Ecobahia</option>
            <option value="sist2">Sist2 (172.19.31.47)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm mb-1">Cuenta desde (ACTNUMST)</label>
          <input required value={cuentaDesde} onChange={(e) => setCuentaDesde(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
        </div>
        <div>
          <label className="block text-sm mb-1">Cuenta hasta (ACTNUMST)</label>
          <input required value={cuentaHasta} onChange={(e) => setCuentaHasta(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
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
          ⚠ Hay {data.totalCount} movimientos en total y solo se trajeron los primeros 100000. Acotá el rango antes de sumar totales.
        </p>
      )}

      {data && <ResultTable title="Recibos" rows={data.recibos.rows} columns={data.recibos.columns} filename="recibos" />}
    </div>
  );
}
