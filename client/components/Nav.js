import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { apiFetch } from "@/functions/apiFetch";
import { menusVisibles } from "@/config/menus";

export default function Nav({ usuario, onLogout }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(null);
  const navRef = useRef(null);

  const menusMostrados = menusVisibles(usuario);

  const cerrarSesion = async () => {
    try {
      await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/logout`, { method: "POST" });
    } finally {
      onLogout?.();
    }
  };

  useEffect(() => {
    const cerrarSiEsAfuera = (e) => {
      if (navRef.current && !navRef.current.contains(e.target)) setAbierto(null);
    };
    document.addEventListener("mousedown", cerrarSiEsAfuera);
    return () => document.removeEventListener("mousedown", cerrarSiEsAfuera);
  }, []);

  useEffect(() => {
    setAbierto(null);
  }, [router.pathname]);

  return (
    <nav className="bg-[var(--color-primary)] text-white">
      <div ref={navRef} className="max-w-5xl mx-auto flex items-center gap-4 px-4 py-3">
        <Link href="/" className="font-semibold">
          Validación GP
        </Link>

        {menusMostrados.map((menu) => {
          const enMenu = menu.links.some((link) => link.href === router.pathname);
          return (
            <div key={menu.label} className="relative">
              <button
                onClick={() => setAbierto((v) => (v === menu.label ? null : menu.label))}
                className={`flex items-center gap-1 ${enMenu ? "underline" : "opacity-80 hover:opacity-100"}`}
              >
                {menu.label}
                <span className="text-xs">▾</span>
              </button>
              {abierto === menu.label && (
                <div className="absolute left-0 top-full mt-1 min-w-[220px] rounded border border-black/10 bg-white text-[var(--color-foreground)] shadow-lg z-10">
                  {menu.links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`block px-3 py-2 text-sm hover:bg-gray-100 ${router.pathname === link.href ? "font-semibold" : ""}`}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div className="ml-auto flex items-center gap-3 text-sm">
          {usuario?.esGerencia && (
            <>
              <span className="opacity-80">
                {usuario.emprendimientosDisponibles?.find((e) => e.value === usuario.emprendimiento)?.label}
              </span>
              <Link href="/elegir-emprendimiento" className="opacity-80 hover:opacity-100 underline">
                Cambiar compañía
              </Link>
            </>
          )}
          {usuario && <span className="opacity-80">{usuario.nombre}</span>}
          <button onClick={cerrarSesion} className="opacity-80 hover:opacity-100 underline">
            Cerrar sesión
          </button>
        </div>
      </div>
    </nav>
  );
}
