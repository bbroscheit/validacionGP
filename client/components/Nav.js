import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

// Cada entrada es un desplegable de la barra. "Bases" son las consultas crudas contra
// GP; los demás son reportes armados sobre esas bases (se va sumando un desplegable por
// tema a medida que aparecen reportes nuevos).
const menus = [
  {
    label: "Bases",
    links: [
      { href: "/ventas", label: "Ventas" },
      { href: "/compras", label: "Compras" },
      { href: "/gastos", label: "Gastos" },
      { href: "/gastos/recibos", label: "Recibos" },
      { href: "/gastos/pagos", label: "Pagos" },
      { href: "/gastos/compras", label: "Compras (GL)" },
      { href: "/gastos/detalle-ventas", label: "Detalle de Ventas" },
      { href: "/opb", label: "OPB" },
    ],
  },
  {
    label: "Ventas",
    links: [
      { href: "/reportes/ventas-por-sucursal", label: "Ventas por sucursal" },
      { href: "/reportes/ventas-por-provincia", label: "Ventas por provincia" },
      { href: "/reportes/ventas-por-sucursal-cuenta", label: "Ventas por sucursal y cuenta" },
      { href: "/reportes/asiento-ventas", label: "Asiento de ventas" },
      { href: "/reportes/ventas-categoria-contribuyente", label: "Ventas por categoría y contribuyente" },
    ],
  },
  {
    label: "Compras",
    links: [
      { href: "/reportes/compras-por-sucursal", label: "Compras por sucursal" },
      { href: "/reportes/compras-por-sucursal-cuenta", label: "Compras por sucursal y cuenta" },
      { href: "/reportes/asiento-compras", label: "Asiento de compras" },
      { href: "/reportes/compras-categoria-contribuyente", label: "Compras por categoría y contribuyente" },
    ],
  },
  {
    label: "Ventas Sist2",
    links: [
      { href: "/reportes/sist2/ventas-por-sucursal", label: "Ventas por sucursal" },
      { href: "/reportes/sist2/ventas-por-sucursal-cuenta", label: "Ventas por sucursal y cuenta" },
      { href: "/reportes/sist2/asiento-ventas", label: "Asiento de ventas" },
      { href: "/reportes/sist2/cobranzas", label: "Cobranzas por sucursal" },
      { href: "/reportes/sist2/cuenta-corriente", label: "Cuenta corriente de cliente" },
    ],
  },
];

export default function Nav() {
  const router = useRouter();
  const [abierto, setAbierto] = useState(null);
  const navRef = useRef(null);

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

        {menus.map((menu) => {
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
      </div>
    </nav>
  );
}
