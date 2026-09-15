const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const cors = require('cors');

const authRouter = require('./routes/authRouter.js');
const validacionRouter = require('./routes/validacionRouter.js');
const requireAuth = require('./middlewares/requireAuth.js');

const server = express();
server.name = 'API';

// Login por Active Directory (cookie httpOnly con JWT): a diferencia del "*" de antes,
// con cookies de sesión el origen tiene que ser explícito (los navegadores no mandan
// credentials a un CORS abierto con "*"). CORS_ORIGIN admite varios separados por coma
// para cuando el front se sirva desde más de una URL.
const origenesPermitidos = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);

server.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
server.use(bodyParser.json({ limit: '50mb' }));
server.use(cookieParser());
server.use(morgan('dev'));
server.use(cors({ origin: origenesPermitidos, credentials: true }));
server.use((req, res, next) => {
  res.header('Cache-Control', 'no-store');
  next();
});

server.use('/auth', authRouter);
server.use('/', requireAuth, validacionRouter);

server.use((err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || err;
  console.log(err);
  res.status(status).send(message);
});

module.exports = server;
