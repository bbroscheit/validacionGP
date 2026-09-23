const authRouter = require('express').Router();
const jwt = require('jsonwebtoken');
const { autenticarUsuarioAD } = require('../services/adAuth.js');
const { tieneAccesoALaApp, emprendimientoDeSesion, esGerencia, EMPRENDIMIENTOS_DISPONIBLES } = require('../services/autorizacion.js');

const { JWT_SECRET, COOKIE_SECURE } = process.env;
const DURACION_SESION_MS = 12 * 60 * 60 * 1000; // 12hs

const opcionesCookie = {
  httpOnly: true,
  sameSite: 'lax',
  secure: COOKIE_SECURE === 'true',
  maxAge: DURACION_SESION_MS,
};

// Campos derivados que van en toda respuesta que expone la sesión (/login, /me): además
// del emprendimiento efectivo, si el usuario es de Gerencia (services/autorizacion.js) se
// le manda también la lista de emprendimientos entre los que puede elegir - así el cliente
// nunca necesita su propia copia hardcodeada (ver client/pages/elegir-emprendimiento.js).
const datosDerivadosSesion = (datosUsuario) => {
  const gerencia = esGerencia(datosUsuario);
  return {
    emprendimiento: emprendimientoDeSesion(datosUsuario),
    esGerencia: gerencia,
    ...(gerencia ? { emprendimientosDisponibles: EMPRENDIMIENTOS_DISPONIBLES } : {}),
  };
};

authRouter.post('/login', async (req, res) => {
  try {
    const { usuario, password } = req.body;
    const datosUsuario = await autenticarUsuarioAD(usuario, password);
    if (!tieneAccesoALaApp(datosUsuario)) {
      res.status(403).json({ state: 'error', message: 'Tu usuario todavía no tiene acceso a esta aplicación. Consultá para que agreguen tu sucursal.' });
      return;
    }
    const token = jwt.sign(datosUsuario, JWT_SECRET, { expiresIn: DURACION_SESION_MS / 1000 });
    res.cookie('token', token, opcionesCookie);
    res.status(200).json({ ...datosUsuario, ...datosDerivadosSesion(datosUsuario) });
  } catch (e) {
    console.log('error en /auth/login', e.message);
    res.status(401).json({ state: 'error', message: e.message });
  }
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie('token', opcionesCookie);
  res.status(200).json({ state: 'ok' });
});

authRouter.get('/me', (req, res) => {
  const token = req.cookies?.token;
  if (!token) {
    res.status(401).json({ state: 'error' });
    return;
  }
  try {
    const datosUsuario = jwt.verify(token, JWT_SECRET);
    const { usuario, nombre, department, company, organizacion } = datosUsuario;
    res.status(200).json({ usuario, nombre, department, company, organizacion, ...datosDerivadosSesion(datosUsuario) });
  } catch (e) {
    res.status(401).json({ state: 'error' });
  }
});

// Solo para usuarios de Gerencia (services/autorizacion.js -> esGerencia): reemite la
// cookie de sesión con el emprendimiento elegido adentro (claim "emprendimientoElegido").
// A partir de acá emprendimientoDeSesion() devuelve para esta sesión exactamente lo mismo
// que le devolvería a un usuario nativo de esa compañía - ningún controller/ruta necesita
// saber que el usuario es de Gerencia, ven una sesión estructuralmente idéntica.
// OJO: jwt.verify ya devuelve el payload CON iat/exp adentro - hay que descartarlos antes
// de volver a firmar, si no jsonwebtoken tira "Bad options.expiresIn option the payload
// already has an exp property".
authRouter.post('/elegir-emprendimiento', (req, res) => {
  const token = req.cookies?.token;
  if (!token) {
    res.status(401).json({ state: 'error' });
    return;
  }
  let datosUsuario;
  try {
    const { iat, exp, ...resto } = jwt.verify(token, JWT_SECRET);
    datosUsuario = resto;
  } catch (e) {
    res.status(401).json({ state: 'error' });
    return;
  }
  if (!esGerencia(datosUsuario)) {
    res.status(403).json({ state: 'error', message: 'Solo Gerencia puede elegir emprendimiento.' });
    return;
  }
  const { emprendimiento } = req.body;
  if (!EMPRENDIMIENTOS_DISPONIBLES.some((e) => e.value === emprendimiento)) {
    res.status(400).json({ state: 'error', message: 'Emprendimiento inválido.' });
    return;
  }
  const datosConEleccion = { ...datosUsuario, emprendimientoElegido: emprendimiento };
  const token2 = jwt.sign(datosConEleccion, JWT_SECRET, { expiresIn: DURACION_SESION_MS / 1000 });
  res.cookie('token', token2, opcionesCookie);
  res.status(200).json({ state: 'ok', emprendimiento });
});

module.exports = authRouter;
