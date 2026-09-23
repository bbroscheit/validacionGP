import { useState } from "react";
import { apiFetch } from "@/functions/apiFetch";
import { useSesion } from "@/context/SesionContext";

// Solo para usuarios de Gerencia (services/autorizacion.js -> esGerencia): no están
// atados a un único emprendimiento, así que eligen acá a cuál quieren entrar. _app.js
// redirige acá automáticamente mientras sesion.emprendimiento sea null (todavía no
// eligió), y deja quedarse en esta página si ya eligió y vuelve por su cuenta (para
// cambiar de compañía - ver el link "Cambiar compañía" en Nav.js).
export default function ElegirEmprendimiento() {
  const sesion = useSesion();
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(null);

  const elegir = async (value) => {
    setCargando(value);
    setError("");
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/elegir-emprendimiento`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emprendimiento: value }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al elegir emprendimiento");
      // Recarga completa (no router.replace): _app.js solo chequea /auth/me una vez al
      // montar, no en cada navegación interna - mismo motivo que login.js.
      window.location.href = "/";
    } catch (err) {
      setError(err.message);
      setCargando(null);
    }
  };

  const opciones = sesion?.emprendimientosDisponibles || [];

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white border border-[var(--color-border)] rounded-lg shadow-sm p-8 w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1">Elegí una compañía</h1>
        <p className="text-sm text-gray-600 mb-6">
          Tu usuario es de Gerencia - elegí a qué emprendimiento querés entrar. Después
          podés cambiarlo desde el menú de arriba.
        </p>

        <div className="flex flex-col gap-2">
          {opciones.map((op) => (
            <button
              key={op.value}
              type="button"
              disabled={cargando !== null}
              onClick={() => elegir(op.value)}
              className="border border-[var(--color-border)] rounded px-4 py-2 text-left hover:bg-gray-50 disabled:opacity-60"
            >
              {cargando === op.value ? "Entrando..." : op.label}
            </button>
          ))}
        </div>

        {error && <p className="text-red-600 text-sm mt-4">{error}</p>}
      </div>
    </div>
  );
}
