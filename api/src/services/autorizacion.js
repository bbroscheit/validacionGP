// Autorización por sucursal, a partir del atributo "company" de Active Directory
// (adAuth.js - con "o"/Organization como respaldo si company no está cargado; se probó
// primero solo "o" pero un usuario real -MazzaRN- lo tenía vacío y la sucursal estaba
// en company, por eso el fallback). Regla del usuario:
//   - organizacion = "Ecobahia" (o vacío/sin cargar - ver nota abajo) => acceso completo,
//     ve todos los reportes sin restricción, igual que antes de este feature.
//   - organizacion = nombre de una sucursal (ej. "La Pampa") => acceso restringido: solo
//     ve información de ESA sucursal (Ventas) / zona (Compras/Gastos). Las operaciones
//     sin sucursal/zona catalogada ("En Blanco") NO se muestran a un usuario restringido
//     - no se puede confirmar que sean suyas.
//
// Vacío se trata como acceso completo a propósito (fail-open): si a alguien le falta
// cargar el dato en AD, que quede con acceso completo (como estaba la app hasta ahora)
// en vez de quedar bloqueado de todo por un dato faltante. Si se prefiere fail-closed,
// cambiar acá.
const esAccesoCompleto = (organizacion) => {
  const valor = (organizacion || '').trim().toLowerCase();
  return valor === '' || valor === 'ecobahia';
};

// Sucursal a la que un usuario restringido queda limitado, o null si tiene acceso
// completo. Para usar en los controllers: filtrar por esto cuando no sea null.
const sucursalDeSesion = (usuarioSesion) => {
  const organizacion = usuarioSesion?.organizacion;
  return esAccesoCompleto(organizacion) ? null : organizacion.trim();
};

// Compara el nombre de sucursal/zona de un dato de GP (ej. "BAHIA BLANCA", "LA PAMPA",
// AATransactions ZONA_DESC) contra el valor cargado en AD (ej. "Bahía Blanca") - se
// normaliza sacando tildes/mayúsculas en los dos lados, y además se prueba como
// substring en ambos sentidos para cubrir variantes con palabras de más (ej. sist2 usa
// "Casa Central" pero Ecobahia usa solo "CENTRAL" para el mismo lugar).
const normalizarNombreSucursal = (s) => (s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '') // saca tildes (Á -> A + combining acute)
  .trim()
  .toUpperCase();

const coincideSucursal = (valorGP, sucursalUsuario) => {
  if (!valorGP || !sucursalUsuario) return false;
  const a = normalizarNombreSucursal(valorGP);
  const b = normalizarNombreSucursal(sucursalUsuario);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
};

// Gate de acceso a la app (2026-09-15, a pedido del usuario): mientras se van cargando
// sucursales en AD de a una, solo puede ENTRAR a la app quien tenga "company" en esta
// lista - a diferencia de esAccesoCompleto/sucursalDeSesion de arriba (que deciden qué ve
// alguien que YA entró), acá vacío/no-cargado NO pasa (fail-closed a propósito: un
// usuario sin sucursal cargada todavía no debería poder entrar). broscheitcb (el usuario
// del desarrollador) siempre puede entrar, tenga o no company cargado.
const ORGANIZACIONES_CON_ACCESO = ['ECOBAHIA', 'TANDIL', 'LA PAMPA', 'BAHIA BLANCA', 'MAR DEL PLATA', 'PUERTO MADRYN'];
const USUARIOS_CON_ACCESO_SIEMPRE = ['broscheitcb'];

const tieneAccesoALaApp = ({ usuario, organizacion }) => {
  if (USUARIOS_CON_ACCESO_SIEMPRE.includes((usuario || '').trim().toLowerCase())) return true;
  const valor = normalizarNombreSucursal(organizacion);
  return ORGANIZACIONES_CON_ACCESO.includes(valor);
};

module.exports = { esAccesoCompleto, sucursalDeSesion, coincideSucursal, normalizarNombreSucursal, tieneAccesoALaApp };
