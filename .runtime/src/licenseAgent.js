const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const DATA_DIR = process.env.AGENT_DATA_DIR || path.join(__dirname, '..', 'data');
const LICENSE_FILE = path.join(DATA_DIR, 'agent-license.json');
const ADMIN_LICENSE_SERVER = process.env.ADMIN_LICENSE_SERVER || 'http://localhost:3001';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function getAgentId() {
  const file = path.join(DATA_DIR, 'agent-id.txt');
  try { return fs.readFileSync(file, 'utf8').trim(); }
  catch {
    const id = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(file, id);
    return id;
  }
}

function readLocal() {
  try { return JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8')); }
  catch { return { key: '', status: 'missing', message: 'Informe uma licença para liberar o painel.', lastCheckAt: '', online: false }; }
}

function writeLocal(data) {
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getExpiresAt(state = {}) {
  return state.expiresAt || state.license?.expiresAt || '';
}

function isExpiredLocal(state = {}) {
  const expiresAt = getExpiresAt(state);
  return !!expiresAt && new Date(expiresAt).getTime() < Date.now();
}

function normalizeOnlineState(current = {}, data = {}) {
  const license = data.license || current.license || {};
  return {
    ...current,
    ...data,
    key: current.key,
    license,
    expiresAt: data.expiresAt || license.expiresAt || current.expiresAt || '',
    online: true,
    lastCheckAt: new Date().toISOString(),
    adminServer: ADMIN_LICENSE_SERVER
  };
}

function offlineFallback(current = {}) {
  const expiresAt = getExpiresAt(current);

  // Upgrade solicitado:
  // Se a licença já foi validada online antes e ainda não expirou localmente,
  // o Agent continua liberado mesmo com o Admin/túnel offline.
  // Quando o Admin voltar, verifyNow() sincroniza novamente e respeita bloqueio/expiração/remoção.
  if (current.key && current.ok === true && current.status === 'active' && !isExpiredLocal(current)) {
    const next = {
      ...current,
      ok: true,
      status: 'active',
      online: false,
      offlineGrace: true,
      expiresAt,
      message: 'ADMIN OFFLINE: licença já validada. Acesso liberado até a data de expiração. Quando o Admin voltar, a verificação será retomada.',
      lastOfflineAt: new Date().toISOString(),
      adminServer: ADMIN_LICENSE_SERVER
    };
    writeLocal(next);
    return next;
  }

  if (current.key && isExpiredLocal(current)) {
    const next = {
      ...current,
      ok: false,
      status: 'expired',
      online: false,
      offlineGrace: false,
      expiresAt,
      message: 'Licença expirada. Conecte ao Admin e informe uma licença válida.',
      lastCheckAt: new Date().toISOString(),
      adminServer: ADMIN_LICENSE_SERVER
    };
    writeLocal(next);
    return next;
  }

  const next = {
    ...current,
    ok: false,
    status: 'offline',
    online: false,
    offlineGrace: false,
    message: 'OFFLINE: Agent não conseguiu sincronizar com o painel Admin.',
    lastCheckAt: new Date().toISOString(),
    adminServer: ADMIN_LICENSE_SERVER
  };
  writeLocal(next);
  return next;
}

async function verifyNow() {
  const current = readLocal();
  if (!current.key) return { ...current, ok: false, online: false, offlineGrace: false };

  // Se já expirou pelo cache local, bloqueia imediatamente mesmo sem depender do Admin.
  if (isExpiredLocal(current)) {
    return offlineFallback(current);
  }

  try {
    const { data } = await axios.post(`${ADMIN_LICENSE_SERVER.replace(/\/$/,'')}/api/license-server/verify`, {
      key: current.key,
      agentId: getAgentId()
    }, { timeout: 3000, validateStatus: () => true });

    if (!data || typeof data !== 'object') throw new Error('Resposta inválida do Admin.');

    const next = normalizeOnlineState(current, { ...data, offlineGrace: false });
    writeLocal(next);
    return next;
  } catch (err) {
    return offlineFallback(current);
  }
}

async function activateLicense(key) {
  writeLocal({
    key: String(key || '').trim(),
    status: 'checking',
    ok: false,
    online: false,
    offlineGrace: false,
    message: 'Verificando licença...',
    adminServer: ADMIN_LICENSE_SERVER
  });
  return verifyNow();
}

async function requireValidLicense(req, res, next) {
  const state = await verifyNow();
  if (state.ok && state.status === 'active') return next();
  if (req.path.startsWith('/api')) return res.status(403).json({ ok: false, licenseRequired: true, status: state.status, error: state.message || 'Licença inválida.' });
  return res.redirect('/license.html');
}

module.exports = { ADMIN_LICENSE_SERVER, readLocal, verifyNow, activateLicense, requireValidLicense };
