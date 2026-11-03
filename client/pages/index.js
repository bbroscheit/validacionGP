import Link from "next/link";
import { useSesion } from "@/context/SesionContext";
import { menusVisibles } from "@/config/menus";

// Dashboard de inicio: una tarjeta por cada menú que el usuario ve en la barra (misma
// lista y misma lógica de visibilidad que Nav.js, vía config/menus.js) - así nunca queda
// desincronizado con lo que el Nav realmente ofrece, y un usuario sin Gerencia/Ecobahia
// no ve acá links a reportes a los que el servidor igual le va a dar 403.
export default function Home() {
  const sesion = useSesion();
  const nombreEmpresa = sesion?.emprendimientosDisponibles?.find((e) => e.value === sesion.emprendimiento)?.label;
  const visibles = menusVisibles(sesion);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">
        Validación de datos GP{nombreEmpresa ? ` - ${nombreEmpresa}` : ""}
      </h1>
      <p className="mb-6 text-sm text-gray-600">
        {sesion?.nombre ? `Hola, ${sesion.nombre}. ` : ""}
        Elegí un reporte para empezar.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibles.map((menu) => (
          <div key={menu.label} className="border border-[var(--color-border)] rounded-lg overflow-hidden">
            <div className="px-4 py-2 border-b border-[var(--color-border)] bg-gray-50">
              <h2 className="font-semibold text-sm">{menu.label}</h2>
            </div>
            <ul className="divide-y divide-[var(--color-border)]">
              {menu.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="block px-4 py-2 text-sm text-[var(--color-primary)] hover:bg-gray-50"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
