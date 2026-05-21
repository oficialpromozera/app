const express = require('express');
const bcrypt = require('bcryptjs');
const { createUser, findUserByEmail, findUserById } = require('./db');

const router = express.Router();

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function requireAuth(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) {
    if (req.path.startsWith('/api')) return res.status(401).json({ ok: false, error: 'Faça login para continuar.' });
    return res.redirect('/login.html');
  }
  const user = findUserById(userId);
  if (!user) {
    req.session.destroy(() => {});
    if (req.path.startsWith('/api')) return res.status(401).json({ ok: false, error: 'Sessão inválida. Faça login novamente.' });
    return res.redirect('/login.html');
  }
  req.user = user;
  next();
}

function redirectIfLogged(req, res, next) {
  if (req.session?.userId) return res.redirect('/');
  next();
}

router.get('/me', (req, res) => {
  const user = req.session?.userId ? findUserById(req.session.userId) : null;
  res.json({ ok: true, user: publicUser(user) });
});

router.post('/register', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (name.length < 2) return res.status(400).json({ ok: false, error: 'Informe seu nome.' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ ok: false, error: 'Informe um e-mail válido.' });
    if (password.length < 6) return res.status(400).json({ ok: false, error: 'A senha precisa ter pelo menos 6 caracteres.' });
    if (findUserByEmail(email)) return res.status(409).json({ ok: false, error: 'Este e-mail já está cadastrado.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = createUser({ name, email, passwordHash });
    req.session.userId = user.id;
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = findUserByEmail(email);
    if (!user) return res.status(401).json({ ok: false, error: 'E-mail ou senha inválidos.' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ ok: false, error: 'E-mail ou senha inválidos.' });
    req.session.userId = user.id;
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('afiliado.sid');
    res.json({ ok: true });
  });
});

module.exports = { router, requireAuth, redirectIfLogged };
