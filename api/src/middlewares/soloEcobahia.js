// Para rutas que solo existen para Ecobahia (sist2, que Ecosistemas Patagónicos no
// tiene; Bancos Cobranzas, que por ahora solo busca contra la base de clientes de
// Ecobahia) - se bloquean del todo para cualquier otro emprendimiento en vez de dejarlas
// pegarle silenciosamente a la base equivocada. Ver services/autorizacion.js.
const soloEcobahia = (req, res, next) => {
  if (req.emprendimiento !== 'ecobahia') {
    res.status(403).json({
      state: 'error',
      message: 'Este reporte no está disponible para tu compañía.',
    });
    return;
  }
  next();
};

module.exports = soloEcobahia;
