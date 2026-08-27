import { useEffect, useMemo, useState } from "react";
import { exportToExcel, exportToExcelMultiHoja } from "@/functions/exportToExcel";

function formatMonto(n) {
  return (n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatEntero(n) {
  return (n ?? 0).toLocaleString("es-AR");
}

export default function ComprasPorSucursal() {
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [incluidas, setIncluidas] = useState(new Set());
  const [modalSucursal, setModalSucursal] = useState(null);

  const buscar = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("fechaDesde", fechaDesde);
      params.set("fechaHasta", fechaHasta);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/reportes/compras-por-sucursal?${params.toString()}`);
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
    if (data) setIncluidas(new Set(data.rows.map((r) => r.Sucursal)));
  }, [data]);

  const toggleSucursal = (sucursal) => {
    setIncluidas((prev) => {
      const next = new Set(prev);
      if (next.has(sucursal)) next.delete(sucursal);
      else next.add(sucursal);
      return next;
    });
  };

  const totales = useMemo(() => {
    if (!data) return null;
    let totalComprobantes = 0;
    let totalNeto = 0;
    let totalImpuestos = 0;
    data.rows.forEach((row) => {
      if (!incluidas.has(row.Sucursal)) return;
      totalComprobantes += row.CantidadComprobantes;
      totalNeto += row.Neto;
      totalImpuestos += row.Impuestos;
    });
    return { totalComprobantes, totalNeto, totalImpuestos, totalGeneral: totalNeto + totalImpuestos };
  }, [data, incluidas]);

  const documentosModal = useMemo(() => {
    if (!modalSucursal || !data) return null;
    const porComprobante = new Map();
    data.base.forEach((row) => {
      if (row.Sucursal !== modalSucursal) return;
      if (!porComprobante.has(row.Comprobante)) {
        porComprobante.set(row.Comprobante, { Comprobante: row.Comprobante, Monto: 0 });
      }
      porComprobante.get(row.Comprobante).Monto += row.Monto;
    });
    const documentos = [...porComprobante.values()].sort((a, b) => a.Comprobante.localeCompare(b.Comprobante));
    const total = documentos.reduce((acc, d) => acc + d.Monto, 0);
    return { documentos, total };
  }, [modalSucursal, data]);

  const descargarExcel = () => {
    if (!data || !totales) return;
    const columns = ["Sucursal", "CantidadComprobantes", "Incluida", "Neto", "Impuestos", "Total"];
    const rows = data.rows.map((row) => ({
      Sucursal: row.Sucursal,
      CantidadComprobantes: row.CantidadComprobantes,
      Incluida: incluidas.has(row.Sucursal) ? "Si" : "No",
      Neto: row.Neto,
      Impuestos: row.Impuestos,
      Total: row.Total,
    }));
    exportToExcelMultiHoja(
      [
        { name: "Base", rows: data.base, columns: data.baseColumns },
        { name: "Resultado", rows, columns },
      ],
      "compras-por-sucursal"
    );
  };

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Compras por sucursal</h1>
      <p className="text-sm text-gray-600 mb-4">
        GL20000 (asientos de compras, SOURCDOC = PMTRX/PMVVR) agrupado por la zona de
        Contabilidad Analítica del asiento. Se agrupa por la descripción de zona
        normalizada (mayúsculas), no por el código, porque el código cambió durante el mes
        (ej. &quot;BAHIA BLANCA&quot; pasó a ser &quot;001&quot;) y la descripción es lo único estable.
        Destildá una sucursal para dejarla afuera del total sin sacarla de la vista.
        Impuestos = cuentas de IVA Crédito Fiscal / percepciones (ACCATNUM=9); Neto = todo
        lo demás (gastos, activo, préstamos). Se excluyen únicamente las cuentas que
        funcionan como contrapartida de pago: proveedores (211101) y Visa Francés a Pagar
        (223202).
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

      {data && totales && (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-gray-50">
            <h2 className="font-semibold">Compras por sucursal ({data.rows.length} zonas)</h2>
            <button onClick={descargarExcel} className="text-xs bg-green-700 text-white rounded px-3 py-1">
              Descargar Excel
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2 border-b border-[var(--color-border)]"></th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Sucursal</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Comprobantes</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Neto</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Impuestos</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => {
                  const incluida = incluidas.has(row.Sucursal);
                  const filaClase = `${i % 2 ? "" : "bg-gray-50/60"} ${incluida ? "" : "text-gray-400"}`;
                  return (
                    <tr key={row.Sucursal} className={filaClase}>
                      <td className="px-3 py-2 border-b border-[var(--color-border)] text-center">
                        <input
                          type="checkbox"
                          checked={incluida}
                          onChange={() => toggleSucursal(row.Sucursal)}
                          aria-label={`Incluir ${row.Sucursal} en el total`}
                        />
                      </td>
                      <td className="px-4 py-2 border-b border-[var(--color-border)]">
                        <button
                          type="button"
                          onClick={() => setModalSucursal(row.Sucursal)}
                          className="hover:underline hover:text-[var(--color-primary)] text-left"
                          title="Ver los comprobantes que forman el saldo de esta sucursal"
                        >
                          {row.Sucursal}
                        </button>
                      </td>
                      <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatEntero(row.CantidadComprobantes)}</td>
                      <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(row.Neto)}</td>
                      <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(row.Impuestos)}</td>
                      <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(row.Total)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 font-semibold">
                  <td className="px-4 py-2 border-t-2 border-[var(--color-border)]" colSpan={2}>Total general</td>
                  <td className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">{formatEntero(totales.totalComprobantes)}</td>
                  <td className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">{formatMonto(totales.totalNeto)}</td>
                  <td className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">{formatMonto(totales.totalImpuestos)}</td>
                  <td className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">{formatMonto(totales.totalGeneral)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {modalSucursal && documentosModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-20 p-4"
          onClick={() => setModalSucursal(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">Comprobantes — {modalSucursal}</h3>
              <button
                type="button"
                onClick={() => setModalSucursal(null)}
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
                    <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {documentosModal.documentos.map((doc, i) => (
                    <tr key={doc.Comprobante} className={i % 2 ? "" : "bg-gray-50/60"}>
                      <td className="px-4 py-2 border-b border-[var(--color-border)] whitespace-nowrap">{doc.Comprobante}</td>
                      <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(doc.Monto)}</td>
                    </tr>
                  ))}
                  {documentosModal.documentos.length === 0 && (
                    <tr><td colSpan={2} className="px-4 py-3 text-center text-gray-500">Sin comprobantes.</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 font-semibold">
                    <td className="px-4 py-2 border-t-2 border-[var(--color-border)]">Total</td>
                    <td className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">{formatMonto(documentosModal.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-[var(--color-border)] flex justify-end">
              <button
                onClick={() => exportToExcel(documentosModal.documentos, ["Comprobante", "Monto"], `comprobantes-${modalSucursal}`)}
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
