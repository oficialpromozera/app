const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'database.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function emptyDb() {
  return { users: [], user_settings: [], user_posts: [], promo_queue: [], sent_products: [], licenses: [], meta: { created_at: new Date().toISOString() } };
}

function readDb() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    data.users ||= [];
    data.user_settings ||= [];
    data.user_posts ||= [];
    data.promo_queue ||= [];
    data.sent_products ||= [];
    data.licenses ||= [];
    data.meta ||= {};
    return data;
  } catch {
    const data = emptyDb();
    writeDb(data);
    return data;
  }
}

function writeDb(data) {
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DB_PATH);
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role || 'user', created_at: user.created_at };
}

function createUser({ name, email, passwordHash }) {
  const db = readDb();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (db.users.some(user => String(user.email).toLowerCase() === normalizedEmail)) {
    const err = new Error('Este e-mail já está cadastrado.');
    err.code = 'USER_EXISTS';
    throw err;
  }
  const user = {
    id: nextId(db.users),
    name: String(name || '').trim(),
    email: normalizedEmail,
    password_hash: passwordHash,
    role: 'user',
    created_at: new Date().toISOString()
  };
  db.users.push(user);
  writeDb(db);
  return publicUser(user);
}

function findUserByEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = readDb().users.find(item => String(item.email).toLowerCase() === normalizedEmail);
  return user || null;
}

function findUserById(id) {
  const user = readDb().users.find(item => Number(item.id) === Number(id));
  return publicUser(user);
}

function getUserSettings(userId) {
  const id = Number(userId);
  const rows = readDb().user_settings.filter(row => Number(row.user_id) === id);
  return Object.fromEntries(rows.map(row => [row.key, row.value]));
}

function saveUserSettings(userId, values = {}) {
  const id = Number(userId);
  const db = readDb();
  const userExists = db.users.some(user => Number(user.id) === id);
  if (!userExists) throw new Error('Usuário não encontrado.');

  for (const [key, value] of Object.entries(values || {})) {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) continue;
    const cleanValue = String(value ?? '').trim();
    const row = db.user_settings.find(item => Number(item.user_id) === id && item.key === cleanKey);
    if (row) {
      row.value = cleanValue;
      row.updated_at = new Date().toISOString();
    } else {
      db.user_settings.push({ user_id: id, key: cleanKey, value: cleanValue, updated_at: new Date().toISOString() });
    }
  }
  writeDb(db);
  return getUserSettings(id);
}

function saveGeneratedPost(userId, product = {}, copy = '') {
  const id = Number(userId);
  const db = readDb();
  db.user_posts.push({
    id: nextId(db.user_posts),
    user_id: id,
    platform: product.platform || '',
    title: product.title || '',
    price: product.price || '',
    link: product.affiliateLink || product.link || product.url || '',
    copy: copy || '',
    created_at: new Date().toISOString()
  });
  writeDb(db);
}

function listGeneratedPosts(userId, limit = 50) {
  const id = Number(userId);
  return readDb().user_posts
    .filter(post => Number(post.user_id) === id)
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, Math.min(Number(limit) || 50, 200));
}


function addQueueItem(userId, product = {}, copy = '') {
  const id = Number(userId);
  const db = readDb();
  db.promo_queue ||= [];
  const now = new Date().toISOString();
  const link = product.affiliateLink || product.finalUrl || product.link || product.url || '';
  const exists = db.promo_queue.find(item => Number(item.user_id) === id && item.status === 'pending' && (item.link || '') === link && link);
  if (exists) return exists;
  const item = {
    id: nextId(db.promo_queue),
    user_id: id,
    status: 'pending',
    platform: product.platform || '',
    title: product.title || '',
    price: product.price || '',
    image: product.image || '',
    link,
    product,
    copy: copy || '',
    attempts: 0,
    created_at: now,
    updated_at: now
  };
  db.promo_queue.push(item);
  writeDb(db);
  return item;
}

function listQueueItems(userId) {
  const id = Number(userId);
  return readDb().promo_queue
    .filter(item => Number(item.user_id) === id && item.status === 'pending')
    .sort((a, b) => Number(a.id) - Number(b.id));
}

function removeQueueItem(userId, itemId) {
  const id = Number(userId);
  const db = readDb();
  const item = db.promo_queue.find(row => Number(row.user_id) === id && Number(row.id) === Number(itemId));
  if (!item) return false;
  db.promo_queue = db.promo_queue.filter(row => !(Number(row.user_id) === id && Number(row.id) === Number(itemId)));
  writeDb(db);
  return true;
}

function markQueueItemSent(userId, itemId, channels = [], result = {}) {
  const id = Number(userId);
  const db = readDb();
  db.sent_products ||= [];
  const idx = db.promo_queue.findIndex(row => Number(row.user_id) === id && Number(row.id) === Number(itemId));
  if (idx < 0) return null;
  const item = db.promo_queue[idx];
  const sent = {
    ...item,
    status: 'sent',
    channels,
    result,
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  db.promo_queue.splice(idx, 1);
  db.sent_products.push(sent);
  writeDb(db);
  return sent;
}

function incrementQueueAttempt(userId, itemId, error = '') {
  const id = Number(userId);
  const db = readDb();
  const item = db.promo_queue.find(row => Number(row.user_id) === id && Number(row.id) === Number(itemId));
  if (!item) return null;
  item.attempts = Number(item.attempts || 0) + 1;
  item.last_error = String(error || '').slice(0, 1000);
  item.updated_at = new Date().toISOString();
  writeDb(db);
  return item;
}

function listSentProducts(userId, limit = 100) {
  const id = Number(userId);
  return readDb().sent_products
    .filter(item => Number(item.user_id) === id)
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, Math.min(Number(limit) || 100, 500));
}


function listLicenses() {
  const { publicLicense } = require('./licenseCore');
  return readDb().licenses.map(publicLicense).sort((a, b) => Number(b.id) - Number(a.id));
}

function createLicense({ clientName = '', expiresAt = '' } = {}) {
  const { makeLicenseKey, nowIso, publicLicense } = require('./licenseCore');
  const db = readDb();
  db.licenses ||= [];
  const lic = {
    id: nextId(db.licenses),
    key: makeLicenseKey(),
    clientName: String(clientName || '').trim(),
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : '',
    blocked: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastCheckAt: '',
    lastIp: '',
    agentId: ''
  };
  db.licenses.push(lic);
  writeDb(db);
  return publicLicense(lic);
}

function updateLicense(id, patch = {}) {
  const { nowIso, publicLicense } = require('./licenseCore');
  const db = readDb();
  db.licenses ||= [];
  const lic = db.licenses.find(x => Number(x.id) === Number(id));
  if (!lic) return null;
  if (Object.prototype.hasOwnProperty.call(patch, 'clientName')) lic.clientName = String(patch.clientName || '').trim();
  if (Object.prototype.hasOwnProperty.call(patch, 'expiresAt')) lic.expiresAt = patch.expiresAt ? new Date(patch.expiresAt).toISOString() : '';
  if (Object.prototype.hasOwnProperty.call(patch, 'blocked')) lic.blocked = !!patch.blocked;
  lic.updatedAt = nowIso();
  writeDb(db);
  return publicLicense(lic);
}

function deleteLicense(id) {
  const db = readDb();
  db.licenses ||= [];
  const before = db.licenses.length;
  db.licenses = db.licenses.filter(x => Number(x.id) !== Number(id));
  writeDb(db);
  return db.licenses.length !== before;
}

function verifyLicense({ key = '', agentId = '', ip = '' } = {}) {
  const { nowIso, isExpired, publicLicense } = require('./licenseCore');
  const db = readDb();
  db.licenses ||= [];
  const lic = db.licenses.find(x => String(x.key || '').trim().toUpperCase() === String(key || '').trim().toUpperCase());
  if (!lic) return { ok: false, status: 'invalid', message: 'Licença não encontrada.' };
  lic.lastCheckAt = nowIso();
  lic.lastIp = String(ip || '').slice(0, 80);
  lic.agentId = String(agentId || '').slice(0, 120);
  lic.updatedAt = nowIso();
  writeDb(db);
  if (lic.blocked) return { ok: false, status: 'blocked', message: 'Licença bloqueada.', license: publicLicense(lic) };
  if (isExpired(lic.expiresAt)) return { ok: false, status: 'expired', message: 'Licença expirada.', license: publicLicense(lic) };
  return { ok: true, status: 'active', message: 'Licença válida.', license: publicLicense(lic) };
}

function exportSafeBackup() {
  const db = readDb();
  return {
    ...db,
    users: db.users.map(user => ({ ...user, password_hash: '[hash protegido]' }))
  };
}

module.exports = {
  DB_PATH,
  createUser,
  findUserByEmail,
  findUserById,
  getUserSettings,
  saveUserSettings,
  saveGeneratedPost,
  listGeneratedPosts,
  addQueueItem,
  listQueueItems,
  removeQueueItem,
  markQueueItemSent,
  incrementQueueAttempt,
  listSentProducts,
  listLicenses,
  createLicense,
  updateLicense,
  deleteLicense,
  verifyLicense,
  exportSafeBackup
};
