import { createContext, useContext } from "react";

// Expone la sesión (usuario/organizacion/emprendimiento, la misma respuesta de
// /auth/me que _app.js ya guarda) a cualquier página - antes solo se la pasaba a Nav.
// Hace falta, por ejemplo, para que el modal de edición de sucursales en blanco sepa a
// qué compañía (Ecobahia/Ecosistemas Patagónicos) etiquetar el override.
const SesionContext = createContext(null);

export function SesionProvider({ sesion, children }) {
  return <SesionContext.Provider value={sesion}>{children}</SesionContext.Provider>;
}

// Devuelve la sesión actual, o null si todavía no se conoce/no hay sesión (no debería
// pasar en una página protegida, pero por las dudas no se asume).
export function useSesion() {
  return useContext(SesionContext);
}
