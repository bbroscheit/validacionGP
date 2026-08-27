import Link from "next/link";

export default function Home() {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Validación de datos GP - Ecobahia (PRD08)</h1>
      <p className="mb-4 text-sm text-gray-600">
        Cuatro endpoints de consulta para confirmar en qué tablas/columnas viven ciertos
        datos en Dynamics GP, antes de construir algo sobre esos supuestos.
      </p>
      <ul className="list-disc list-inside space-y-1">
        <li><Link className="text-[var(--color-primary)] underline" href="/ventas">Ventas</Link> — SOP30200/SOP30300 por sucursal y fechas</li>
        <li><Link className="text-[var(--color-primary)] underline" href="/compras">Compras</Link> — PM10000/PM30200, solo facturas</li>
        <li><Link className="text-[var(--color-primary)] underline" href="/gastos">Gastos (GL)</Link> — GL20000/GL00100 por rango de cuentas</li>
        <li><Link className="text-[var(--color-primary)] underline" href="/opb">OPB</Link> — GL20000 aislando órdenes de pago varias sin factura</li>
      </ul>
    </div>
  );
}
