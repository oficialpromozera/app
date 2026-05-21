const express = require('express');
const fs = require('fs');
const path = require('path');
const { request } = require('playwright');
const cheerio = require('cheerio');

const router = express.Router();
const { getUserSettings, saveUserSettings } = require('../db');
const { env } = require('../userEnv');


const AUTH_FILE = path.join(__dirname, '../../.ml-auth.json');
const CONFIG_FILE = path.join(__dirname, '../../.panel-config.json');

function loadPanelConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function savePanelConfig(config = {}) {
  const allowed = [
    'ML_AFFILIATE_TAG',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'PINTEREST_ACCESS_TOKEN',
    'PINTEREST_BOARD_ID',
    'PINTEREST_BOARD_SECTION_ID'
  ];

  const clean = {};

  for (const key of allowed) {
    clean[key] = String(config[key] || '').trim();
  }

  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify(
      {
        ...clean,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    )
  );

  return clean;
}

function getConfigValue(key, fallback = '') {
  return String(env(key, fallback) || fallback || '').trim();
}

function loadAuth() {
  return {
    cookie: env('ML_COOKIE') || '',
    csrf: env('ML_CSRF_TOKEN') || env('ML_CSRF') || '',
    updatedAt: null
  };
}

function saveAuth(cookie = '', csrf = '') {
  fs.writeFileSync(
    AUTH_FILE,
    JSON.stringify(
      {
        cookie,
        csrf,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
}

function cleanText(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function improveImage(url = '') {
  return String(url || '')
    .replace('-I.jpg', '-O.jpg')
    .replace('-I.webp', '-O.webp')
    .replace('-I.png', '-O.png');
}

function buildAffiliateLink(link = '') {
  const tag = getConfigValue('ML_AFFILIATE_TAG') || '';

  if (!link || !tag) return link;

  try {
    const url = new URL(link, 'https://www.mercadolivre.com.br');
    url.searchParams.set('utm_source', tag);
    return url.toString();
  } catch {
    return link;
  }
}

function parseBRNumber(value = '') {
  const raw = String(value || '')
    .replace(/[^\d.,]/g, '')
    .trim();

  if (!raw) return null;

  let normalized = raw;

  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  } else if ((normalized.match(/\./g) || []).length > 1) {
    normalized = normalized.replace(/\./g, '');
  } else if (/^\d{1,3}\.\d{3}$/.test(normalized)) {
    normalized = normalized.replace(/\./g, '');
  }

  const number = Number(normalized);

  if (!Number.isFinite(number)) return null;
  if (number <= 0 || number > 100000) return null;

  return number;
}

function formatBRL(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 'Conferir no link';
  }

  return number.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function extractMoneyValues(text = '') {
  const clean = cleanText(text);
  const matches = [];
  const regex = /R\$\s?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{2}))?/gi;

  let match;

  while ((match = regex.exec(clean)) !== null) {
    const integer = match[1];
    const cents = match[2] || '00';
    const number = parseBRNumber(`${integer},${cents}`);

    if (!Number.isFinite(number)) continue;

    matches.push({
      text: formatBRL(number),
      number,
      index: match.index,
      raw: match[0]
    });
  }

  return matches;
}

function normalizeBRL(price = '') {
  const values = extractMoneyValues(price);
  if (!values.length) return 'Conferir no link';
  return values[0].text;
}

function isBlockedPricePath(pathList = []) {
  const pathText = pathList.join('.').toLowerCase();

  return Boolean(
    pathText.includes('installment') ||
    pathText.includes('installments') ||
    pathText.includes('parcel') ||
    pathText.includes('parcela') ||
    pathText.includes('payment') ||
    pathText.includes('payments') ||
    pathText.includes('coupon') ||
    pathText.includes('cupom') ||
    pathText.includes('label') ||
    pathText.includes('cashback') ||
    pathText.includes('voucher') ||
    pathText.includes('shipping') ||
    pathText.includes('frete') ||
    pathText.includes('discount_label') ||
    pathText.includes('rebate')
  );
}

function extractOfficialPriceComponent(value, pathList = [], depth = 0) {
  if (!value || depth > 14) return null;
  if (isBlockedPricePath(pathList)) return null;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = extractOfficialPriceComponent(value[i], [...pathList, String(i)], depth + 1);
      if (found) return found;
    }

    return null;
  }

  if (typeof value !== 'object') return null;

  if (
    value.id === 'price' &&
    value.type === 'price' &&
    value.price &&
    typeof value.price === 'object' &&
    Object.prototype.hasOwnProperty.call(value.price, 'value')
  ) {
    const price = Number(value.price.value);
    const oldPrice = Number(value.price.original_value);

    if (Number.isFinite(price) && price > 0 && price <= 100000) {
      return {
        price,
        oldPrice: Number.isFinite(oldPrice) ? oldPrice : null
      };
    }
  }

  if (
    value.type === 'price' &&
    Object.prototype.hasOwnProperty.call(value, 'value') &&
    !Object.prototype.hasOwnProperty.call(value, 'installments')
  ) {
    const price = Number(value.value);
    const oldPrice = Number(value.original_value);

    if (Number.isFinite(price) && price > 0 && price <= 100000) {
      return {
        price,
        oldPrice: Number.isFinite(oldPrice) ? oldPrice : null
      };
    }
  }

  for (const key of Object.keys(value)) {
    const keyLower = key.toLowerCase();

    if (
      keyLower.includes('installment') ||
      keyLower.includes('parcel') ||
      keyLower.includes('parcela') ||
      keyLower.includes('payment') ||
      keyLower.includes('payments') ||
      keyLower.includes('coupon') ||
      keyLower.includes('cupom') ||
      keyLower.includes('label') ||
      keyLower.includes('cashback') ||
      keyLower.includes('voucher') ||
      keyLower.includes('shipping') ||
      keyLower.includes('frete') ||
      keyLower.includes('discount_label') ||
      keyLower.includes('rebate')
    ) {
      continue;
    }

    const found = extractOfficialPriceComponent(value[key], [...pathList, key], depth + 1);
    if (found) return found;
  }

  return null;
}

function extractOfficialPriceFromHtmlText(html = '') {
  const source = String(html || '');

  const patterns = [
    /"id"\s*:\s*"price"[\s\S]{0,1800}?"type"\s*:\s*"price"[\s\S]{0,1800}?"price"\s*:\s*\{[\s\S]{0,800}?"type"\s*:\s*"price"[\s\S]{0,300}?"value"\s*:\s*(\d+(?:\.\d+)?)[\s\S]{0,500}?"original_value"\s*:\s*(\d+(?:\.\d+)?|null)/i,
    /"price"\s*:\s*\{[\s\S]{0,500}?"type"\s*:\s*"price"[\s\S]{0,300}?"value"\s*:\s*(\d+(?:\.\d+)?)[\s\S]{0,500}?"original_value"\s*:\s*(\d+(?:\.\d+)?|null)/i,
    /"price"\s*:\s*\{[\s\S]{0,500}?"value"\s*:\s*(\d+(?:\.\d+)?)[\s\S]{0,500}?"original_value"\s*:\s*(\d+(?:\.\d+)?|null)/i
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);

    if (!match) continue;

    const price = Number(match[1]);
    const oldPrice = match[2] === 'null' ? null : Number(match[2]);

    if (Number.isFinite(price) && price > 0 && price <= 100000) {
      return {
        price,
        oldPrice: Number.isFinite(oldPrice) ? oldPrice : null
      };
    }
  }

  return null;
}

function isCouponOrLabelMoney(text = '', value = {}) {
  const fullText = cleanText(text).toLowerCase();
  const index = Number(value.index || 0);
  const rawLength = String(value.raw || '').length;

  if (!Number.isFinite(index) || index < 0) return false;

  const around = fullText.slice(
    Math.max(0, index - 140),
    index + rawLength + 180
  );

  return Boolean(
    around.includes('aplicar') ||
    around.includes('cupom') ||
    around.includes('coupon') ||
    around.includes('label') ||
    around.includes('cashback') ||
    around.includes('voucher') ||
    around.includes('use o cupom') ||
    around.includes('desconto extra')
  );
}

function isInstallmentMoney(text = '', value = {}) {
  const fullText = cleanText(text).toLowerCase();
  const index = Number(value.index || 0);
  const rawLength = String(value.raw || '').length;

  if (!Number.isFinite(index) || index < 0) return false;

  const before = fullText.slice(Math.max(0, index - 80), index);
  const after = fullText.slice(index + rawLength, index + rawLength + 120);

  return Boolean(
    /\d+\s*x\s*$/.test(before) ||
    /em\s+\d+\s*x\s*$/.test(before) ||
    before.includes('parcela') ||
    before.includes('parcelas') ||
    before.includes('mensal') ||
    before.includes('ao mês') ||
    before.includes('por mês') ||
    after.includes('sem juros') ||
    after.includes('parcela') ||
    after.includes('parcelas') ||
    after.includes('mensal') ||
    after.includes('ao mês') ||
    after.includes('por mês')
  );
}

function priceResultFromOfficial(officialPrice = null) {
  if (!officialPrice) {
    return {
      price: 'Conferir no link',
      oldPrice: '',
      discount: ''
    };
  }

  const current = officialPrice.price;
  const old = officialPrice.oldPrice;

  return {
    price: formatBRL(current),
    oldPrice: Number.isFinite(old) && old > current ? formatBRL(old) : '',
    discount:
      Number.isFinite(old) && old > current
        ? `${Math.round(((old - current) / old) * 100)}%`
        : ''
  };
}

function extractPricesFromCard($, card) {
  const htmlCard = String($.html(card) || '');

  const officialFromHtml = extractOfficialPriceFromHtmlText(htmlCard);
  if (officialFromHtml) {
    return priceResultFromOfficial(officialFromHtml);
  }

  const textCard = cleanText(card.text());
  const moneyValues = extractMoneyValues(textCard);

  const currentPriceBox =
    card.find('.poly-price__current').first().text() ||
    card.find('.ui-search-price__second-line').first().text() ||
    card.find('.ui-pdp-price__second-line').first().text();

  let price = normalizeBRL(currentPriceBox);

  if (price === 'Conferir no link') {
    const safePrices = moneyValues.filter(value => {
      if (isCouponOrLabelMoney(textCard, value)) return false;
      if (isInstallmentMoney(textCard, value)) return false;

      const before = textCard.slice(Math.max(0, value.index - 50), value.index).toLowerCase();
      const after = textCard.slice(value.index, value.index + 90).toLowerCase();

      return !(
        before.includes('cupom') ||
        before.includes('aplicar') ||
        before.includes('cashback') ||
        before.includes('voucher') ||
        after.includes('cupom') ||
        after.includes('aplicar') ||
        after.includes('cashback') ||
        after.includes('voucher')
      );
    });

    if (safePrices.length) {
      price = safePrices[0].text;
    }
  }

  const oldPriceText =
    cleanText(card.find('.andes-money-amount--previous').first().text()) ||
    cleanText(card.find('.ui-search-price__part--previous').first().text()) ||
    cleanText(card.find('s').first().text()) ||
    cleanText(card.find('del').first().text()) ||
    cleanText(card.find('[aria-label*="antes"]').first().attr('aria-label')) ||
    cleanText(card.find('[aria-label*="Anterior"]').first().attr('aria-label'));

  let oldPrice = normalizeBRL(oldPriceText);
  if (oldPrice === 'Conferir no link') oldPrice = '';

  const currentNumber = parseBRNumber(price);

  if (!oldPrice && Number.isFinite(currentNumber)) {
    const bigger = moneyValues
      .filter(v =>
        v.number > currentNumber &&
        !isCouponOrLabelMoney(textCard, v) &&
        !isInstallmentMoney(textCard, v)
      )
      .sort((a, b) => a.number - b.number)[0];

    if (bigger) {
      oldPrice = bigger.text;
    }
  }

  let discount = '';

  const discountText =
    cleanText(card.find('[class*="discount"]').first().text()) ||
    textCard;

  const discountMatch =
    discountText.match(/(\d{1,2})\s?%\s*OFF/i) ||
    discountText.match(/(\d{1,2})\s?%\s*desconto/i);

  if (discountMatch) {
    discount = `${discountMatch[1]}%`;
  }

  const finalOldNumber = parseBRNumber(oldPrice);

  if (
    !discount &&
    Number.isFinite(finalOldNumber) &&
    Number.isFinite(currentNumber) &&
    finalOldNumber > currentNumber
  ) {
    discount = `${Math.round(((finalOldNumber - currentNumber) / finalOldNumber) * 100)}%`;
  }

  return {
    price,
    oldPrice,
    discount
  };
}

function formatPrice(price) {
  if (!price) return 'Conferir no link';

  if (typeof price === 'string') {
    if (price.includes('R$')) return normalizeBRL(price);

    const parsed = parseBRNumber(price);
    if (Number.isFinite(parsed)) return formatBRL(parsed);

    return price;
  }

  const number = Number(price);

  if (!Number.isFinite(number)) {
    return 'Conferir no link';
  }

  return formatBRL(number);
}

function normalizeSearchTerm(q = '') {
  return cleanText(q || 'ofertas') || 'ofertas';
}

function normalizeMlListUrl(url = '') {
  const text = String(url || '').trim();
  if (!text) return '';

  try {
    const parsed = new URL(text, text.startsWith('/') ? 'https://lista.mercadolivre.com.br' : undefined);

    if (!/mercadolivre\.com\.br$/i.test(parsed.hostname) && !/mercadolivre\.com\.br/i.test(parsed.hostname)) {
      return '';
    }

    return parsed.toString();
  } catch {
    try {
      return new URL(text, 'https://lista.mercadolivre.com.br').toString();
    } catch {
      return '';
    }
  }
}

function offsetToMlPage(offset = 0, pageSize = 48) {
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const safePageSize = Math.max(Number(pageSize) || 48, 1);
  return Math.floor(safeOffset / safePageSize) + 1;
}

function mlDesdeToOffset(desde = 1) {
  const n = Number(desde);
  return Number.isFinite(n) && n > 0 ? Math.max(n - 1, 0) : 0;
}

function mlPageToOffset(page = 1, pageSize = 48) {
  const p = Math.max(Number(page) || 1, 1);
  const size = Math.max(Number(pageSize) || 48, 1);
  return (p - 1) * size;
}

function searchVariants(q = '', offset = 0) {
  const term = normalizeSearchTerm(q);
  const dash = term.replace(/\s+/g, '-');
  const plus = term.replace(/\s+/g, '+');
  const encoded = encodeURIComponent(term);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const desde = safeOffset > 0 ? safeOffset + 1 : 0;

  if (safeOffset > 0) {
    return [
      `/${dash}_Desde_${desde}_NoIndex_True`,
      `/${encoded}_Desde_${desde}_NoIndex_True`,
      `/jm/search?as_word=${encoded}&offset=${safeOffset}`,
      `/jm/search?as_word=${plus}&offset=${safeOffset}`,
      `/search?q=${encoded}&offset=${safeOffset}`
    ];
  }

  return [
    `/${encoded}`,
    `/${dash}`,
    `/jm/search?as_word=${encoded}`,
    `/jm/search?as_word=${plus}`,
    `/search?q=${encoded}`
  ];
}

function extractJsonFromHtml(html = '') {
  const patterns = [
    /window\.__PRELOADED_STATE__\s*=\s*({[\s\S]+?});<\/script>/,
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]+?});<\/script>/,
    /"results"\s*:\s*(\[[\s\S]*?\])/
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (!match) continue;

    try {
      return JSON.parse(match[1]);
    } catch {}
  }

  return null;
}

function findProductsDeep(value, found = []) {
  if (!value || found.length >= 2000) return found;

  if (Array.isArray(value)) {
    for (const item of value) {
      findProductsDeep(item, found);
    }

    return found;
  }

  if (typeof value === 'object') {
    const title =
      value.title ||
      value.name ||
      value?.content?.title ||
      value?.item?.title ||
      value?.item?.name;

    const link =
      value.permalink ||
      value.url ||
      value.link ||
      value.target ||
      value?.item?.permalink ||
      value?.item?.url ||
      value?.action?.target;

    const officialPrice = extractOfficialPriceComponent(value);

    const price =
      officialPrice?.price ||
      value.price ||
      value.current_price ||
      value?.price?.amount ||
      value?.price?.value ||
      value?.prices?.price?.amount ||
      '';

    const oldPrice =
      officialPrice?.oldPrice ||
      value.original_price ||
      value.old_price ||
      value?.price?.original_amount ||
      value?.prices?.original_price?.amount ||
      value?.price?.regular_amount ||
      '';

    const image =
      value.thumbnail ||
      value.image ||
      value.picture ||
      value?.pictures?.[0]?.url ||
      value?.image?.url ||
      value?.pictures?.[0]?.secure_url ||
      value?.media?.url;

    if (title && link) {
      const currentNumber = Number(price);
      const oldNumber = Number(oldPrice);

      found.push({
        title,
        link,
        price,
        oldPrice: oldPrice ? formatPrice(oldPrice) : '',
        discount:
          oldNumber && currentNumber && oldNumber > currentNumber
            ? `${Math.round(((oldNumber - currentNumber) / oldNumber) * 100)}%`
            : '',
        image,
        freeShipping:
          Boolean(value?.shipping?.free_shipping) ||
          /frete grátis/i.test(JSON.stringify(value).slice(0, 1200))
      });
    }

    for (const key of Object.keys(value)) {
      const keyLower = key.toLowerCase();

      if (
        keyLower.includes('installment') ||
        keyLower.includes('parcel') ||
        keyLower.includes('parcela') ||
        keyLower.includes('coupon') ||
        keyLower.includes('cupom') ||
        keyLower.includes('label') ||
        keyLower.includes('cashback') ||
        keyLower.includes('voucher') ||
        keyLower.includes('payment') ||
        keyLower.includes('shipping') ||
        keyLower.includes('frete')
      ) {
        continue;
      }

      findProductsDeep(value[key], found);
    }
  }

  return found;
}


function extractPaginationInfoFromHtml(html = '', fallbackLimit = 80, fallbackOffset = 0) {
  const $ = cheerio.load(html || '');
  const pageNumbers = [];
  const offsets = [];
  const pagesByNumber = new Map();
  const pageSizeFromMl = 48;

  function pushNumber(value) {
    const n = Number(String(value || '').replace(/\D/g, ''));
    if (Number.isFinite(n) && n > 0 && n < 10000) pageNumbers.push(n);
    return n;
  }

  function getOffsetFromHref(href = '') {
    if (!href) return null;
    try {
      const url = new URL(href, 'https://lista.mercadolivre.com.br');
      const pageQuery = Number(url.searchParams.get('page'));
      if (Number.isFinite(pageQuery) && pageQuery > 0 && /\/ofertas/i.test(url.pathname)) {
        return mlPageToOffset(pageQuery, pageSizeFromMl);
      }

      const offsetQuery = Number(url.searchParams.get('offset'));
      if (Number.isFinite(offsetQuery) && offsetQuery >= 0) return offsetQuery;

      const fromMatch = decodeURIComponent(url.pathname + url.search).match(/_Desde_(\d+)/i);
      if (fromMatch) return mlDesdeToOffset(fromMatch[1]);
    } catch {}
    return null;
  }

  function pushOffsetFromHref(href = '') {
    const offset = getOffsetFromHref(href);
    if (offset !== null) offsets.push(offset);
    return offset;
  }

  function pushPage(page, href = '', label = '') {
    const n = Number(page);
    if (!Number.isFinite(n) || n <= 0 || n >= 10000) return;

    const url = normalizeMlListUrl(href);
    const previous = pagesByNumber.get(n) || {};
    pagesByNumber.set(n, {
      page: n,
      label: label || String(n),
      url: url || previous.url || '',
      offset: getOffsetFromHref(href) ?? previous.offset ?? ((n - 1) * pageSizeFromMl)
    });
    pageNumbers.push(n);
  }

  const paginationRoot = $('.andes-pagination, nav[aria-label*="agina" i], nav[aria-label*="page" i], [class*="pagination"]').first();
  const scope = paginationRoot.length ? paginationRoot : $.root();

  scope.find('a, button, li, span').each((_, el) => {
    const node = $(el);
    const text = cleanText(node.text());
    const href = node.attr('href') || node.find('a[href]').first().attr('href') || '';

    if (/^\d{1,4}$/.test(text)) {
      const page = pushNumber(text);
      pushPage(page, href, text);
    }

    pushOffsetFromHref(href);
  });

  const jsonText = html.slice(0, 250000);
  for (const match of jsonText.matchAll(/(?:page|pagina|current_page|total_pages)["']?\s*[:=]\s*["']?(\d{1,4})/gi)) {
    pushNumber(match[1]);
  }
  for (const match of jsonText.matchAll(/_Desde_(\d+)/gi)) {
    const fromValue = Number(match[1]);
    if (Number.isFinite(fromValue) && fromValue > 0) offsets.push(mlDesdeToOffset(fromValue));
  }
  for (const match of jsonText.matchAll(/[?&]offset=(\d+)/gi)) {
    const offsetValue = Number(match[1]);
    if (Number.isFinite(offsetValue) && offsetValue >= 0) offsets.push(offsetValue);
  }
  for (const match of jsonText.matchAll(/\/ofertas\?[^"'<>\s]*page=(\d+)/gi)) {
    const pageValue = Number(match[1]);
    if (Number.isFinite(pageValue) && pageValue > 0) offsets.push(mlPageToOffset(pageValue, pageSizeFromMl));
  }

  const currentText = cleanText($('.andes-pagination__button--current, .andes-pagination__button-current, [aria-current="page"]').first().text());
  const currentFromHtml = /^\d+$/.test(currentText) ? Number(currentText) : 0;
  const pageSize = pageSizeFromMl;
  const currentFromOffset = offsetToMlPage(fallbackOffset, pageSize);
  const currentPage = currentFromHtml || currentFromOffset || 1;

  let totalPages = pageNumbers.length ? Math.max(...pageNumbers) : 0;
  if (offsets.length) {
    const maxOffset = Math.max(...offsets);
    totalPages = Math.max(totalPages, offsetToMlPage(maxOffset, pageSize));
  }

  if (currentPage > 0) {
    pushPage(currentPage, '', String(currentPage));
  }

  const pages = [...pagesByNumber.values()]
    .filter(p => p.page > 0)
    .sort((a, b) => a.page - b.page);

  return {
    detected: totalPages > 0 || pages.length > 0,
    totalPages: Math.max(totalPages || 1, currentPage || 1),
    currentPage,
    pageSize,
    pages,
    hasPrevious: currentPage > 1,
    hasNext: totalPages ? currentPage < totalPages : false
  };
}

async function detectMercadoLivrePagination(source = '', q = '', limit = 80, offset = 0, mlCookie = '', mlCsrf = '', pageUrl = '') {
  const isOffers = source === 'ofertas';
  const baseURL = isOffers ? 'https://www.mercadolivre.com.br' : 'https://lista.mercadolivre.com.br';
  const context = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      ...(mlCookie ? { cookie: mlCookie } : {}),
      ...(mlCsrf ? { 'x-csrf-token': mlCsrf } : {}),
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      referer: 'https://www.mercadolivre.com.br/'
    }
  });

  try {
    const normalizedPageUrl = normalizeMlListUrl(pageUrl);
    const urls = normalizedPageUrl
      ? [normalizedPageUrl]
      : isOffers
        ? [`/ofertas${offset > 0 ? `?page=${offsetToMlPage(offset, 48)}` : ''}`, '/ofertas']
        : searchVariants(q || 'ofertas do dia mercado livre promoção desconto', offset);

    for (const url of [...new Set(urls)]) {
      const response = await context.get(url, { timeout: 20000 });
      const html = await response.text();
      if (!response.ok()) continue;
      if (
        html.includes('/gz/account-verification') ||
        html.includes('acesse sua conta') ||
        html.includes('Para continuar')
      ) {
        continue;
      }
      return extractPaginationInfoFromHtml(html, limit, offset);
    }
  } catch {}
  finally {
    await context.dispose();
  }

  return {
    detected: false,
    totalPages: 1,
    currentPage: Math.floor((Number(offset) || 0) / Math.max(Number(limit) || 80, 1)) + 1,
    pageSize: Math.max(Number(limit) || 80, 1),
    hasPrevious: offset > 0,
    hasNext: false
  };
}

function parseProductsFromHtml(html = '', limit = 120) {
  const $ = cheerio.load(html);
  const products = [];

  const selectors = [
    'li.ui-search-layout__item',
    '.poly-card',
    '.ui-search-result',
    '.ui-search-result__wrapper',
    'section.ui-search-results article',
    'ol.ui-search-layout li'
  ].join(',');

  $(selectors).each((_, el) => {
    if (products.length >= Math.max(limit * 6, 1200)) return false;

    const card = $(el);

    const title =
      cleanText(card.find('.poly-component__title').first().text()) ||
      cleanText(card.find('.ui-search-item__title').first().text()) ||
      cleanText(card.find('h2').first().text()) ||
      cleanText(card.find('a[title]').first().attr('title')) ||
      cleanText(card.find('a[href*="MLB"]').first().text()) ||
      cleanText(card.find('a').first().text());

    const link =
      card.find('a.poly-component__title').first().attr('href') ||
      card.find('a.ui-search-link').first().attr('href') ||
      card.find('a[href*="/p/"]').first().attr('href') ||
      card.find('a[href*="MLB"]').first().attr('href') ||
      card.find('a[href*="mercadolivre.com.br"]').first().attr('href') ||
      card.find('a').first().attr('href') ||
      '';

    const image =
      card.find('img[data-src]').first().attr('data-src') ||
      card.find('img[data-original]').first().attr('data-original') ||
      card.find('img').first().attr('src') ||
      '';

    const prices = extractPricesFromCard($, card);

    if (!title || !link) return;

    products.push({
      title,
      link,
      price: prices.price,
      oldPrice: prices.oldPrice,
      discount: prices.discount,
      image,
      freeShipping: /frete grátis/i.test(cleanText(card.text()))
    });
  });

  if (!products.length) {
    $('a[href*="mercadolivre.com.br"], a[href*="/MLB"], a[href*="/p/"]').each((_, a) => {
      if (products.length >= Math.max(limit * 6, 1200)) return false;

      const link = $(a).attr('href') || '';
      const card = $(a).closest('li, article, section, div');

      const title =
        cleanText($(a).text()) ||
        cleanText($(a).attr('title')) ||
        cleanText(card.find('h2').first().text()) ||
        cleanText(card.text()).slice(0, 120);

      const image =
        card.find('img[data-src]').first().attr('data-src') ||
        card.find('img[data-original]').first().attr('data-original') ||
        card.find('img').first().attr('src') ||
        '';

      const prices = extractPricesFromCard($, card);

      if (!title || !link) return;

      products.push({
        title,
        link,
        price: prices.price,
        oldPrice: prices.oldPrice,
        discount: prices.discount,
        image,
        freeShipping: /frete grátis/i.test(cleanText(card.text()))
      });
    });
  }

  return products;
}

function normalizeProducts(rawProducts = [], limit = 500) {
  const seen = new Set();
  const products = [];

  for (const p of rawProducts) {
    const title = cleanText(p.title);
    const rawLink = String(p.link || '');

    if (!title || !rawLink) continue;

    const titleLower = title.toLowerCase();

    if (titleLower.length < 8) continue;
    if (titleLower.includes('cookie')) continue;
    if (titleLower.includes('csrf')) continue;
    if (titleLower.includes('token')) continue;
    if (titleLower.includes('privacidade')) continue;
    if (titleLower.includes('login')) continue;
    if (titleLower.includes('conta')) continue;
    if (titleLower.includes('mercado livre')) continue;
    if (titleLower.includes('central de privacidade')) continue;

    let link = rawLink;

    try {
      const url = new URL(link, 'https://www.mercadolivre.com.br');
      url.hash = '';
      link = url.toString();
    } catch {}

    if (!link.includes('mercadolivre.com.br')) continue;

    const key = titleLower;

    if (seen.has(key)) continue;
    seen.add(key);

    const finalLink = link;

    products.push({
      platform: 'mercadolivre',
      id: '',
      title,
      price: formatPrice(p.price),
      oldPrice: p.oldPrice || '',
      discount: p.discount || '',
      image: improveImage(p.image),
      originalUrl: finalLink,
      originalLink: finalLink,
      rawLink: finalLink,
      link: finalLink,
      finalUrl: finalLink,
      url: finalLink,
      source: 'Mercado Livre',
      freeShipping: Boolean(p.freeShipping)
    });

    if (products.length >= limit) break;
  }

  return products;
}

function productNumberPrice(product = {}) {
  return parseBRNumber(product.price);
}

function productHasDiscount(product = {}) {
  const discountText = String(product.discount || '').trim();
  const oldNumber = parseBRNumber(product.oldPrice);
  const priceNumber = parseBRNumber(product.price);

  return Boolean(
    discountText ||
    (Number.isFinite(oldNumber) && Number.isFinite(priceNumber) && oldNumber > priceNumber)
  );
}

function applyCatalogOptions(products = [], options = {}) {
  let list = Array.isArray(products) ? [...products] : [];

  const priceMin = Number(options.priceMin);
  const priceMax = Number(options.priceMax);

  if (Number.isFinite(priceMin) && priceMin > 0) {
    list = list.filter(product => {
      const price = productNumberPrice(product);
      return Number.isFinite(price) && price >= priceMin;
    });
  }

  if (Number.isFinite(priceMax) && priceMax > 0) {
    list = list.filter(product => {
      const price = productNumberPrice(product);
      return Number.isFinite(price) && price <= priceMax;
    });
  }

  if (options.freeShipping) {
    list = list.filter(product => Boolean(product.freeShipping));
  }

  if (options.onlyDiscount) {
    list = list.filter(productHasDiscount);
  }

  if (options.sort === 'price_asc') {
    list.sort((a, b) => {
      const pa = productNumberPrice(a);
      const pb = productNumberPrice(b);
      return (Number.isFinite(pa) ? pa : Infinity) - (Number.isFinite(pb) ? pb : Infinity);
    });
  }

  if (options.sort === 'price_desc') {
    list.sort((a, b) => {
      const pa = productNumberPrice(a);
      const pb = productNumberPrice(b);
      return (Number.isFinite(pb) ? pb : -Infinity) - (Number.isFinite(pa) ? pa : -Infinity);
    });
  }

  return list;
}

async function fetchByApi(q, limit = 120, mlCookie = '', mlCsrf = '') {
  const context = await request.newContext({
    baseURL: 'https://api.mercadolibre.com',
    extraHTTPHeaders: {
      ...(mlCookie ? { cookie: mlCookie } : {}),
      ...(mlCsrf ? { 'x-csrf-token': mlCsrf } : {}),
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      accept: 'application/json',
      'accept-language': 'pt-BR,pt;q=0.9'
    }
  });

  try {
    const response = await context.get('/sites/MLB/search', {
      params: {
        q: normalizeSearchTerm(q),
        limit: Math.min(limit, 50)
      },
      timeout: 20000
    });

    if (!response.ok()) return [];

    const data = await response.json();

    return (data.results || []).map(item => ({
      title: item.title,
      link: item.permalink,
      price: item.price,
      oldPrice: item.original_price ? formatPrice(item.original_price) : '',
      discount:
        item.original_price && item.price && item.original_price > item.price
          ? `${Math.round(((item.original_price - item.price) / item.original_price) * 100)}%`
          : '',
      image: item.thumbnail,
      freeShipping: Boolean(item.shipping?.free_shipping)
    }));
  } catch {
    return [];
  } finally {
    await context.dispose();
  }
}

async function fetchOffersPage(limit = 120, page = 1, mlCookie = '', mlCsrf = '', lightning = false) {
  const context = await request.newContext({
    baseURL: 'https://www.mercadolivre.com.br',
    extraHTTPHeaders: {
      ...(mlCookie ? { cookie: mlCookie } : {}),
      ...(mlCsrf ? { 'x-csrf-token': mlCsrf } : {}),
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      referer: 'https://www.mercadolivre.com.br/'
    }
  });

  const urls = [];

  const safePage = Math.max(Number(page) || 1, 1);

  if (lightning) {
    const lightningBase = '/ofertas?promotion_type=lightning#filter_applied=promotion_type&filter_position=2&origin=qcat';
    if (safePage <= 1) {
      urls.push(lightningBase);
      urls.push('/ofertas?promotion_type=lightning');
    } else {
      urls.push(`/ofertas?promotion_type=lightning&page=${safePage}`);
      urls.push(`/ofertas?page=${safePage}&promotion_type=lightning`);
    }
  } else if (safePage <= 1) {
    urls.push('/ofertas');
  } else {
    urls.push(`/ofertas?page=${safePage}`);
  }

  urls.push(lightning ? '/ofertas?promotion_type=lightning' : '/ofertas');

  try {
    for (const url of [...new Set(urls)]) {
      const response = await context.get(url, { timeout: 30000 });
      const html = await response.text();

      if (!response.ok()) continue;

      if (
        html.includes('/gz/account-verification') ||
        html.includes('acesse sua conta') ||
        html.includes('Para continuar')
      ) {
        continue;
      }

      const json = extractJsonFromHtml(html);
      let rawProducts = json ? findProductsDeep(json) : [];

      if (!rawProducts.length) {
        rawProducts = parseProductsFromHtml(html, limit + 30);
      }

      if (rawProducts.length) {
        return rawProducts;
      }
    }

    return [];
  } finally {
    await context.dispose();
  }
}

async function buscarOfertasMercadoLivre(limit = 120, page = 1, mlCookie = '', mlCsrf = '', lightning = false) {
  const fetchLimit = Math.min(Math.max(limit + 80, limit), 500);
  const rawProducts = await fetchOffersPage(fetchLimit, page, mlCookie, mlCsrf, lightning);
  return normalizeProducts(rawProducts, fetchLimit).map(product => lightning ? { ...product, lightning: true, source: 'Promoção relâmpago ML' } : product);
}

async function fetchByHtml(q, limit = 120, mlCookie = '', mlCsrf = '', offset = 0, pageUrl = '') {
  const context = await request.newContext({
    baseURL: 'https://lista.mercadolivre.com.br',
    extraHTTPHeaders: {
      ...(mlCookie ? { cookie: mlCookie } : {}),
      ...(mlCsrf ? { 'x-csrf-token': mlCsrf } : {}),
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      referer: 'https://www.mercadolivre.com.br/'
    }
  });

  try {
    const normalizedPageUrl = normalizeMlListUrl(pageUrl);
    const urls = normalizedPageUrl ? [normalizedPageUrl] : searchVariants(q, offset);

    for (const url of urls) {
      const response = await context.get(url, {
        timeout: 30000
      });

      const html = await response.text();

      if (!response.ok()) continue;

      if (
        html.includes('/gz/account-verification') ||
        html.includes('acesse sua conta') ||
        html.includes('Para continuar')
      ) {
        continue;
      }

      const json = extractJsonFromHtml(html);
      let rawProducts = json ? findProductsDeep(json) : [];

      if (!rawProducts.length) {
        rawProducts = parseProductsFromHtml(html, limit);
      }

      if (rawProducts.length) {
        return rawProducts;
      }
    }

    return [];
  } finally {
    await context.dispose();
  }
}

function extractAffiliateLink(data = {}) {
  return (
    data.affiliateLink ||
    data.affiliateUrl ||
    data.shortUrl ||
    data.short_url ||
    data.url ||
    data.link ||
    data.data?.affiliateLink ||
    data.data?.affiliateUrl ||
    data.data?.shortUrl ||
    data.data?.short_url ||
    data.data?.url ||
    data.data?.link ||
    data.result?.link ||
    data.result?.url ||
    ''
  );
}

function extractMlItemIdFromUrl(url = '') {
  const text = decodeURIComponent(String(url || ''));

  const patterns = [
    /item_id[:=](MLB\d+)/i,
    /\/(MLB\d{8,})/i,
    /[?&]id=(MLB\d+)/i,
    /[?&]item_id=(MLB\d+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return '';
}

function cleanMercadoLivreProductUrl(url = '') {
  const text = String(url || '').trim();

  try {
    const parsed = new URL(text, 'https://www.mercadolivre.com.br');
    parsed.hash = '';

    const allowedParams = ['pdp_filters'];
    for (const key of [...parsed.searchParams.keys()]) {
      if (!allowedParams.includes(key)) {
        parsed.searchParams.delete(key);
      }
    }

    return parsed.toString();
  } catch {
    return text;
  }
}

async function resolveClick1Url(originalUrl = '', context) {
  let url = String(originalUrl || '').trim();

  if (!url) {
    throw new Error('URL original não informada.');
  }

  const isClick1 =
    url.includes('click1.mercadolivre.com.br') ||
    url.includes('/mclics/clicks/external/MLB/count');

  if (!isClick1) {
    return cleanMercadoLivreProductUrl(url);
  }

  console.log('Resolvendo link click1 ML:', url);

  try {
    const response = await context.get(url, {
      timeout: 30000,
      maxRedirects: 10
    });

    const finalUrl =
      typeof response.url === 'function'
        ? response.url()
        : '';

    if (
      finalUrl &&
      finalUrl.includes('mercadolivre.com.br') &&
      !finalUrl.includes('click1.mercadolivre.com.br')
    ) {
      const cleanUrl = cleanMercadoLivreProductUrl(finalUrl);
      console.log('Link click1 resolvido por redirect:', cleanUrl);
      return cleanUrl;
    }
  } catch (err) {
    console.log('Falha ao resolver click1 por redirect:', err.message);
  }

  const itemId = extractMlItemIdFromUrl(url);

  if (!itemId) {
    throw new Error('Não consegui extrair o item_id do link click1 do Mercado Livre.');
  }

  const apiResponse = await context.get(`https://api.mercadolibre.com/items/${itemId}`, {
    timeout: 20000
  });

  if (!apiResponse.ok()) {
    throw new Error(`Não consegui buscar o permalink do item ${itemId}.`);
  }

  const item = await apiResponse.json();

  if (!item.permalink) {
    throw new Error(`O Mercado Livre não retornou permalink para o item ${itemId}.`);
  }

  const cleanUrl = cleanMercadoLivreProductUrl(item.permalink);

  console.log('Link click1 resolvido por item_id:', cleanUrl);

  return cleanUrl;
}

async function createAffiliateLink(originalUrl = '', mlCookie = '', mlCsrf = '', affiliateTagParam = '') {
  if (!originalUrl) {
    throw new Error('URL original não informada.');
  }

  if (!mlCookie) {
    throw new Error('Cookie do Mercado Livre não informado.');
  }

  const affiliateTag = String(affiliateTagParam || getConfigValue('ML_AFFILIATE_TAG') || '').trim();

  if (!affiliateTag) {
    throw new Error('ML_AFFILIATE_TAG não configurada. Abra Configurar Mercado Livre e informe sua tag.');
  }

  const context = await request.newContext({
    extraHTTPHeaders: {
      cookie: mlCookie,
      ...(mlCsrf ? { 'x-csrf-token': mlCsrf } : {}),
      'content-type': 'application/json',
      accept: 'application/json, text/plain, */*',
      origin: 'https://www.mercadolivre.com.br',
      referer: 'https://www.mercadolivre.com.br/affiliate-program',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    }
  });

  try {
    const finalOriginalUrl = await resolveClick1Url(originalUrl, context);

    console.log('URL enviada para createLink ML:', finalOriginalUrl);

    const response = await context.post(
      'https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink',
      {
        data: {
          urls: [finalOriginalUrl],
          tag: affiliateTag
        },
        timeout: 30000
      }
    );

    const text = await response.text();

    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    console.log('Resposta createLink ML:', data);

    if (!response.ok()) {
      throw new Error(
        data.message ||
        data.error ||
        data.raw ||
        `Mercado Livre retornou ${response.status()} ao criar link afiliado.`
      );
    }

    const firstUrl = data.urls?.[0] || {};

    if (firstUrl.error_code || firstUrl.message) {
      throw new Error(firstUrl.message || 'URL recusada pelo programa de afiliados.');
    }

    const affiliateLink =
      firstUrl.short_url ||
      firstUrl.shortUrl ||
      firstUrl.url ||
      firstUrl.affiliate_url ||
      firstUrl.affiliateUrl ||
      data.links?.[0]?.short_url ||
      data.links?.[0]?.url ||
      data.data?.urls?.[0]?.short_url ||
      data.data?.urls?.[0]?.url ||
      data.data?.links?.[0]?.short_url ||
      data.data?.links?.[0]?.url ||
      data.short_url ||
      data.url ||
      data.link ||
      '';

    if (!affiliateLink) {
      throw new Error('Link afiliado não encontrado na resposta do Mercado Livre.');
    }

    return affiliateLink;
  } finally {
    await context.dispose();
  }
}

async function buscarMercadoLivre(q, limit = 120, mlCookie = '', mlCsrf = '', offset = 0, pageUrl = '') {
  const term = normalizeSearchTerm(q);

  let rawProducts = await fetchByHtml(term, limit, mlCookie, mlCsrf, offset, pageUrl);

  // O fallback por API não respeita a paginação visual do Mercado Livre.
  // Por isso ele só é usado na primeira página, evitando que página 2+ mostre
  // resultados fora da pesquisa atual ou repita a página inicial.
  if (!rawProducts.length && !offset && !pageUrl) {
    rawProducts = await fetchByApi(term, limit, mlCookie, mlCsrf);
  }

  return normalizeProducts(rawProducts, limit);
}

router.get('/config', (req, res) => {
  const settings = getUserSettings(req.user.id);
  res.json({
    ok: true,
    config: {
      ML_AFFILIATE_TAG: settings.ML_AFFILIATE_TAG || '',
      TELEGRAM_BOT_TOKEN: settings.TELEGRAM_BOT_TOKEN || '',
      TELEGRAM_CHAT_ID: settings.TELEGRAM_CHAT_ID || ''
    },
    updatedAt: null
  });
});

router.post('/config', express.json({ limit: '1mb' }), (req, res) => {
  const body = req.body || {};
  const saved = saveUserSettings(req.user.id, {
    ML_AFFILIATE_TAG: body.ML_AFFILIATE_TAG || '',
    TELEGRAM_BOT_TOKEN: body.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_CHAT_ID: body.TELEGRAM_CHAT_ID || ''
  });
  res.json({ ok: true, message: 'Configurações salvas na sua conta.', config: saved });
});

router.get('/mercadolivre/auth', (req, res) => {
  const settings = getUserSettings(req.user.id);
  res.json({
    ok: true,
    cookie: settings.ML_COOKIE || '',
    csrf: settings.ML_CSRF_TOKEN || '',
    updatedAt: null
  });
});

router.post('/mercadolivre/auth', express.json({ limit: '5mb' }), (req, res) => {
  const cookie = String(req.body.cookie || '').trim();
  const csrf = String(req.body.csrf || '').trim();
  if (!cookie) return res.status(400).json({ ok: false, error: 'Cookie não informado.' });
  saveUserSettings(req.user.id, { ML_COOKIE: cookie, ML_CSRF_TOKEN: csrf });
  res.json({ ok: true, message: 'Cookie e CSRF salvos na sua conta.' });
});

router.post('/mercadolivre/converter-link', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const auth = loadAuth();

    const originalUrl = String(req.body.url || '').trim();

    const mlCookie =
      String(req.body.cookie || '').trim() ||
      String(req.headers['x-ml-cookie'] || '').trim() ||
      auth.cookie ||
      '';

    const mlCsrf =
      String(req.body.csrf || '').trim() ||
      String(req.headers['x-ml-csrf'] || '').trim() ||
      auth.csrf ||
      '';

    const settings = getUserSettings(req.user.id);

const affiliateTag =
  String(req.body.affiliateTag || '').trim() ||
  String(settings.ML_AFFILIATE_TAG || '').trim() ||
  getConfigValue('ML_AFFILIATE_TAG');

const affiliateLink = await createAffiliateLink(originalUrl, mlCookie, mlCsrf, affiliateTag);

    res.json({
      ok: true,
      affiliateLink
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || 'Erro ao converter link afiliado.'
    });
  }
});

router.get('/mercadolivre/catalogo', async (req, res) => {
  try {
    const source = String(req.query.source || '').toLowerCase();
    const isOffersSource = source === 'ofertas' || source === 'relampago' || source === 'lightning';
    const isLightningSource = source === 'relampago' || source === 'lightning';
    const q = isOffersSource
      ? (isLightningSource ? 'https://www.mercadolivre.com.br/ofertas?promotion_type=lightning' : 'https://www.mercadolivre.com.br/ofertas')
      : normalizeSearchTerm(req.query.q || 'ofertas do dia mercado livre promoção desconto');
    const limit = Math.min(Math.max(Number(req.query.limit || 120), 1), 500);
    const mlPageSize = 48;
    const requestedPage = Math.max(Number(req.query.page || 1), 1);
    const pageUrl = normalizeMlListUrl(req.query.pageUrl || '');
    // Busca normal do Mercado Livre usa _Desde_49, _Desde_97...
    // A página /ofertas usa ?page=2, ?page=3...
    const offset = isOffersSource
      ? mlPageToOffset(requestedPage, mlPageSize)
      : (req.query.page
        ? mlPageToOffset(requestedPage, mlPageSize)
        : Math.max(Number(req.query.offset || 0), 0));
    const sort = String(req.query.sort || 'relevance');
    const priceMin = req.query.priceMin;
    const priceMax = req.query.priceMax;
    const freeShipping = String(req.query.freeShipping || '').toLowerCase() === 'true';
    const onlyDiscount = String(req.query.onlyDiscount || '').toLowerCase() === 'true';

    const auth = loadAuth();

    const mlCookie =
      String(req.headers['x-ml-cookie'] || '').trim() ||
      auth.cookie ||
      '';

    const mlCsrf =
      String(req.headers['x-ml-csrf'] || '').trim() ||
      auth.csrf ||
      '';

    const fetchLimit = Math.min(Math.max(limit + 80, limit), 500);
    const rawProducts = isOffersSource
      ? await buscarOfertasMercadoLivre(fetchLimit, requestedPage, mlCookie, mlCsrf, isLightningSource)
      : await buscarMercadoLivre(q, fetchLimit, mlCookie, mlCsrf, offset, pageUrl);

    const filteredProducts = applyCatalogOptions(rawProducts, {
      sort,
      priceMin,
      priceMax,
      freeShipping,
      onlyDiscount
    });

    const products = filteredProducts.slice(0, limit);
    const pagination = await detectMercadoLivrePagination(isOffersSource ? 'ofertas' : source, q, limit, offset, mlCookie, mlCsrf, pageUrl);

    res.json({
      ok: true,
      query: q,
      source: isLightningSource ? 'https://www.mercadolivre.com.br/ofertas?promotion_type=lightning' : (isOffersSource ? 'https://www.mercadolivre.com.br/ofertas' : 'busca'),
      total: filteredProducts.length,
      offset,
      limit,
      pagination,
      products
    });

  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || 'Erro ao buscar catálogo.'
    });
  }
});

router.post('/telegram/enviar', express.json({ limit: '5mb' }), async (req, res) => {
  try {
    const product = req.body.product || {};
    const post = String(req.body.post || '').trim();

    const token = getConfigValue('TELEGRAM_BOT_TOKEN');
    const chatId = getConfigValue('TELEGRAM_CHAT_ID');

    if (!token) throw new Error('TELEGRAM_BOT_TOKEN não configurado no .env');
    if (!chatId) throw new Error('TELEGRAM_CHAT_ID não configurado no .env');
    if (!post) throw new Error('Copy vazia.');
    if (!product.image) throw new Error('Produto sem imagem.');

    const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8'
      },
      body: JSON.stringify({
        chat_id: chatId,
        photo: product.image,
        caption: post
      })
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.description || 'Telegram recusou o envio.');
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

module.exports = router;