// Autorización por sucursal/emprendimiento, a partir del atributo "company" de Active
// Directory (adAuth.js - con "o"/Organization como respaldo si company no está cargado;
// se probó primero solo "o" pero un usuario real -MazzaRN- lo tenía vacío y la sucursal
// estaba en company, por eso el fallback). Regla del usuario:
//   - organizacion = "Ecobahia" (o vacío/sin cargar - ver nota abajo) => acceso completo
//     al emprendimiento Ecobahia, ve todos sus reportes sin restricción, igual que antes
//     de este feature.
//   - organizacion = nombre de una sucursal de Ecobahia (ej. "La Pampa") => acceso
//     restringido dentro de Ecobahia: solo ve información de ESA sucursal (Ventas) / zona
//     (Compras/Gastos). Las operaciones sin sucursal/zona catalogada ("En Blanco") NO se
//     muestran a un usuario restringido - no se puede confirmar que sean suyas.
//   - organizacion = "Ecosistemas Patagonicos" => acceso completo al emprendimiento
//     Ecosistemas Patagónicos (PRD02) - no tiene sucursales propias todavía (a pedido
//     del usuario), así que siempre es acceso completo dentro de ese emprendimiento.
//   - organizacion = "Gerencia" => no está atada a NINGÚN emprendimiento fijo - elige cuál
//     quiere ver después de loguearse (ver emprendimientoDeSesion/EMPRENDIMIENTOS_DISPONIBLES
//     más abajo y api/src/routes/authRouter.js -> POST /auth/elegir-emprendimiento).
//
// Vacío se trata como acceso completo a Ecobahia a propósito (fail-open): si a alguien le
// falta cargar el dato en AD, que quede con acceso completo (como estaba la app hasta
// ahora) en vez de quedar bloqueado de todo por un dato faltante. Si se prefiere
// fail-closed, cambiar acá.

// Compara el nombre de sucursal/zona/emprendimiento de un dato de GP o de AD (ej. "BAHIA
// BLANCA", "LA PAMPA", "Ecosistemas Patagónicos") normalizando tildes/mayúsculas en los
// dos lados.
const normalizarNombreSucursal = (s) => (s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '') // saca tildes (Á -> A + combining acute)
  .trim()
  .toUpperCase();

const ORGANIZACION_ECOSISTEMAS = 'ECOSISTEMAS PATAGONICOS';
const ORGANIZACION_GERENCIA = 'GERENCIA';

const esAccesoCompleto = (organizacion) => {
  const valor = normalizarNombreSucursal(organizacion);
  return valor === '' || valor === 'ECOBAHIA' || valor === ORGANIZACION_ECOSISTEMAS || valor === ORGANIZACION_GERENCIA;
};

// Sucursal a la que un usuario restringido queda limitado, o null si tiene acceso
// completo. Para usar en los controllers: filtrar por esto cuando no sea null. Solo
// aplica dentro de Ecobahia - Ecosistemas y Gerencia nunca caen acá porque siempre son
// acceso completo.
const sucursalDeSesion = (usuarioSesion) => {
  const organizacion = usuarioSesion?.organizacion;
  return esAccesoCompleto(organizacion) ? null : organizacion.trim();
};

const esGerencia = (usuarioSesion) => normalizarNombreSucursal(usuarioSesion?.organizacion) === ORGANIZACION_GERENCIA;

// Emprendimientos (bases de GP) que existen hoy - usado tanto para resolver la sesión de
// Gerencia como para armarle la pantalla de selección en el cliente (ver /auth/me y
// /auth/login en authRouter.js, que exponen esta misma lista como "emprendimientosDisponibles").
// Agregar un emprendimiento nuevo acá es solo el primer paso: también hace falta darle su
// propio pool/config de GP y sumarlo a los controllers correspondientes (mismo trabajo que
// llevó Ecosistemas Patagónicos).
const EMPRENDIMIENTOS_DISPONIBLES = [
  { value: 'ecobahia', label: 'Ecobahia' },
  { value: 'ecosistemas', label: 'Ecosistemas Patagónicos' },
];

// Emprendimiento (base de datos de GP) al que pertenece la sesión: 'ecosistemas' si la
// organización de AD es "Ecosistemas Patagonicos", 'ecobahia' en cualquier otro caso
// (vacío, "Ecobahia", o cualquier sucursal de Ecobahia - todas viven en la misma base).
// Gerencia es un caso aparte: no tiene un emprendimiento fijo, así que se resuelve por lo
// que haya elegido (claim "emprendimientoElegido" del JWT, ver POST /auth/elegir-emprendimiento) -
// null si todavía no eligió, o si el valor guardado ya no es una opción válida (se
// revalida contra EMPRENDIMIENTOS_DISPONIBLES en cada request, no solo al emitir el token).
const EMPRENDIMIENTO_ECOBAHIA = 'ecobahia';
const EMPRENDIMIENTO_ECOSISTEMAS = 'ecosistemas';

const emprendimientoDeSesion = (usuarioSesion) => {
  const valor = normalizarNombreSucursal(usuarioSesion?.organizacion);
  if (valor === ORGANIZACION_ECOSISTEMAS) return EMPRENDIMIENTO_ECOSISTEMAS;
  if (valor === ORGANIZACION_GERENCIA) {
    const elegido = usuarioSesion?.emprendimientoElegido;
    return EMPRENDIMIENTOS_DISPONIBLES.some((e) => e.value === elegido) ? elegido : null;
  }
  return EMPRENDIMIENTO_ECOBAHIA;
};

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
const ORGANIZACIONES_CON_ACCESO = [
  'ECOBAHIA', 'TANDIL', 'LA PAMPA', 'BAHIA BLANCA', 'MAR DEL PLATA', 'PUERTO MADRYN',
  ORGANIZACION_ECOSISTEMAS, ORGANIZACION_GERENCIA,
];
const USUARIOS_CON_ACCESO_SIEMPRE = ['broscheitcb'];

const tieneAccesoALaApp = ({ usuario, organizacion }) => {
  if (USUARIOS_CON_ACCESO_SIEMPRE.includes((usuario || '').trim().toLowerCase())) return true;
  const valor = normalizarNombreSucursal(organizacion);
  return ORGANIZACIONES_CON_ACCESO.includes(valor);
};

module.exports = {
  esAccesoCompleto,
  sucursalDeSesion,
  emprendimientoDeSesion,
  esGerencia,
  EMPRENDIMIENTOS_DISPONIBLES,
  coincideSucursal,
  normalizarNombreSucursal,
  tieneAccesoALaApp,
};
