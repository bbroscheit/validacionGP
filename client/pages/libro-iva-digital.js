import { useState } from "react";
import { downloadTxtFromBase64 } from "@/functions/downloadTxt";

function formatMonto(n) {
  return (n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function LibroIvaDigital() {
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [resumen, setResumen] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState("");

  const buscar = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ fechaDesde, fechaHasta });
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/reportes/libro-iva-digital/resumen?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al consultar");
      setResumen(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const exportar = async () => {
    if (!fechaDesde || !fechaHasta) {
      setError("Elegí fecha desde y hasta antes de exportar.");
      return;
    }
    setExportando(true);
    setError("");
    try {
      const params = new URLSearchParams({ fechaDesde, fechaHasta });
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/reportes/libro-iva-digital/export?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al generar los archivos");
      json.archivos.forEach((a) => downloadTxtFromBase64(a.contenidoBase64, a.nombre));
    } catch (err) {
      setError(err.message);
    } finally {
      setExportando(false);
    }
  };

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Libro IVA Digital (ARCA)</h1>
      <p className="text-sm text-gray-600 mb-4">
        Neto, impuestos y total de ventas y compras del período, y exportación de los 4
        archivos .txt (VENTAS_CBTE, VENTAS_ALICUOTAS, COMPRAS_CBTE, COMPRAS_ALICUOTAS -
        R.G. 4597) listos para importar en el Libro IVA Digital de ARCA. Antes de la
        primera presentación real, probá un archivo contra el importador de ARCA: los
        anchos de algunos campos alfanuméricos se adoptaron por convención porque el
        instructivo oficial no los detalla byte a byte.
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
        <button type="submit" disabled={loading} className="bg-[var(--color-primary)] text-white rounded px-4 py-1.5">
          {loading ? "Buscando..." : "Buscar"}
        </button>
        <button
          type="button"
          onClick={exportar}
          disabled={exportando}
          className="bg-green-700 text-white rounded px-4 py-1.5"
          title="Genera y descarga los 4 .txt para el período elegido"
        >
          {exportando ? "Generando..." : "Exportar TXT para ARCA"}
        </button>
      </form>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      {resumen && (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]"></th>
                <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Neto</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Impuestos</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Total</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Comprobantes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-4 py-2 border-b border-[var(--color-border)] font-medium">Ventas</td>
                <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(resumen.ventas.neto)}</td>
                <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(resumen.ventas.impuestos)}</td>
                <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums font-medium">{formatMonto(resumen.ventas.total)}</td>
                <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{resumen.ventas.cantidadComprobantes}</td>
              </tr>
              <tr>
                <td className="px-4 py-2 font-medium">Compras</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMonto(resumen.compras.neto)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatMonto(resumen.compras.impuestos)}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium">{formatMonto(resumen.compras.total)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{resumen.compras.cantidadComprobantes}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
