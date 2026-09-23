const jwt = require('jsonwebtoken');
const { sucursalDeSesion, emprendimientoDeSesion } = require('../services/autorizacion.js');

const { JWT_SECRET } = process.env;

// Protege todas las rutas de datos: exige la cookie de sesión (JWT) que deja /auth/login
// tras validar contra Active Directory. Sin esto cualquiera con la URL de la API podía
// pegarle a los reportes sin loguearse.
//
// Además calcula req.sucursalRestringida (services/autorizacion.js, a partir del "o" de
// AD): null si el usuario tiene acceso completo, o el nombre de sucursal al que queda
// limitado - los controllers/rutas lo usan para filtrar o bloquear según corresponda.
// Y req.emprendimiento ('ecobahia' | 'ecosistemas'): a qué base de datos de GP apuntan
// todas las consultas de esta sesión, según la compañía de AD del usuario. Para un usuario
// de Gerencia que todavía no eligió emprendimiento, emprendimientoDeSesion da null - se
// corta acá con 403 en vez de dejarlo pasar, así ninguna ruta de reportes queda alcanzable
// hasta que elija (ver POST /auth/elegir-emprendimiento en authRouter.js). No afecta a
// nadie más: para cualquier otro usuario emprendimientoDeSesion nunca da null.
const requireAuth = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    res.status(401).json({ state: 'error', message: 'No autenticado' });
    return;
  }
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    req.sucursalRestringida = sucursalDeSesion(req.usuario);
    req.emprendimiento = emprendimientoDeSesion(req.usuario);
    if (!req.emprendimiento) {
      res.status(403).json({ state: 'error', message: 'Elegí un emprendimiento antes de continuar.' });
      return;
    }
    next();
  } catch (e) {
    res.status(401).json({ state: 'error', message: 'Sesión inválida o vencida' });
  }
};

module.exports = requireAuth;
