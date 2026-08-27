import { useState } from "react";
import ResultTable from "@/components/ResultTable";

export default function Opb() {
  const [cuentaDesde, setCuentaDesde] = useState("");
  const [cuentaHasta, setCuentaHasta] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [referencia, setReferencia] = useState("");
  const [sourcdoc, setSourcdoc] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const buscar = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("cuentaDesde", cuentaDesde);
      params.set("cuentaHasta", cuentaHasta);
      if (fechaDesde) params.set("fechaDesde", fechaDesde);
      if (fechaHasta) params.set("fechaHasta", fechaHasta);
      if (referencia) params.set("referencia", referencia);
      if (sourcdoc) params.set("sourcdoc", sourcdoc);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/opb?${params.toString()}`);
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
      <h1 className="text-xl font-semibold mb-4">OPB — GL20000 (órdenes de pago varias sin factura)</h1>
      <p className="text-sm text-gray-600 mb-4">
        Todavía no está confirmado cómo se identifica un OPB en los datos (ver NOTES.md del
        backend). &quot;Referencia&quot; y &quot;SOURCDOC&quot; son filtros opcionales para ir probando.
      </p>

      <form onSubmit={buscar} className="flex flex-wrap gap-3 items-end mb-6">
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
        <div>
          <label className="block text-sm mb-1">Referencia (LIKE)</label>
          <input value={referencia} onChange={(e) => setReferencia(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
        </div>
        <div>
          <label className="block text-sm mb-1">SOURCDOC</label>
          <input value={sourcdoc} onChange={(e) => setSourcdoc(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
        </div>
        <button type="submit" disabled={loading} className="bg-[var(--color-primary)] text-white rounded px-4 py-1.5">
          {loading ? "Buscando..." : "Buscar"}
        </button>
      </form>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      {data && <ResultTable title="GL20000 (movimientos OPB)" rows={data.movimientos} columns={data.columns} filename="opb" />}
    </div>
  );
}
