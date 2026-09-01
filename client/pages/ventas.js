import { useState } from "react";
import ResultTable from "@/components/ResultTable";

export default function Ventas() {
  const [empresa, setEmpresa] = useState("ecobahia");
  const [sucursal, setSucursal] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [soloConP, setSoloConP] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // En "sist2" casi ninguna venta tiene el formato de comprobante fiscal ("P") que sí
  // usa Ecobahia - con el checkbox tildado el reporte devuelve casi vacío para esa
  // empresa, así que se destilda solo al cambiar de empresa (el usuario lo puede volver
  // a tildar si igual quiere filtrar).
  const cambiarEmpresa = (nuevaEmpresa) => {
    setEmpresa(nuevaEmpresa);
    setSoloConP(nuevaEmpresa === "ecobahia");
  };

  const buscar = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("empresa", empresa);
      if (sucursal) params.set("sucursal", sucursal);
      if (fechaDesde) params.set("fechaDesde", fechaDesde);
      if (fechaHasta) params.set("fechaHasta", fechaHasta);
      params.set("soloConP", soloConP);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ventas?${params.toString()}`);
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
      <h1 className="text-xl font-semibold mb-4">Ventas — SOP30200 / SOP30300</h1>

      <form onSubmit={buscar} className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="block text-sm mb-1">Empresa</label>
          <select value={empresa} onChange={(e) => cambiarEmpresa(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1">
            <option value="ecobahia">Ecobahia</option>
            <option value="sist2">Sist2 (172.19.31.47)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm mb-1">
            Sucursal (LOCNCODE){empresa === "sist2" && " - no aplica en Sist2, usá el DOCID"}
          </label>
          <input value={sucursal} onChange={(e) => setSucursal(e.target.value)} disabled={empresa === "sist2"} className="border border-[var(--color-border)] rounded px-2 py-1 disabled:bg-gray-100" />
        </div>
        <div>
          <label className="block text-sm mb-1">Fecha desde</label>
          <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
        </div>
        <div>
          <label className="block text-sm mb-1">Fecha hasta</label>
          <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
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
          ⚠ Hay {data.totalCount} comprobantes que matchean el filtro y solo se muestran los primeros {data.header.length}.
          Acotá el rango de fechas o la sucursal para traer todo, antes de sumar totales.
        </p>
      )}

      {data && (
        <>
          <p className="text-sm text-gray-600 mb-2">Total de comprobantes encontrados: {data.totalCount}</p>
          <ResultTable title="SOP30200 (cabecera)" rows={data.header} columns={data.headerColumns} filename="ventas-cabecera" />
          <ResultTable title="SOP30300 (líneas)" rows={data.lines} columns={data.lineColumns} filename="ventas-lineas" />
        </>
      )}
    </div>
  );
}
