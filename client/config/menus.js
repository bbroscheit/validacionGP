// Estructura de navegación compartida entre la barra (components/Nav.js) y el dashboard
// de inicio (pages/index.js) - una sola fuente de verdad para no duplicar la lista de
// reportes ni arriesgarse a que un menú quede visible en uno y no en el otro.
// Cada entrada es un desplegable de la barra. "Bases" son las consultas crudas contra
// GP; los demás son reportes armados sobre esas bases (se va sumando un desplegable por
// tema a medida que aparecen reportes nuevos).
export const menus = [
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
      { href: "/reportes/ventas-categoria-contribuyente", label: "Ventas por categoría y contribuyente", ocultoPara: ["cylius", "chile"] },
      { href: "/reportes/cuenta-corriente-cliente", label: "Cuenta corriente de cliente" },
      { href: "/libro-iva-digital", label: "Libro IVA Digital (ARCA)", ocultoPara: ["cylius", "chile", "basani"] },
    ],
  },
  {
    label: "Compras",
    links: [
      { href: "/reportes/compras-por-sucursal", label: "Compras por sucursal" },
      { href: "/reportes/compras-por-sucursal-cuenta", label: "Compras por sucursal y cuenta" },
      { href: "/reportes/asiento-compras", label: "Asiento de compras" },
      { href: "/reportes/compras-categoria-contribuyente", label: "Compras por categoría y contribuyente", ocultoPara: ["cylius", "chile"] },
      { href: "/reportes/cuenta-corriente-proveedor", label: "Cuenta corriente de proveedor" },
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
  {
    label: "Reportes",
    links: [
      { href: "/bancos-cobranzas/movimientos", label: "Movimientos" },
    ],
  },
];

// "Ventas Sist2" y "Reportes" (ex "Bancos Cobranzas") son específicos de Ecobahia (sist2
// no existe para otros emprendimientos, y Bancos Cobranzas por ahora solo busca contra la
// base de clientes de Ecobahia - ver api/src/services/clientesGp.js) - se ocultan para
// cualquier otro emprendimiento en vez de mostrar un link que va a dar 403.
// "Bases" (las consultas crudas contra GP, con su propio selector de empresa) queda solo
// para Gerencia - el resto de los usuarios ya tiene todo lo que necesita en los reportes
// armados (Ventas/Compras/etc.), que resuelven la empresa solos a partir de su sesión.
//
// `link.ocultoPara` (lista de emprendimientos) oculta un link puntual en vez de todo el
// menú: usado para reportes que no aplican a un emprendimiento concreto en vez de darle
// datos vacíos/sin sentido - ej. "Libro IVA Digital" es un régimen de ARCA (Argentina), no
// existe para Cylius (Uruguay) ni BAEBSA (Chile, régimen de la SII); "Ventas/Compras por
// categoría y contribuyente" dependen de GL00100.USERDEF2 (categoría de cuenta) y de la
// categoría de contribuyente AFIP (RI/MO/CF/EX) - en Cylius USERDEF2 viene 100% en blanco,
// y en Chile la tabla AWLI40330 (de donde sale la categoría de contribuyente) directamente
// no existe - confirmado contra PRD07 y PRD05 respectivamente. Basani (PRD01) se agrega
// también a "Libro IVA Digital" nada más: su numeración de comprobante (ej.
// "FVPA0012-00559637", con un código de planta pegado al tipo de documento, distinto del
// "FV A0040" con espacio que asume libroIvaDigitalData.js) todavía no se verificó contra
// el parser de ese archivo - queda pendiente, a diferencia del resto de los reportes de
// Basani (ya onboardeado y verificado).

// "Compras por sucursal" está habilitado para Cylius y Chile - en los dos casos
// AATransactions (la dimensión de zona) no tiene datos reales para Ventas, pero el
// mapeo de cuentas (Créditos Fiscales/contrapartida de pago) sí está confirmado para
// ambos, así que el reporte funciona igual, solo que todo cae en un único grupo ("En
// Blanco" en Cylius, Santiago/Coquimbo sí existen en Chile) - sirve igual para comparar
// el total general contra el Libro IVA Compras.
export const menusVisibles = (usuario) => {
  const esEcobahia = !usuario || usuario.emprendimiento === "ecobahia";
  return menus
    .filter((menu) => {
      if (menu.label === "Bases") return !!usuario?.esGerencia;
      if (menu.label === "Ventas Sist2" || menu.label === "Reportes") return esEcobahia;
      return true;
    })
    .map((menu) => ({
      ...menu,
      links: menu.links.filter((link) => !link.ocultoPara?.includes(usuario?.emprendimiento)),
    }));
};
