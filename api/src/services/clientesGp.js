const { getGpPoolEcobahia, sql } = require('../config/gpPool');

// Búsqueda de clientes de GP (RM00101) por CUIT o por nombre, para los excels de
// cobranzas bancarias (client/pages/bancos-cobranzas): cada banco entrega un movimiento
// con el CUIT y/o nombre del ordenante, hay que traer a qué cliente de GP corresponde.
//
// El CUIT vive en TXRGNNUM junto con el código de documento pegado al final (mismo campo
// que usa Libro IVA Digital - ver services/libroIvaDigitalData.js): "30546694719       80"
// = CUIT + relleno + código de documento (2 dígitos). Se descarta cualquier
// TXRGNNUM que no quede en exactamente 11 dígitos al sacarle el código - no es un CUIT
// válido (DNI u otro documento), no tiene sentido buscarlo como tal.
//
// OJO: un mismo CUIT puede estar cargado en más de un cliente (66 casos confirmados
// contra PRD08 - normalmente el mismo cliente repetido por sucursal, ej. "PREFECTURA
// NAVAL ARGENTINA" y "PREF. NAVAL ARGENTINA MDP" con el mismo CUIT). GP no tiene ningún
// campo que diga a cuál corresponde una operación puntual, así que esos casos quedan
// marcados como ambiguos en vez of elegir uno a ciegas (a pedido del usuario).
const CUIT_RE = /^\d{11}$/;
// "99999999999" es el CUIT placeholder estándar de AFIP/ARCA para "Consumidor Final sin
// identificar" - confirmado 2 clientes de GP cargados así ("Ariana Mazzeo", "Prueba
// cliente"). No es un CUIT real, tratarlo como tal generaría falsos "ambiguo" cada vez
// que aparezca (cualquier CUIT real nunca puede coincidir con este, así que no hay
// pérdida en excluirlo del todo).
const CUIT_PLACEHOLDER = '99999999999';

// Normaliza texto para comparar nombres: sin tildes, mayúsculas, sin puntuación
// (S.A. vs SA, LTDA. vs LTDA), espacios colapsados. Más agresivo que
// autorizacion.js/normalizarNombreSucursal porque los nombres de empresas varían más en
// puntuación que los nombres de sucursal.
const normalizarNombre = (s) => (s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

let cacheClientes = null;

const cargarClientes = async () => {
  const pool = await getGpPoolEcobahia();
  const result = await pool.request().query(`
    SELECT LTRIM(RTRIM(CUSTNMBR)) AS CUSTNMBR, LTRIM(RTRIM(CUSTNAME)) AS CUSTNAME, TXRGNNUM
    FROM RM00101
  `);

  const porCuit = new Map(); // cuit -> [{custnmbr, custname}]
  const porNombre = new Map(); // nombreNormalizado -> {custnmbr, custname} (primero que aparezca)

  result.recordset.forEach((row) => {
    const cuit = (row.TXRGNNUM || '').trim().slice(0, -2).trim();
    if (CUIT_RE.test(cuit) && cuit !== CUIT_PLACEHOLDER) {
      if (!porCuit.has(cuit)) porCuit.set(cuit, []);
      porCuit.get(cuit).push({ custnmbr: row.CUSTNMBR, custname: row.CUSTNAME });
    }
    const nombreNorm = normalizarNombre(row.CUSTNAME);
    if (nombreNorm && !porNombre.has(nombreNorm)) {
      porNombre.set(nombreNorm, { custnmbr: row.CUSTNMBR, custname: row.CUSTNAME });
    }
  });

  return { porCuit, porNombre };
};

// Cachea dentro del proceso (la base de clientes no cambia entre requests seguidos de la
// misma sesión de carga de excels) - se invalida sola si el proceso se reinicia.
const getClientesEcobahia = async () => {
  if (!cacheClientes) cacheClientes = await cargarClientes();
  return cacheClientes;
};

// Busca un cliente por CUIT primero, por nombre si no matchea (a pedido del usuario).
// Devuelve { custnmbr } si hay un match único, { ambiguo: [custnmbr...] } si el CUIT
// matcheó más de un cliente, o null si no se encontró nada.
const buscarCliente = async ({ cuit, nombre }) => {
  const { porCuit, porNombre } = await getClientesEcobahia();

  if (cuit && CUIT_RE.test(cuit)) {
    const candidatos = porCuit.get(cuit);
    if (candidatos && candidatos.length === 1) return { custnmbr: candidatos[0].custnmbr };
    if (candidatos && candidatos.length > 1) return { ambiguo: candidatos.map((c) => c.custnmbr) };
  }

  const nombreNorm = normalizarNombre(nombre);
  if (nombreNorm && porNombre.has(nombreNorm)) {
    return { custnmbr: porNombre.get(nombreNorm).custnmbr };
  }

  return null;
};

module.exports = { getClientesEcobahia, buscarCliente, normalizarNombre };
