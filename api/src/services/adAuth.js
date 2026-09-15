const ldap = require('ldapjs');

const { AD_DOMAIN, AD_BASE_DN, AD_SERVERS, AD_PORT } = process.env;
const SERVIDORES = (AD_SERVERS || '').split(',').map((s) => s.trim()).filter(Boolean);

// Login contra Active Directory (basani.local) por bind directo, sin necesitar una
// cuenta de servicio: AD acepta autenticar con userPrincipalName (usuario@basani.local)
// aunque el usuario haya tecleado "BASANI\usuario" o solo "usuario" - se normaliza acá.
const aUserPrincipalName = (usuarioIngresado) => {
  const valor = usuarioIngresado.trim();
  if (valor.includes('@')) return valor;
  if (valor.includes('\\')) return `${valor.split('\\')[1]}@${AD_DOMAIN}`;
  return `${valor}@${AD_DOMAIN}`;
};

const bindConServidor = (url, upn, password) => new Promise((resolve, reject) => {
  const client = ldap.createClient({ url, connectTimeout: 4000, timeout: 5000 });
  client.on('error', (e) => reject(e));
  client.bind(upn, password, (err) => {
    if (err) {
      client.unbind();
      reject(err);
      return;
    }
    resolve(client);
  });
});

// Trae los datos para mostrar/usar en la sesión - no es crítico para el login (el bind
// ya validó la contraseña), si esto falla se deja pasar igual con el usuario tal cual se
// tipeó. "company" es el campo CLAVE para autorización (services/autorizacion.js) -
// confirmado contra un usuario real (MazzaRN: company="bahia blanca"); "o" (Organization)
// se probó primero pero no estaba cargado para todos los usuarios, se deja como
// respaldo por si algún usuario lo tiene ahí en vez de en company.
const buscarDatosUsuario = (client, upn) => new Promise((resolve) => {
  client.search(AD_BASE_DN, {
    scope: 'sub',
    filter: `(userPrincipalName=${upn})`,
    attributes: ['displayName', 'sAMAccountName', 'department', 'company', 'o'],
  }, (err, res) => {
    if (err) { resolve(null); return; }
    let encontrado = null;
    res.on('searchEntry', (entry) => { encontrado = entry.pojo.attributes; });
    res.on('error', () => resolve(null));
    res.on('end', () => resolve(encontrado));
  });
});

// Prueba los DCs configurados en orden (DC1-BA / DC2-BA) - si uno está caído sigue con
// el siguiente. Si el error es de credenciales inválidas no tiene sentido probar el otro
// DC (comparten la misma base de usuarios), así que corta ahí directo.
const autenticarUsuarioAD = async (usuarioIngresado, password) => {
  if (!usuarioIngresado || !password) throw new Error('Usuario y contraseña son requeridos');
  if (SERVIDORES.length === 0) throw new Error('AD_SERVERS no está configurado');

  const upn = aUserPrincipalName(usuarioIngresado);
  let ultimoError = null;

  for (const host of SERVIDORES) {
    const url = `ldap://${host}:${AD_PORT || 389}`;
    let client;
    try {
      client = await bindConServidor(url, upn, password);
    } catch (e) {
      if (e.name === 'InvalidCredentialsError') throw new Error('Usuario o contraseña incorrectos');
      ultimoError = e;
      continue;
    }

    const attrs = await buscarDatosUsuario(client, upn);
    client.unbind();

    const valorDe = (tipo) => attrs?.find((a) => a.type === tipo)?.values?.[0] || null;

    return {
      usuario: valorDe('sAMAccountName') || upn.split('@')[0],
      nombre: valorDe('displayName') || upn.split('@')[0],
      department: valorDe('department'),
      company: valorDe('company'),
      organizacion: valorDe('company') || valorDe('o'),
    };
  }

  throw new Error(`No se pudo conectar con ningún controlador de dominio (${ultimoError?.message || 'sin detalle'})`);
};

module.exports = { autenticarUsuarioAD };
