import { useState } from "react";
import { apiFetch } from "@/functions/apiFetch";

export default function Login() {
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Error al iniciar sesión");
      // Recarga completa (no router.replace): _app.js solo chequea /auth/me una vez al
      // montar, no en cada navegación interna - sin el reload, el guard de sesión seguía
      // viendo "sin sesión" (estado stale) y rebotaba de vuelta a /login.
      window.location.href = "/";
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={enviar} className="bg-white border border-[var(--color-border)] rounded-lg shadow-sm p-8 w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1">Validación GP</h1>
        <p className="text-sm text-gray-600 mb-6">Ingresá con tu usuario de dominio (basani.local)</p>

        <label className="block text-sm mb-1">Usuario</label>
        <input
          required
          autoFocus
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          placeholder="BASANI\usuario o usuario@basani.local"
          className="border border-[var(--color-border)] rounded px-2 py-1.5 w-full mb-4"
        />

        <label className="block text-sm mb-1">Contraseña</label>
        <input
          required
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border border-[var(--color-border)] rounded px-2 py-1.5 w-full mb-4"
        />

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="bg-[var(--color-primary)] text-white rounded px-4 py-2 w-full disabled:opacity-60"
        >
          {loading ? "Ingresando..." : "Ingresar"}
        </button>
      </form>
    </div>
  );
}
