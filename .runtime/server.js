require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const session = require('express-session');
const routes = require('./src/routes');
const { readLocal, verifyNow, activateLicense, requireValidLicense, ADMIN_LICENSE_SERVER } = require('./src/licenseAgent');
const mercadoLivreOriginalRoutes = require('./src/routes/mercadolivre-original');
const { router: authRoutes, requireAuth, redirectIfLogged } = require('./src/auth');
const { withUserEnv } = require('./src/userEnv');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'troque-este-segredo-no-env';

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use(session({
  name: 'afiliado.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

app.use('/api/auth', authRoutes);
app.get('/login.html', redirectIfLogged, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register.html', redirectIfLogged, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));

app.get('/api/license/status', async (_req, res) => res.json({ ...(await verifyNow()), adminServer: ADMIN_LICENSE_SERVER }));
app.post('/api/license/activate', async (req, res) => res.json({ ...(await activateLicense(req.body?.key)), adminServer: ADMIN_LICENSE_SERVER }));
app.get('/license.html', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'license.html')));
app.get('/license.js', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'license.js')));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.get('/', requireValidLicense, requireAuth, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/extracao-cookie-ml', requireValidLicense, requireAuth, (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Rotas protegidas: cada usuário usa as próprias configurações salvas no banco local.
app.use('/api', requireValidLicense, requireAuth, withUserEnv, mercadoLivreOriginalRoutes);
app.use('/api', requireValidLicense, requireAuth, withUserEnv, routes);

app.get('*', requireValidLicense, requireAuth, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`🚀 Painel Afiliado MultiPlataforma Pro: http://localhost:${PORT}`);
});
