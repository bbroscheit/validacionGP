import { useEffect, useMemo, useState } from "react";
import { exportToExcel, exportToExcelMultiHoja } from "@/functions/exportToExcel";

function formatMonto(n) {
  return (n ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pivotar(rows) {
  const sucursales = [...new Set(rows.map((r) => r.Sucursal))].sort();

  const cuentasMap = new Map();
  rows.forEach((r) => {
    if (!cuentasMap.has(r.Cuenta)) {
      cuentasMap.set(r.Cuenta, { Cuenta: r.Cuenta, CuentaDescripcion: r.CuentaDescripcion, porSucursal: {}, total: 0 });
    }
    const cuenta = cuentasMap.get(r.Cuenta);
    cuenta.porSucursal[r.Sucursal] = (cuenta.porSucursal[r.Sucursal] || 0) + r.Monto;
  });

  const cuentas = [...cuentasMap.values()].sort((a, b) => a.Cuenta.localeCompare(b.Cuenta));

  cuentas.forEach((cuenta) => {
    sucursales.forEach((s) => {
      cuenta.total += cuenta.porSucursal[s] || 0;
    });
  });

  return { sucursales, cuentas };
}

export default function VentasPorSucursalCuentaSist2() {
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [soloConP, setSoloConP] = useState(false);
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
      params.set("empresa", "sist2");
      params.set("fechaDesde", fechaDesde);
      params.set("fechaHasta", fechaHasta);
      params.set("soloConP", soloConP);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/reportes/ventas-por-sucursal-cuenta?${params.toString()}`);
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

  // Al traer datos nuevos, todas las cuentas arrancan tildadas (incluidas en el total).
  useEffect(() => {
    if (pivot) setIncluidas(new Set(pivot.cuentas.map((c) => c.Cuenta)));
  }, [pivot]);

  const toggleCuenta = (cuenta) => {
    setIncluidas((prev) => {
      const next = new Set(prev);
      if (next.has(cuenta)) next.delete(cuenta);
      else next.add(cuenta);
      return next;
    });
  };

  const totales = useMemo(() => {
    if (!pivot) return null;
    const totalesPorSucursal = {};
    pivot.sucursales.forEach((s) => { totalesPorSucursal[s] = 0; });
    let totalGeneral = 0;
    pivot.cuentas.forEach((cuenta) => {
      if (!incluidas.has(cuenta.Cuenta)) return;
      pivot.sucursales.forEach((s) => { totalesPorSucursal[s] += cuenta.porSucursal[s] || 0; });
      totalGeneral += cuenta.total;
    });
    return { totalesPorSucursal, totalGeneral };
  }, [pivot, incluidas]);

  // Detalle de comprobantes que arman el saldo de una sucursal: mismo filtro de cuentas
  // tildadas que se usa en el total, para que la suma del modal cierre contra esa columna.
  const documentosModal = useMemo(() => {
    if (!modalSucursal || !data) return null;
    const porComprobante = new Map();
    data.base.forEach((row) => {
      if (row.Sucursal !== modalSucursal) return;
      if (!incluidas.has(row.Cuenta)) return;
      if (!porComprobante.has(row.Comprobante)) {
        porComprobante.set(row.Comprobante, { Comprobante: row.Comprobante, Monto: 0 });
      }
      porComprobante.get(row.Comprobante).Monto += row.Monto;
    });
    const documentos = [...porComprobante.values()].sort((a, b) => a.Comprobante.localeCompare(b.Comprobante));
    const total = documentos.reduce((acc, d) => acc + d.Monto, 0);
    return { documentos, total };
  }, [modalSucursal, data, incluidas]);

  const descargarExcel = () => {
    if (!pivot || !data || !totales) return;
    const columns = ["Cuenta", "CuentaDescripcion", "Incluida", ...pivot.sucursales, "Total"];
    const rows = pivot.cuentas.map((cuenta) => {
      const row = { Cuenta: cuenta.Cuenta, CuentaDescripcion: cuenta.CuentaDescripcion, Incluida: incluidas.has(cuenta.Cuenta) ? "Si" : "No" };
      pivot.sucursales.forEach((s) => { row[s] = cuenta.porSucursal[s] || 0; });
      row.Total = cuenta.total;
      return row;
    });
    exportToExcelMultiHoja(
      [
        { name: "Base", rows: data.base, columns: data.baseColumns },
        { name: "Resultado", rows, columns },
      ],
      "ventas-por-sucursal-cuenta-sist2"
    );
  };

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Ventas por sucursal y cuenta contable (Sist2)</h1>
      <p className="text-sm text-gray-600 mb-4">
        GL20000 (asientos de ventas, SOURCDOC = SJ) por cuenta contable y sucursal,
        excluyendo la cuenta de deudores por ventas (113110-01-000, la contrapartida de cobro).
        Destildá una cuenta para dejarla afuera del total sin sacarla de la vista.
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
          Solo comprobantes fiscales (con &quot;P&quot; - en sist2 casi ninguno la tiene desde 03/07/2026)
        </label>
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

      {pivot && totales && (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-gray-50">
            <h2 className="font-semibold">Ventas por sucursal y cuenta - Sist2 ({pivot.cuentas.length} cuentas)</h2>
            <button onClick={descargarExcel} className="text-xs bg-green-700 text-white rounded px-3 py-1">
              Descargar Excel
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2 border-b border-[var(--color-border)]"></th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Cuenta</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600 border-b border-[var(--color-border)]">Descripción</th>
                  {pivot.sucursales.map((s) => (
                    <th key={s} className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)] whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setModalSucursal(s)}
                        className="hover:underline hover:text-[var(--color-primary)]"
                        title="Ver los comprobantes que forman el saldo de esta sucursal"
                      >
                        {s}
                      </button>
                    </th>
                  ))}
                  <th className="px-4 py-2 text-right font-medium text-gray-600 border-b border-[var(--color-border)]">Total</th>
                </tr>
              </thead>
              <tbody>
                {pivot.cuentas.map((cuenta, i) => {
                  const incluida = incluidas.has(cuenta.Cuenta);
                  const filaClase = `${i % 2 ? "" : "bg-gray-50/60"} ${incluida ? "" : "text-gray-400"}`;
                  return (
                    <tr key={cuenta.Cuenta} className={filaClase}>
                      <td className="px-3 py-2 border-b border-[var(--color-border)] text-center">
                        <input
                          type="checkbox"
                          checked={incluida}
                          onChange={() => toggleCuenta(cuenta.Cuenta)}
                          aria-label={`Incluir ${cuenta.Cuenta} en el total`}
                        />
                      </td>
                      <td className="px-4 py-2 border-b border-[var(--color-border)] tabular-nums whitespace-nowrap">{cuenta.Cuenta}</td>
                      <td className="px-4 py-2 border-b border-[var(--color-border)] whitespace-nowrap">{cuenta.CuentaDescripcion}</td>
                      {pivot.sucursales.map((s) => (
                        <td key={s} className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums">
                          {cuenta.porSucursal[s] ? formatMonto(cuenta.porSucursal[s]) : ""}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right border-b border-[var(--color-border)] tabular-nums font-medium">{formatMonto(cuenta.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 font-semibold">
                  <td className="px-4 py-2 border-t-2 border-[var(--color-border)]" colSpan={3}>Total general</td>
                  {pivot.sucursales.map((s) => (
                    <td key={s} className="px-4 py-2 text-right border-t-2 border-[var(--color-border)] tabular-nums">
                      {formatMonto(totales.totalesPorSucursal[s])}
                    </td>
                  ))}
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
                    <tr><td colSpan={2} className="px-4 py-3 text-center text-gray-500">Sin comprobantes (revisá si destildaste todas las cuentas).</td></tr>
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
                onClick={() => exportToExcel(documentosModal.documentos, ["Comprobante", "Monto"], `comprobantes-sist2-${modalSucursal}`)}
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
