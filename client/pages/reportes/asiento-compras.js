import { useState } from "react";
import { exportToExcelMultiHoja } from "@/functions/exportToExcel";

function formatMonto(n) {
  return (n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AsientoCompras() {
  // Filtro por sucursal sacado por ahora: la Zona es una dimensión por línea de asiento
  // (no de cabecera como en Ventas) y las cuentas de proveedores e impuestos no la tienen
  // cargada, así que filtrando por una sucursal puntual el asiento nunca cierra. Código
  // comentado más abajo por si hace falta reactivarlo.
  // const [sucursales, setSucursales] = useState([]);
  // const [sucursal, setSucursal] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // useEffect(() => {
  //   fetch(`${process.env.NEXT_PUBLIC_API_URL}/reportes/sucursales-compras`)
  //     .then((res) => res.json())
  //     .then(setSucursales)
  //     .catch(() => {});
  // }, []);

  const buscar = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("fechaDesde", fechaDesde);
      params.set("fechaHasta", fechaHasta);
      // if (sucursal) params.set("sucursal", sucursal);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/reportes/asiento-compras?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al consultar");
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const cierra = data && Math.abs(data.diferencia) < 0.01;

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Asiento contable de compras</h1>
      <p className="text-sm text-gray-600 mb-4">
        GL20000 (SOURCDOC = PMTRX/PMVVR) agrupado por cuenta con Debe y Haber - asiento
        consolidado de todas las sucursales.
      </p>

      <form onSubmit={buscar} className="flex flex-wrap gap-3 items-end mb-6">
        {/*
        <div>
          <label className="block text-sm mb-1">Sucursal</label>
          <select value={sucursal} onChange={(e) => setSucursal(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1.5">
            <option value="">Todas</option>
            {sucursales.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        */}
        <div>
          <label className="block text-sm mb-1">Fecha desde</label>
          <input required type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
        </div>
        <div>
          <label className="block text-sm mb-1">Fecha hasta</label>
          <input required type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} className="border border-[var(--color-border)] rounded px-2 py-1" />
        </div>
        <button type="submit" disabled={loading} className="bg-[var(--color-primary)] text-white rounded px-4 py-1.5">
          {loading ? "Buscando..." : "Buscar"}
        </button>
      </form>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      {data && data.truncated && (
        <p className="text-red-600 mb-4 font-semibold">
          ⚠ Hay {data.totalCount} líneas y solo se usaron las primeras 100000 para calcular. Acotá el rango antes de sumar totales.
        </p>
      )}

      {data && (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-gray-50">
            <h2 className="font-semibold">
              Asiento de compras — todas las sucursales ({data.rows.length} cuentas)
            </h2>
            <button
              onClick={() => exportToExcelMultiHoja(
                [
                  { name: "Base", rows: data.base, columns: data.baseColumns },
                  { name: "Resultado", rows: data.rows, columns: data.columns },
                ],
                "asiento-compras"
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
                  <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Cuenta</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Descripción</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Debe</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Haber</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={row.Cuenta} className={i % 2 ? "" : "bg-gray-50/60"}>
                    <td className="px-4 py-2 border-b border-[var(--color-border)] tabular-nums whitespace-nowrap">{row.Cuenta}</td>
                    <td className="px-4 py-2 border-b border-[var(--color-border)] whitespace-nowrap">{row.CuentaDescripcion}</td>
                    <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{row.Debe ? formatMonto(row.Debe) : ""}</td>
                    <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{row.Haber ? formatMonto(row.Haber) : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 font-semibold">
                  <td className="px-4 py-2 border-t-2 border-[var(--color-border)]" colSpan={2}>Total</td>
                  <td className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">{formatMonto(data.totalDebe)}</td>
                  <td className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">{formatMonto(data.totalHaber)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className={`px-4 py-3 text-sm border-t border-[var(--color-border)] ${cierra ? "text-green-700" : "text-red-600 font-semibold"}`}>
            {cierra
              ? "El asiento cierra: Debe = Haber."
              : `El asiento NO cierra. Diferencia: ${formatMonto(data.diferencia)}`}
          </p>
        </div>
      )}
    </div>
  );
}
