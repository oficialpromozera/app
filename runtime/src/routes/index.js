const express = require('express');
const { http } = require('../lib/http');
const providers = require('../providers');
const { makeCopy } = require('../lib/format');
const { productFromLink, convertAffiliate } = require('../providers/linkProduct');
const { getUserSettings, saveUserSettings, saveGeneratedPost, listGeneratedPosts, addQueueItem, listQueueItems, removeQueueItem, markQueueItemSent, incrementQueueAttempt, listSentProducts } = require('../db');
const { env } = require('../userEnv');

const router = express.Router();

const ENV_GROUPS = [
  { title: 'Telegram', keys: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'] },
  { title: 'WhatsApp Cloud API', keys: ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_TO', 'WHATSAPP_TEMPLATE_NAME', 'WHATSAPP_TEMPLATE_LANGUAGE'] },
  { title: 'Mercado Livre Afiliados', keys: ['ML_COOKIE', 'ML_CSRF_TOKEN', 'ML_AFFILIATE_TAG'] },
  { title: 'Shopee Afiliados / Open API oficial', keys: ['SHOPEE_API_URL', 'SHOPEE_APP_ID', 'SHOPEE_SECRET', 'SHOPEE_AFFILIATE_ID'] },
  { title: 'Magazine Luiza', keys: ['MAGALU_STORE_SLUG'] }
];
const ENV_KEYS = ENV_GROUPS.flatMap(g => g.keys);

const PLATFORM_NAMES = {
  mercadolivre: 'Mercado Livre', shopee: 'Shopee', magalu: 'Magazine Luiza', amazon: 'Amazon'
};


function productShareLink(product = {}) {
  return product.affiliateLink || product.finalUrl || product.link || product.url || product.originalUrl || '';
}

function metaApprovedCopy(product = {}) {
  const link = productShareLink(product);
  return [
    'Oferta disponível para você conferir:',
    product.title || 'Produto em promoção',
    product.price ? `Preço: ${product.price}` : '',
    link ? `Link: ${link}` : ''
  ].filter(Boolean).join('\n');
}

function whatsappConfig(userId) {
  const settings = getUserSettings(userId);
  return {
    phoneNumberId: settings.WHATSAPP_PHONE_NUMBER_ID || env('WHATSAPP_PHONE_NUMBER_ID'),
    accessToken: settings.WHATSAPP_ACCESS_TOKEN || env('WHATSAPP_ACCESS_TOKEN'),
    to: settings.WHATSAPP_TO || env('WHATSAPP_TO'),
    templateName: settings.WHATSAPP_TEMPLATE_NAME || env('WHATSAPP_TEMPLATE_NAME') || 'oferta_produto',
    templateLanguage: settings.WHATSAPP_TEMPLATE_LANGUAGE || env('WHATSAPP_TEMPLATE_LANGUAGE') || 'pt_BR'
  };
}

function normalizeWhatsAppTo(value = '') {
  return String(value || '').replace(/[^\d]/g, '');
}

async function sendWhatsAppMessage(userId, product = {}, copy = '') {
  const cfg = whatsappConfig(userId);
  const to = normalizeWhatsAppTo(cfg.to);
  if (!cfg.phoneNumberId || !cfg.accessToken || !to) {
    const err = new Error('Configure WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN e WHATSAPP_TO no painel de configurações.');
    err.status = 400;
    throw err;
  }

  const url = `https://graph.facebook.com/v20.0/${cfg.phoneNumberId}/messages`;
  const headers = { Authorization: `Bearer ${cfg.accessToken}` };
  const safeCopy = copy || metaApprovedCopy(product);

  const imagePayload = product?.image ? {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'image',
    image: { link: product.image, caption: String(safeCopy).slice(0, 1024) }
  } : {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: true, body: String(safeCopy).slice(0, 4096) }
  };

  try {
    await http.post(url, imagePayload, { headers });
    return { ok: true, mode: product?.image ? 'image' : 'text' };
  } catch (firstErr) {
    const fallbackCopy = metaApprovedCopy(product);
    const components = [];
    if (product?.image) {
      components.push({ type: 'header', parameters: [{ type: 'image', image: { link: product.image } }] });
    }
    components.push({
      type: 'body',
      parameters: [
        { type: 'text', text: String(product?.title || 'Produto em promoção').slice(0, 250) },
        { type: 'text', text: String(product?.price || 'Confira no link').slice(0, 80) },
        { type: 'text', text: String(productShareLink(product) || '').slice(0, 500) }
      ]
    });

    const templatePayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: cfg.templateName,
        language: { code: cfg.templateLanguage },
        components
      }
    };

    try {
      await http.post(url, templatePayload, { headers });
      return { ok: true, mode: 'template_fallback', fallbackCopy };
    } catch (templateErr) {
      const err = new Error(templateErr.response?.data?.error?.message || templateErr.response?.data?.message || firstErr.response?.data?.error?.message || firstErr.message);
      err.status = templateErr.response?.status || firstErr.response?.status || 500;
      err.details = templateErr.response?.data || firstErr.response?.data;
      throw err;
    }
  }
}

async function sendTelegramMessage(userId, product = {}, copy = '') {
  const settings = getUserSettings(userId);
  const token = settings.TELEGRAM_BOT_TOKEN || env('TELEGRAM_BOT_TOKEN');
  const chatId = settings.TELEGRAM_CHAT_ID || env('TELEGRAM_CHAT_ID');
  if (!token || !chatId) {
    const err = new Error('Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no painel de configurações da sua conta');
    err.status = 400;
    throw err;
  }
  const text = copy || makeCopy(product || {});
  if (product?.image) {
    await http.post(`https://api.telegram.org/bot${token}/sendPhoto`, { chat_id: chatId, photo: product.image, caption: text, parse_mode: 'HTML' });
  } else {
    await http.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text, disable_web_page_preview: false });
  }
  return { ok: true };
}


router.get('/settings/env', (req, res) => {
  try {
    const userValues = getUserSettings(req.user.id);
    const values = {};
    ENV_KEYS.forEach(key => { values[key] = userValues[key] ?? ''; });
    res.json({ ok: true, groups: ENV_GROUPS, values, storage: 'database-json-user-isolated' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/settings/env', (req, res) => {
  try {
    const incoming = req.body?.values || {};
    const clean = {};
    ENV_KEYS.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(incoming, key)) clean[key] = String(incoming[key] ?? '').trim();
    });
    const saved = saveUserSettings(req.user.id, clean);
    const values = {};
    ENV_KEYS.forEach(key => { values[key] = saved[key] ?? ''; });
    res.json({ ok: true, message: 'Configurações salvas somente na sua conta.', values });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/posts/history', (req, res) => {
  try {
    res.json({ ok: true, posts: listGeneratedPosts(req.user.id, req.query.limit || 50) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/platforms', (_req, res) => {
  const catalogEnabled = new Set(['mercadolivre']);
  res.json({ ok: true, platforms: Object.keys(providers).map(id => ({
    id,
    name: PLATFORM_NAMES[id] || id,
    catalog: catalogEnabled.has(id),
    manualLink: id !== 'mercadolivre'
  })) });
});

router.get('/catalog/:platform', async (req, res) => {
  const platform = String(req.params.platform || '').toLowerCase();
  const provider = providers[platform];
  if (!provider) return res.status(404).json({ ok: false, error: 'Plataforma não encontrada.' });
  if (platform !== 'mercadolivre') {
    return res.status(400).json({ ok: false, error: 'Catálogo automático desativado para esta plataforma. Use a opção de inserir link do produto para converter em afiliado e gerar o post.' });
  }
  try {
    const products = await provider.search({
      q: String(req.query.q || ''),
      limit: Number(req.query.limit || 80),
      pages: Number(req.query.pages || 1),
      onlyDiscount: String(req.query.onlyDiscount || '') === 'true'
    });
    res.json({ ok: true, platform, total: products.length, products });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});



router.post('/link-product/:platform', async (req, res) => {
  const platform = String(req.params.platform || '').toLowerCase();
  if (!providers[platform]) return res.status(404).json({ ok: false, error: 'Plataforma não encontrada.' });
  if (platform === 'mercadolivre') return res.status(400).json({ ok: false, error: 'No Mercado Livre use o catálogo original do projeto.' });
  try {
    const product = await productFromLink(platform, req.body?.url || req.body?.link || '');
    res.json({ ok: true, product });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/affiliate-link/:platform', async (req, res) => {
  const platform = String(req.params.platform || '').toLowerCase();
  if (!providers[platform]) return res.status(404).json({ ok: false, error: 'Plataforma não encontrada.' });
  try {
    const affiliateLink = await convertAffiliate(platform, req.body?.url || req.body?.link || '');
    res.json({ ok: true, affiliateLink });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/copy', (req, res) => {
  const product = req.body?.product || {};
  const copy = makeCopy(product);
  try { saveGeneratedPost(req.user.id, product, copy); } catch {}
  res.json({ ok: true, copy });
});

router.post('/telegram/send', async (req, res) => {
  const { product, copy } = req.body || {};
  try {
    await sendTelegramMessage(req.user.id, product || {}, copy || '');
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 500).json({ ok: false, error: err.response?.data?.description || err.message }); }
});

router.post('/whatsapp/send', async (req, res) => {
  const { product, copy } = req.body || {};
  try {
    const result = await sendWhatsAppMessage(req.user.id, product || {}, copy || '');
    res.json({ ok: true, ...result });
  } catch (err) { res.status(err.status || 500).json({ ok: false, error: err.message, details: err.details }); }
});

router.post('/queue/add', (req, res) => {
  try {
    const product = req.body?.product || {};
    const copy = req.body?.copy || makeCopy(product);
    const item = addQueueItem(req.user.id, product, copy);
    res.json({ ok: true, item });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/queue', (req, res) => {
  try { res.json({ ok: true, items: listQueueItems(req.user.id) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.delete('/queue/:id', (req, res) => {
  try { res.json({ ok: removeQueueItem(req.user.id, req.params.id) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/sent-products', (req, res) => {
  try { res.json({ ok: true, items: listSentProducts(req.user.id, req.query.limit || 100) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/queue/send-next', async (req, res) => {
  const channels = Array.isArray(req.body?.channels) && req.body.channels.length ? req.body.channels : ['telegram', 'whatsapp'];
  const item = listQueueItems(req.user.id)[0];
  if (!item) return res.json({ ok: true, empty: true, message: 'Fila vazia.' });
  const product = item.product || { title: item.title, price: item.price, image: item.image, link: item.link, platform: item.platform };
  const copy = item.copy || makeCopy(product);
  const result = {};
  try {
    if (channels.includes('telegram')) result.telegram = await sendTelegramMessage(req.user.id, product, copy);
    if (channels.includes('whatsapp')) result.whatsapp = await sendWhatsAppMessage(req.user.id, product, copy);
    const sent = markQueueItemSent(req.user.id, item.id, channels, result);
    res.json({ ok: true, item: sent, result });
  } catch (err) {
    incrementQueueAttempt(req.user.id, item.id, err.message);
    res.status(err.status || 500).json({ ok: false, error: err.message, item, result });
  }
});

router.post('/pinterest/send', async (req, res) => {
  const settings = getUserSettings(req.user.id);
  const token = settings.PINTEREST_ACCESS_TOKEN || env('PINTEREST_ACCESS_TOKEN');
  const boardId = settings.PINTEREST_BOARD_ID || env('PINTEREST_BOARD_ID');
  const sectionId = settings.PINTEREST_BOARD_SECTION_ID || env('PINTEREST_BOARD_SECTION_ID');
  const { product, copy } = req.body || {};
  if (!token || !boardId) return res.status(400).json({ ok: false, error: 'Configure PINTEREST_ACCESS_TOKEN e PINTEREST_BOARD_ID no painel de configurações da sua conta' });
  try {
    const payload = {
      board_id: boardId,
      title: String(product?.title || 'Oferta').slice(0, 100),
      description: String(copy || makeCopy(product || {})).slice(0, 800),
      link: product?.affiliateLink || product?.link,
      media_source: { source_type: 'image_url', url: product?.image }
    };
    if (sectionId) payload.board_section_id = sectionId;
    await http.post('https://api.pinterest.com/v5/pins', payload, { headers: { Authorization: `Bearer ${token}` } });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.response?.data || err.message }); }
});

module.exports = router;
