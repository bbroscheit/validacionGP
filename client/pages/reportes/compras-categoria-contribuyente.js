import { useMemo, useState } from "react";
import { exportToExcel, exportToExcelMultiHoja } from "@/functions/exportToExcel";

function formatMonto(n) {
  return (n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pivotar(rows) {
  const tipos = [...new Set(rows.map((r) => r.TipoContribuyente))].sort();

  const categoriasMap = new Map();
  rows.forEach((r) => {
    if (!categoriasMap.has(r.Categoria)) {
      categoriasMap.set(r.Categoria, { Categoria: r.Categoria, porTipo: {}, total: 0 });
    }
    const categoria = categoriasMap.get(r.Categoria);
    categoria.porTipo[r.TipoContribuyente] = (categoria.porTipo[r.TipoContribuyente] || 0) + r.Monto;
  });

  const categorias = [...categoriasMap.values()].sort((a, b) => a.Categoria.localeCompare(b.Categoria));

  const totalesPorTipo = {};
  tipos.forEach((t) => { totalesPorTipo[t] = 0; });
  let totalGeneral = 0;

  categorias.forEach((categoria) => {
    tipos.forEach((t) => {
      const monto = categoria.porTipo[t] || 0;
      categoria.total += monto;
      totalesPorTipo[t] += monto;
    });
    totalGeneral += categoria.total;
  });

  return { tipos, categorias, totalesPorTipo, totalGeneral };
}

export default function ComprasCategoriaContribuyente() {
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modalCategoria, setModalCategoria] = useState(null);

  const buscar = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("fechaDesde", fechaDesde);
      params.set("fechaHasta", fechaHasta);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/reportes/compras-categoria-contribuyente?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al consultar");
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const pivot = useMemo(() => (data ? pivotar(data.rows) : null), [data]);

  // Detalle de líneas (con su cuenta contable) que arman una categoría - ordenado por
  // cuenta para ubicar rápido qué cuentas caen en "En Blanco".
  const modalRows = useMemo(() => {
    if (!modalCategoria || !data) return null;
    const filas = data.base
      .filter((row) => row.Categoria === modalCategoria)
      .sort((a, b) => a.Cuenta.localeCompare(b.Cuenta) || a.Comprobante.localeCompare(b.Comprobante));
    const total = filas.reduce((acc, row) => acc + row.Monto, 0);
    return { filas, total };
  }, [modalCategoria, data]);

  const descargarExcel = () => {
    if (!pivot || !data) return;
    const columns = ["Categoria", ...pivot.tipos, "Total"];
    const rows = pivot.categorias.map((categoria) => {
      const row = { Categoria: categoria.Categoria };
      pivot.tipos.forEach((t) => { row[t] = categoria.porTipo[t] || 0; });
      row.Total = categoria.total;
      return row;
    });
    exportToExcelMultiHoja(
      [
        { name: "Base", rows: data.base, columns: data.baseColumns },
        { name: "Resultado", rows, columns },
      ],
      "compras-categoria-contribuyente"
    );
  };

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Compras por categoría y tipo de contribuyente</h1>
      <p className="text-sm text-gray-600 mb-4">
        GL20000 (asientos de compras, SOURCDOC = PMTRX/PMVVR) agrupado por categoría de
        cuenta (GL00100.USERDEF2) y tipo de contribuyente del proveedor (RI, CF, EX, Iva
        No Alcanzado). Quedan afuera las cuentas que funcionan como contrapartida de pago
        (proveedores 211101 y Visa Francés a Pagar 223202) y las cuentas de impuestos
        (IVA Crédito Fiscal, percepciones).
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
      </form>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      {data && data.truncated && (
        <p className="text-red-600 mb-4 font-semibold">
          ⚠ Hay {data.totalCount} líneas y solo se usaron las primeras 100000 para calcular. Acotá el rango antes de sumar totales.
        </p>
      )}

      {pivot && (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-gray-50">
            <h2 className="font-semibold">Compras por categoría y contribuyente ({pivot.categorias.length} categorías)</h2>
            <button onClick={descargarExcel} className="text-xs bg-green-700 text-white rounded px-3 py-1">
              Descargar Excel
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Categoría</th>
                  {pivot.tipos.map((t) => (
                    <th key={t} className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)] whitespace-nowrap">{t}</th>
                  ))}
                  <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Total</th>
                </tr>
              </thead>
              <tbody>
                {pivot.categorias.map((categoria, i) => (
                  <tr key={categoria.Categoria} className={i % 2 ? "" : "bg-gray-50/60"}>
                    <td className="px-4 py-2 border-b border-[var(--color-border)] whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setModalCategoria(categoria.Categoria)}
                        className="hover:underline hover:text-[var(--color-primary)] text-left"
                        title="Ver los documentos y cuentas que forman esta categoría"
                      >
                        {categoria.Categoria}
                      </button>
                    </td>
                    {pivot.tipos.map((t) => (
                      <td key={t} className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">
                        {categoria.porTipo[t] ? formatMonto(categoria.porTipo[t]) : ""}
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums font-medium">{formatMonto(categoria.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 font-semibold">
                  <td className="px-4 py-2 border-t-2 border-[var(--color-border)]">Total general</td>
                  {pivot.tipos.map((t) => (
                    <td key={t} className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">
                      {formatMonto(pivot.totalesPorTipo[t])}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">{formatMonto(pivot.totalGeneral)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {modalCategoria && modalRows && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-20 p-4"
          onClick={() => setModalCategoria(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">Documentos — {modalCategoria}</h3>
              <button
                type="button"
                onClick={() => setModalCategoria(null)}
                className="text-gray-500 hover:text-gray-800 text-lg leading-none px-1"
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Comprobante</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Cuenta</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Descripción</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Contribuyente</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {modalRows.filas.map((fila, i) => (
                    <tr key={`${fila.Comprobante}-${fila.Cuenta}-${i}`} className={i % 2 ? "" : "bg-gray-50/60"}>
                      <td className="px-4 py-2 border-b border-[var(--color-border)] whitespace-nowrap">{fila.Comprobante}</td>
                      <td className="px-4 py-2 border-b border-[var(--color-border)] tabular-nums whitespace-nowrap">{fila.Cuenta}</td>
                      <td className="px-4 py-2 border-b border-[var(--color-border)] whitespace-nowrap">{fila.CuentaDescripcion}</td>
                      <td className="px-4 py-2 border-b border-[var(--color-border)] whitespace-nowrap">{fila.TipoContribuyente}</td>
                      <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(fila.Monto)}</td>
                    </tr>
                  ))}
                  {modalRows.filas.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-3 text-center text-gray-500">Sin líneas para esta categoría.</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 font-semibold">
                    <td className="px-4 py-2 border-t-2 border-[var(--color-border)]" colSpan={4}>Total</td>
                    <td className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">{formatMonto(modalRows.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-[var(--color-border)] flex justify-end">
              <button
                onClick={() => exportToExcel(
                  modalRows.filas,
                  ["Comprobante", "Cuenta", "CuentaDescripcion", "TipoContribuyente", "Monto"],
                  `compras-categoria-${modalCategoria}`
                )}
                className="text-xs bg-green-700 text-white rounded px-3 py-1"
              >
                Descargar Excel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
