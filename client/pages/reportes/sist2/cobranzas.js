import { useMemo, useState } from "react";
import { exportToExcelMultiHoja } from "@/functions/exportToExcel";
import { apiFetch } from "@/functions/apiFetch";
import DocumentosClasificacionModal from "@/components/DocumentosClasificacionModal";

function formatMonto(n) {
  return (n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CobranzasSist2() {
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modalSucursal, setModalSucursal] = useState(null);

  const ejecutarBusqueda = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("fechaDesde", fechaDesde);
      params.set("fechaHasta", fechaHasta);

      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/reportes/sist2/cobranzas?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al consultar");
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const buscar = (e) => {
    e.preventDefault();
    ejecutarBusqueda();
  };

  // Arma un documento por Recibo (el detalle base trae una línea por Recibo+Factura
  // aplicada, más la línea residual "Cliente") para el modal de edición: se suma todo el
  // Monto de sus líneas en Neto (acá no hay Impuestos separados) y se toma Fecha/Cliente
  // de cualquiera de sus líneas (son iguales en todas).
  const documentosModal = useMemo(() => {
    if (!modalSucursal || !data) return null;
    const porRecibo = new Map();
    data.base.forEach((row) => {
      if (row.Sucursal !== modalSucursal) return;
      if (!porRecibo.has(row.Recibo)) {
        porRecibo.set(row.Recibo, {
          Comprobante: row.Recibo,
          DOCDATE: row.Fecha,
          Cliente: row.Cliente,
          NombreCliente: row.ClienteNombre,
          Sucursal: row.Sucursal,
          Editado: row.Editado,
          Neto: 0,
          Impuestos: 0,
        });
      }
      porRecibo.get(row.Recibo).Neto += row.Monto;
    });
    const documentos = [...porRecibo.values()]
      .map((d) => ({ ...d, Total: d.Neto + d.Impuestos }))
      .sort((a, b) => a.Comprobante.localeCompare(b.Comprobante));
    return { documentos };
  }, [modalSucursal, data]);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Cobranzas por sucursal (Sist2)</h1>
      <p className="text-sm text-gray-600 mb-4">
        Recibos del período (GL20000, CRJ/RMJ) agrupados por sucursal. Los recibos no tienen
        sucursal propia - se resuelve con la sucursal de la factura a la que están aplicados
        (columna &quot;Monto Documento&quot;) y, si no hay factura o no resuelve, con la ficha del
        cliente que pagó (columna &quot;Monto Cliente&quot;). &quot;En Blanco&quot; son los que
        tampoco tienen sucursal en la ficha del cliente. Hacé click en una sucursal para
        ver y corregir los recibos que la componen.
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
          ⚠ Hay {data.totalCount} recibos y solo se usaron los primeros 100000 para calcular. Acotá el rango antes de sumar totales.
        </p>
      )}

      {data && (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-gray-50">
            <h2 className="font-semibold">Cobranzas por sucursal - Sist2 ({data.totalCount} recibos)</h2>
            <button
              onClick={() => exportToExcelMultiHoja(
                [
                  { name: "Base", rows: data.base, columns: data.baseColumns },
                  { name: "Resultado", rows: data.rows, columns: data.columns },
                ],
                "cobranzas-sist2"
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
                  <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Sucursal</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Monto Documento</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Monto Cliente</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={row.Sucursal} className={i % 2 ? "" : "bg-gray-50/60"}>
                    <td className="px-4 py-2 border-b border-[var(--color-border)]">
                      <button
                        type="button"
                        onClick={() => setModalSucursal(row.Sucursal)}
                        className="hover:underline hover:text-[var(--color-primary)] text-left"
                        title="Ver y corregir los recibos que forman el saldo de esta sucursal"
                      >
                        {row.Sucursal}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(row.MontoDocumento)}</td>
                    <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">{formatMonto(row.MontoCliente)}</td>
                    <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums font-medium">{formatMonto(row.Total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 font-semibold">
                  <td className="px-4 py-2 border-t-2 border-[var(--color-border)]">Total general</td>
                  <td className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">{formatMonto(data.totalMontoDocumento)}</td>
                  <td className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">{formatMonto(data.totalMontoCliente)}</td>
                  <td className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">{formatMonto(data.totalGeneral)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {modalSucursal && documentosModal && (
        <DocumentosClasificacionModal
          empresa="sist2"
          tipo="sucursal_recibo"
          campo="Sucursal"
          campoLabel="Sucursal"
          valorGrupo={modalSucursal}
          documentos={documentosModal.documentos}
          sugerencias={data.rows.map((r) => r.Sucursal).filter((v) => v !== "En Blanco")}
          onClose={() => setModalSucursal(null)}
          onGuardado={ejecutarBusqueda}
        />
      )}
    </div>
  );
}
