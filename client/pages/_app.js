import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import "@/styles/globals.css";
import Nav from "@/components/Nav";
import { apiFetch } from "@/functions/apiFetch";
import { SesionProvider } from "@/context/SesionContext";

// Guard de sesión: chequea /auth/me (cookie httpOnly con JWT, la deja /auth/login tras
// validar contra Active Directory) antes de mostrar cualquier página, y redirige a
// /login si no hay sesión válida - así ninguna pantalla queda accesible sin loguearse.
export default function App({ Component, pageProps }) {
  const router = useRouter();
  // null = todavía no se sabe, false = no logueado, {usuario,nombre} = logueado
  const [sesion, setSesion] = useState(null);
  const enLogin = router.pathname === "/login";
  const enElegirEmprendimiento = router.pathname === "/elegir-emprendimiento";

  useEffect(() => {
    let activo = true;
    apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/me`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (activo) setSesion(json || false); })
      .catch(() => { if (activo) setSesion(false); });
    return () => { activo = false; };
  }, []);

  // Un usuario de Gerencia logueado pero sin emprendimiento elegido todavía (sesion.emprendimiento
  // null - ver services/autorizacion.js) queda atrapado en /elegir-emprendimiento hasta que
  // elija; si ya eligió y vuelve ahí por su cuenta (para cambiarlo, ver Nav.js), se lo deja.
  useEffect(() => {
    if (sesion === null) return;
    if (!sesion && !enLogin) router.replace("/login");
    if (sesion && enLogin) router.replace("/");
    if (sesion && !sesion.emprendimiento && !enElegirEmprendimiento) router.replace("/elegir-emprendimiento");
  }, [sesion, enLogin, enElegirEmprendimiento, router]);

  if (sesion === null) return null;
  if (!sesion && !enLogin) return null;
  if (sesion && !sesion.emprendimiento && !enElegirEmprendimiento) return null;

  return (
    <SesionProvider sesion={sesion || null}>
      {!enLogin && !enElegirEmprendimiento && <Nav usuario={sesion} onLogout={() => setSesion(false)} />}
      <main className={enLogin || enElegirEmprendimiento ? "" : "max-w-5xl mx-auto px-4 py-6"}>
        <Component {...pageProps} />
      </main>
    </SesionProvider>
  );
}
