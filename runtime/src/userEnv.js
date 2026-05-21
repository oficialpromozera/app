const { AsyncLocalStorage } = require('async_hooks');
const { getUserSettings } = require('./db');

const storage = new AsyncLocalStorage();

const DEFAULTS = {
  // Mantém a Magalu funcionando como no ZIP original, sem mostrar essa configuração no painel.
  MAGALU_STORE_SLUG: 'promozeraoficial',
  MAGALU_AFFILIATE_ID: 'promozeraoficial',
  SCRAPER_USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

function env(key, fallback = '') {
  const store = storage.getStore() || {};
  const settings = store.settings || {};
  if (Object.prototype.hasOwnProperty.call(settings, key)) return settings[key] || fallback || DEFAULTS[key] || '';
  return process.env[key] || fallback || DEFAULTS[key] || '';
}

function withUserEnv(req, _res, next) {
  const settings = req.user?.id ? getUserSettings(req.user.id) : {};
  storage.run({ userId: req.user?.id || null, settings }, next);
}

function currentUserSettings() {
  return (storage.getStore() || {}).settings || {};
}

module.exports = { env, withUserEnv, currentUserSettings };
