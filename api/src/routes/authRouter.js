const authRouter = require('express').Router();
const jwt = require('jsonwebtoken');
const { autenticarUsuarioAD } = require('../services/adAuth.js');
const { tieneAccesoALaApp, emprendimientoDeSesion } = require('../services/autorizacion.js');

const { JWT_SECRET, COOKIE_SECURE } = process.env;
const DURACION_SESION_MS = 12 * 60 * 60 * 1000; // 12hs

const opcionesCookie = {
  httpOnly: true,
  sameSite: 'lax',
  secure: COOKIE_SECURE === 'true',
  maxAge: DURACION_SESION_MS,
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
    res.status(200).json({ ...datosUsuario, emprendimiento: emprendimientoDeSesion(datosUsuario) });
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
    res.status(200).json({ usuario, nombre, department, company, organizacion, emprendimiento: emprendimientoDeSesion(datosUsuario) });
  } catch (e) {
    res.status(401).json({ state: 'error' });
  }
});

module.exports = authRouter;
