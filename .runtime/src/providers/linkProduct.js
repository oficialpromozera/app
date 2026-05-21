const { env } = require('../userEnv');
const { chromium } = require('playwright');
const cheerio = require('cheerio');
const crypto = require('crypto');
const { http, getText } = require('../lib/http');
const { normalizeProduct, moneyBR, toNumberBR, absoluteUrl } = require('../lib/format');
const { productFromShopeeUrl, affiliateFromShopeeUrl, extractShopeeIds: extractShopeeIdsOfficial } = require('./shopeeOfficial');

function cleanUrl(input = '') {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try { return new URL(raw).toString(); } catch { return raw; }
}

function meta($, name) {
  return $(`meta[property="${name}"]`).attr('content') || $(`meta[name="${name}"]`).attr('content') || '';
}

function jsonLdProducts($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of arr) {
        if (item?.['@graph']) out.push(...item['@graph']);
        out.push(item);
      }
    } catch {}
  });
  return out.filter(x => String(x?.['@type'] || '').toLowerCase().includes('product'));
}

function pickPriceFromJsonLd(product) {
  const offers = Array.isArray(product?.offers) ? product.offers[0] : product?.offers;
  return offers?.price || offers?.lowPrice || offers?.highPrice || '';
}

function shopeePrice(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' && /R\$/.test(value)) return moneyBR(value);
  const n = Number(String(value).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return '';
  // Shopee BR geralmente devolve preço em micros: 52990000 = R$ 529,90
  if (n >= 100000) return moneyBR(n / 100000);
  if (n >= 10000) return moneyBR(n / 100);
  return moneyBR(n);
}

function shopeeImage(code = '') {
  const img = String(code || '').trim();
  if (!img) return '';
  if (/^https?:\/\//i.test(img)) return img;
  return `https://cf.shopee.com.br/file/${img}`;
}


function shopeeHeaders(finalUrl = '', asJson = true) {
  const headers = {
    accept: asJson ? 'application/json,text/plain,*/*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    referer: finalUrl || 'https://shopee.com.br/',
    origin: 'https://shopee.com.br',
    'user-agent': env('SHOPEE_USER_AGENT') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'x-api-source': 'pc',
    'x-requested-with': 'XMLHttpRequest',
    'x-shopee-language': 'pt-BR',
    'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
  };
  if (asJson) headers['content-type'] = 'application/json';

  const cookie = env('SHOPEE_COOKIE') || '';
  const csrf = env('SHOPEE_CSRF_TOKEN') || env('SHOPEE_CSRF') || '';
  const afDat = env('SHOPEE_AF_AC_ENC_DAT') || env('SHOPEE_AF_DAT') || '';
  const afToken = env('SHOPEE_AF_AC_ENC_SZ_TOKEN') || env('SHOPEE_AF_TOKEN') || '';
  const xSapRi = env('SHOPEE_X_SAP_RI') || '';
  const xSapSec = env('SHOPEE_X_SAP_SEC') || '';
  const dNonptcha = env('SHOPEE_D_NONPTCHA_SYNC') || '';
  const sdkVersion = env('SHOPEE_X_SZ_SDK_VERSION') || '';

  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrftoken'] = csrf;
  if (afDat) headers['af-ac-enc-dat'] = afDat;
  if (afToken) headers['af-ac-enc-sz-token'] = afToken;
  if (xSapRi) headers['x-sap-ri'] = xSapRi;
  if (xSapSec) headers['x-sap-sec'] = xSapSec;
  if (dNonptcha) headers['d-nonptcha-sync'] = dNonptcha;
  if (sdkVersion) headers['x-sz-sdk-version'] = sdkVersion;

  return headers;
}

function pickShopee(obj, keys = []) {
  for (const key of keys) {
    const parts = key.split('.');
    let cur = obj;
    for (const part of parts) cur = cur?.[part];
    if (cur !== undefined && cur !== null && cur !== '') return cur;
  }
  return '';
}

function extractShopeeIds(inputUrl = '') {
  const raw = String(inputUrl || '').trim();
  const decoded = (() => { try { return decodeURIComponent(raw); } catch { return raw; } })();
  const patterns = [
    /[?&]shopid=(\d+).*?[?&]itemid=(\d+)/i,
    /[?&]itemid=(\d+).*?[?&]shopid=(\d+)/i,
    /(?:^|[\/.-])i\.(\d+)\.(\d+)(?:[/?#]|$)/i,
    /product\/(\d+)\/(\d+)/i,
    /shop\/(\d+)\/product\/(\d+)/i,
    /-(\d+)\.(\d+)(?:[/?#]|$)/i
  ];
  for (const re of patterns) {
    const m = decoded.match(re);
    if (!m) continue;
    if (re.source.includes('itemid=(\\d+).*?')) return { shopid: m[2], itemid: m[1] };
    return { shopid: m[1], itemid: m[2] };
  }
  return { shopid: '', itemid: '' };
}

async function resolveFinalUrl(url) {
  try {
    const res = await http.get(url, {
      maxRedirects: 8,
      timeout: 18000,
      validateStatus: s => s >= 200 && s < 500,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'upgrade-insecure-requests': '1'
      }
    });
    return res?.request?.res?.responseUrl || url;
  } catch {
    return url;
  }
}

function normalizeShopeeApiItem(payload, finalUrl, ids, source) {
  const root = payload?.data || payload || {};
  const item = root?.item || root?.item_info || root?.item_basic || root || {};
  const priceBox = root?.product_price || item?.product_price || {};
  const productImages = root?.product_images || item?.product_images || {};
  const images = Array.isArray(productImages?.images) ? productImages.images : [];

  const title = item?.title || item?.name || root?.title || root?.name || 'Produto Shopee';
  // Prioridade correta para Shopee BR:
  // 1) price_breakdown.price.single_value = preço final/Pix/cupom quando aparece no F12
  // 2) exclusive/final price
  // 3) product_price.price.single_value = preço principal
  // 4) campos antigos de item/model
  // Nunca usa parcela/installment como preço principal.
  const priceRaw =
    root?.price_breakdown?.price?.single_value ||
    root?.exclusive_price?.price?.single_value ||
    root?.exclusive_price?.price ||
    priceBox?.final_price_info?.price?.single_value ||
    priceBox?.final_price_info?.price ||
    priceBox?.price?.single_value ||
    item?.price ||
    item?.price_min ||
    item?.models?.[0]?.price ||
    root?.price ||
    root?.price_min;

  const oldRaw =
    root?.price_breakdown?.price_before_discount?.single_value ||
    priceBox?.price_before_discount?.single_value ||
    item?.price_before_discount ||
    item?.price_min_before_discount ||
    item?.models?.[0]?.price_before_discount ||
    root?.price_before_discount;

  const imageRaw = images[0] || item?.image || item?.images?.[0] || root?.image || root?.images?.[0] || '';
  const price = shopeePrice(priceRaw);
  const oldPrice = shopeePrice(oldRaw);

  return {
    title,
    price,
    priceNumber: toNumberBR(price),
    oldPrice,
    oldPriceNumber: toNumberBR(oldPrice),
    image: shopeeImage(imageRaw),
    sold: root?.product_review?.sold_count_display || root?.product_review?.historical_sold_display || item?.historical_sold || item?.sold || '',
    rating: root?.product_review?.rating_star || item?.item_rating?.rating_star || item?.rating_star || '',
    link: finalUrl,
    source,
    raw: { shopid: ids.shopid, itemid: ids.itemid, modelid: ids.modelid || '' }
  };
}

function extractShopeePdpParams(inputUrl = '') {
  const ids = extractShopeeIds(inputUrl);
  try {
    const u = new URL(inputUrl);
    ids.modelid = u.searchParams.get('display_model_id') || '';
    ids.modelSelectionLogic = u.searchParams.get('model_selection_logic') || '';
    const extra = u.searchParams.get('extraParams');
    if (extra) {
      const parsed = JSON.parse(decodeURIComponent(extra));
      ids.modelid = ids.modelid || String(parsed.display_model_id || '');
      ids.modelSelectionLogic = ids.modelSelectionLogic || String(parsed.model_selection_logic || '');
    }
  } catch {}
  return ids;
}

async function shopeePublicProductApi(finalUrl, ids) {
  const headers = shopeeHeaders(finalUrl, true);
  const shop = encodeURIComponent(ids.shopid);
  const item = encodeURIComponent(ids.itemid);
  const params = new URLSearchParams({
    shop_id: ids.shopid,
    item_id: ids.itemid,
    tz_offset_in_minutes: '-180',
    detail_level: '0',
    incoming_pdp_page_source: '0',
    incoming_pdp_page_scenario: '0'
  });
  if (ids.modelid) params.set('display_model_id', ids.modelid);
  if (ids.modelSelectionLogic) params.set('model_selection_logic', ids.modelSelectionLogic);

  const urls = [
    `https://shopee.com.br/api/v4/pdp/get_pc?${params.toString()}`,
    `https://shopee.com.br/api/v4/item/get?shopid=${shop}&itemid=${item}`
  ];

  for (const apiUrl of urls) {
    try {
      const { data } = await http.get(apiUrl, { timeout: 22000, headers, validateStatus: s => s >= 200 && s < 500 });
      if (data?.error || data?.error_msg) console.log('[Shopee produto API pública]', data.error || data.error_msg);
      const product = normalizeShopeeApiItem(data, finalUrl, ids, apiUrl.includes('pdp/get_pc') ? 'shopee-api-pdp-get-pc' : 'shopee-api-v4-item-get');
      if (product && (product.title !== 'Produto Shopee' || product.image || product.price)) return product;
    } catch (err) {
      console.log('[Shopee produto API pública]', err.response?.data || err.message);
    }
  }
  return null;
}

function extractShopeeInitialState(html = '') {
  const candidates = [];
  const regexes = [
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*<\/script>/i,
    /window\.__PAGESTATE__\s*=\s*({[\s\S]*?});?\s*<\/script>/i
  ];
  for (const re of regexes) {
    const m = html.match(re);
    if (m) candidates.push(m[1]);
  }
  for (const raw of candidates) {
    try { return JSON.parse(raw); } catch {}
  }
  return null;
}

function deepFindProductLike(obj, depth = 0) {
  if (!obj || depth > 8) return null;
  if (Array.isArray(obj)) {
    for (const x of obj) { const r = deepFindProductLike(x, depth + 1); if (r) return r; }
    return null;
  }
  if (typeof obj === 'object') {
    const hasName = obj.name || obj.title || obj.productName;
    const hasPrice = obj.price || obj.price_min || obj.priceMin || obj.price_info;
    const hasImage = obj.image || obj.imageUrl || obj.images;
    if (hasName && (hasPrice || hasImage)) return obj;
    for (const v of Object.values(obj)) { const r = deepFindProductLike(v, depth + 1); if (r) return r; }
  }
  return null;
}

async function shopeeHtmlEmbeddedData(finalUrl, ids) {
  try {
    const html = await getText(finalUrl, {
      timeout: 18000,
      headers: shopeeHeaders(finalUrl, false)
    });
    const state = extractShopeeInitialState(html);
    const found = deepFindProductLike(state);
    if (!found) return null;
    return normalizeShopeeApiItem(found, finalUrl, ids, 'shopee-page-json');
  } catch (err) {
    console.log('[Shopee dados página]', err.message);
    return null;
  }
}

function normalizeShopeeAffiliateProduct(node, finalUrl, ids) {
  if (!node) return null;
  const title = node.productName || node.itemName || node.name || node.title || 'Produto Shopee';
  const image = node.imageUrl || node.image_url || node.image || node.cover || '';
  const priceValue = node.price || node.salePrice || node.priceMin || node.minPrice || node.price_info?.price;
  const oldValue = node.priceBeforeDiscount || node.originalPrice || node.priceBefore || node.price_info?.price_before_discount || '';
  const productLink = node.productLink || node.itemLink || node.link || node.url || finalUrl;
  const offerLink = node.offerLink || node.shortLink || node.affiliateLink || node.affiliate_link || '';
  return {
    title,
    price: shopeePrice(priceValue),
    priceNumber: toNumberBR(shopeePrice(priceValue)),
    oldPrice: shopeePrice(oldValue),
    oldPriceNumber: toNumberBR(shopeePrice(oldValue)),
    image: shopeeImage(image),
    sold: node.sales || node.sold || node.historicalSold || '',
    rating: node.ratingStar || node.rating || '',
    link: productLink || finalUrl,
    affiliateLink: offerLink || '',
    source: 'shopee-affiliate-api',
    raw: { shopid: ids.shopid, itemid: ids.itemid }
  };
}

function extractOfferNodes(data) {
  const roots = [
    data?.data?.productOfferV2,
    data?.data?.productOffer,
    data?.data?.searchProduct,
    data?.data,
    data
  ].filter(Boolean);
  const nodes = [];
  const walk = (x) => {
    if (!x) return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (typeof x !== 'object') return;
    if (x.productName || x.itemName || x.itemId || x.productLink || x.offerLink) nodes.push(x);
    for (const key of ['nodes', 'items', 'list', 'products', 'edges']) walk(x[key]);
    if (x.node) walk(x.node);
  };
  roots.forEach(walk);
  return nodes;
}

async function shopeeAffiliateProductApi(finalUrl, ids) {
  const appId = env('SHOPEE_APP_ID') || env('SHOPEE_PARTNER_ID') || '';
  const secret = env('SHOPEE_SECRET') || '';
  const apiUrl = env('SHOPEE_API_URL') || 'https://open-api.affiliate.shopee.com.br/graphql';
  if (!appId || !secret || !apiUrl) return null;

  const itemId = String(ids.itemid || '');
  const queries = [
    {
      query: `query ProductOfferByKeyword($keyword: String!, $limit: Int!, $page: Int!) { productOfferV2(keyword: $keyword, limit: $limit, page: $page) { nodes { itemId productName itemName productLink offerLink imageUrl price sales shopName commissionRate } } }`,
      variables: { keyword: itemId, limit: 10, page: 1 }
    },
    {
      query: `query ProductOfferByUrl($keyword: String!, $limit: Int!, $page: Int!) { productOfferV2(keyword: $keyword, limit: $limit, page: $page) { nodes { itemId productName itemName productLink offerLink imageUrl price sales shopName commissionRate } } }`,
      variables: { keyword: finalUrl, limit: 10, page: 1 }
    },
    {
      query: `query { productOfferV2(keyword: "${itemId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}", limit: 10, page: 1) { nodes { itemId productName itemName productLink offerLink imageUrl price sales shopName commissionRate } } }`
    }
  ];

  for (const payload of queries) {
    const auth = shopeeAuthHeaders(payload);
    for (const signature of auth.candidates) {
      try {
        const { data } = await http.post(apiUrl, auth.body, {
          timeout: 20000,
          headers: {
            'content-type': 'application/json',
            authorization: `SHA256 Credential=${auth.appId}, Timestamp=${auth.timestamp}, Signature=${signature}`
          }
        });
        const nodes = extractOfferNodes(data);
        const exact = nodes.find(n => String(n.itemId || n.item_id || '').trim() === itemId) || nodes[0];
        const product = normalizeShopeeAffiliateProduct(exact, finalUrl, ids);
        if (product && (product.title || product.image || product.price)) return product;
        if (data?.errors?.length) console.log('[Shopee dados Affiliate API]', data.errors.map(e => e.message || e).join(' | '));
      } catch (err) {
        console.log('[Shopee dados Affiliate API]', err.response?.data || err.message);
      }
    }
  }
  return null;
}

async function shopeeProductFromApi(originalUrl) {
  const finalUrl = await resolveFinalUrl(originalUrl);
  const ids = extractShopeePdpParams(finalUrl || originalUrl);

  let pdpProduct = null;
  if (ids.shopid && ids.itemid) {
    try {
      pdpProduct = await shopeePublicProductApi(finalUrl || originalUrl, ids);
    } catch (err) {
      console.log('[Shopee PDP preço final]', err.response?.data || err.message);
    }
  }

  let officialProduct = null;
  try {
    officialProduct = await productFromShopeeUrl(finalUrl || originalUrl);
  } catch (err) {
    console.log('[Shopee OpenAPI produto]', err.response?.data || err.message);
  }

  if (pdpProduct || officialProduct) {
    const base = officialProduct || pdpProduct || {};
    const priceSource = pdpProduct?.price ? pdpProduct : officialProduct || {};
    return normalizeProduct({
      ...base,
      title: (pdpProduct?.title && pdpProduct.title !== 'Produto Shopee') ? pdpProduct.title : (base.title || 'Produto Shopee'),
      image: pdpProduct?.image || base.image || '',
      price: priceSource.price || base.price || '',
      priceNumber: priceSource.priceNumber || base.priceNumber || 0,
      oldPrice: pdpProduct?.oldPrice || base.oldPrice || '',
      oldPriceNumber: pdpProduct?.oldPriceNumber || base.oldPriceNumber || 0,
      sold: pdpProduct?.sold || base.sold || '',
      rating: pdpProduct?.rating || base.rating || '',
      link: finalUrl || originalUrl,
      affiliateLink: officialProduct?.affiliateLink || officialProduct?.finalUrl || officialProduct?.link || base.affiliateLink || '',
      source: pdpProduct?.price ? 'shopee-pdp-final-price+openapi' : (base.source || 'shopee-openapi')
    }, 'shopee');
  }

  throw new Error('Shopee não retornou dados do produto pela Open API nem pelo PDP. Verifique credenciais e, para preço Pix/final, os headers do F12.');
}

function platformAffiliate(platform, link) {
  const url = cleanUrl(link);
  if (!url) return url;
  try {
    const u = new URL(url);
    if (platform === 'amazon') {
      const tag = env('AMAZON_ASSOCIATE_TAG') || env('AMAZON_PARTNER_TAG') || '';
      if (tag) u.searchParams.set('tag', tag);
      return u.toString();
    }
    if (platform === 'magalu') {
      const slug = env('MAGALU_STORE_SLUG') || env('MAGALU_AFFILIATE_ID') || '';
      if (slug) u.searchParams.set('partner_id', slug);
      return u.toString();
    }
    if (platform === 'shopee') {
      const aff = env('SHOPEE_AFFILIATE_ID') || '';
      if (aff) u.searchParams.set('utm_content', aff);
      return u.toString();
    }
  } catch {}
  return url;
}

function shopeeAuthHeaders(payload) {
  const appId = env('SHOPEE_APP_ID') || env('SHOPEE_PARTNER_ID') || '';
  const secret = env('SHOPEE_SECRET') || '';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify(payload);
  const candidates = [
    crypto.createHmac('sha256', secret).update(appId + timestamp + body).digest('hex'),
    crypto.createHash('sha256').update(appId + timestamp + body + secret).digest('hex'),
    crypto.createHash('sha256').update(appId + timestamp + secret).digest('hex')
  ];
  return { appId, secret, timestamp, body, candidates };
}

function extractShopeeAffiliateLink(data) {
  const roots = [
    data?.data?.generateShortLink,
    data?.data?.generateShortLinkV2,
    data?.data?.generateAffiliateLink,
    data?.data?.generateAffiliateLinkV2,
    data?.data?.conversionLink,
    data?.data,
    data
  ].filter(Boolean);
  for (const root of roots) {
    const value = root.shortLink || root.short_link || root.link || root.affiliateLink || root.affiliate_link || root.url;
    if (value) return value;
    if (Array.isArray(root.links) && root.links[0]) {
      const v = root.links[0].shortLink || root.links[0].short_link || root.links[0].link || root.links[0].affiliateLink || root.links[0].affiliate_link;
      if (v) return v;
    }
  }
  return '';
}


async function shopeePanelAffiliate(link) {
  if (!link) return '';
  const csrf = env('SHOPEE_CSRF_TOKEN') || '';
  const afDat = env('SHOPEE_AF_AC_ENC_DAT') || env('SHOPEE_AF_DAT') || '';
  const afToken = env('SHOPEE_AF_AC_ENC_SZ_TOKEN') || env('SHOPEE_AF_TOKEN') || '';
  const xSapRi = env('SHOPEE_X_SAP_RI') || '';
  const xSapSec = env('SHOPEE_X_SAP_SEC') || '';
  const cookie = env('SHOPEE_COOKIE') || '';

  // Usa os headers que aparecem no F12 que aparecem no F12 da request batchCustomLink.
  if (!csrf && !afDat && !afToken && !xSapRi && !xSapSec) return '';

  const payload = {
    operationName: 'batchGetCustomLink',
    query: `
    query batchGetCustomLink($linkParams: [CustomLinkParam!], $sourceCaller: SourceCaller){
      batchCustomLink(linkParams: $linkParams, sourceCaller: $sourceCaller){
        shortLink
        longLink
        failCode
      }
    }
    `,
    variables: {
      linkParams: [{ originalLink: link, advancedLinkParams: {} }],
      sourceCaller: 'CUSTOM_LINK_CALLER'
    }
  };
  try {
    const headers = {
      'content-type': 'application/json; charset=UTF-8',
      accept: 'application/json,text/plain,*/*',
      origin: 'https://affiliate.shopee.com.br',
      referer: 'https://affiliate.shopee.com.br/offer/custom_link',
      'affiliate-program-type': '1',
      'user-agent': env('SHOPEE_USER_AGENT') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
    };
    if (csrf) headers['csrf-token'] = csrf;
    if (afDat) headers['af-ac-enc-dat'] = afDat;
    if (afToken) headers['af-ac-enc-sz-token'] = afToken;
    if (xSapRi) headers['x-sap-ri'] = xSapRi;
    if (xSapSec) headers['x-sap-sec'] = xSapSec;

    const { data } = await http.post('https://affiliate.shopee.com.br/api/v3/gql?q=batchCustomLink', payload, {
      timeout: 20000,
      headers
    });
    const row = data?.data?.batchCustomLink?.[0];
    return row?.shortLink || row?.longLink || '';
  } catch (err) {
    console.log('[Shopee affiliate painel sem cookie]', err.response?.data || err.message);
    return '';
  }
}

async function shopeeApiAffiliate(link) {
  const appId = env('SHOPEE_APP_ID') || env('SHOPEE_PARTNER_ID') || '';
  const secret = env('SHOPEE_SECRET') || '';
  if (!appId || !secret || !link) return '';

  const apiUrl = env('SHOPEE_API_URL') || 'https://open-api.affiliate.shopee.com.br/graphql';
  const subId = env('SHOPEE_AFFILIATE_ID') || '';
  const payloads = [
    {
      query: `mutation GenerateShortLink($input: GenerateShortLinkInput!) { generateShortLink(input: $input) { shortLink } }`,
      variables: { input: { originUrl: link, subIds: subId ? [subId] : [] } }
    },
    {
      query: `mutation { generateShortLink(input: { originUrl: "${String(link).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}", subIds: ${JSON.stringify(subId ? [subId] : [])} }) { shortLink } }`
    },
    {
      query: `mutation GenerateAffiliateLink($input: GenerateAffiliateLinkInput!) { generateAffiliateLink(input: $input) { affiliateLink shortLink } }`,
      variables: { input: { originUrl: link, subIds: subId ? [subId] : [] } }
    }
  ];

  for (const payload of payloads) {
    const auth = shopeeAuthHeaders(payload);
    for (const signature of auth.candidates) {
      try {
        const { data } = await http.post(apiUrl, auth.body, {
          timeout: 20000,
          headers: {
            'content-type': 'application/json',
            authorization: `SHA256 Credential=${auth.appId}, Timestamp=${auth.timestamp}, Signature=${signature}`
          }
        });
        const out = extractShopeeAffiliateLink(data);
        if (out) return out;
        if (data?.errors?.length) console.log('[Shopee affiliate API]', data.errors.map(e => e.message || e).join(' | '));
      } catch (err) {
        console.log('[Shopee affiliate API]', err.response?.data || err.message);
      }
    }
  }
  return '';
}

async function convertAffiliate(platform, link) {
  if (platform === 'amazon') return link;
  if (platform === 'shopee') {
    try {
      // Conversão oficial no projeto: busca o produto pela Open API e usa offerLink.
      // Isso substitui a mutation generateShortLink que estava dando erro de schema.
      const apiLink = await affiliateFromShopeeUrl(link);
      if (apiLink && apiLink !== link) return apiLink;
    } catch (err) {
      console.log('[Shopee affiliate offerLink]', err.response?.data || err.message);
    }
    return link;
  }
  return platformAffiliate(platform, link);
}

async function resolveMagaluAffiliateUrl(inputUrl) {
  const original = cleanUrl(inputUrl);
  if (!original) return original;

  if (!/magazineluiza\.onelink\.me/i.test(original)) return original;

  const headers = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
    'user-agent': env('SCRAPER_USER_AGENT') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  };

  function toMagazineVoce(url) {
    let slug = String(env('MAGALU_STORE_SLUG') || '').trim();
    if (!slug) return url;

    // Aceita os dois formatos no painel:
    // promozeraoficial OU magazinepromozeraoficial
    slug = slug
      .replace(/^https?:\/\/(www\.)?magazinevoce\.com\.br\//i, '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
      .split('/')[0]
      .replace(/^magazine/i, '');

    if (!slug) return url;

    try {
      const u = new URL(url);
      const path = u.pathname.replace(/^\/+/, '');
      const query = u.search || '';

      if (/magazinevoce\.com\.br/i.test(u.hostname)) return url;

      if (/magazineluiza\.com\.br/i.test(u.hostname)) {
        return `https://www.magazinevoce.com.br/magazine${slug}/${path}${query}`;
      }
    } catch {}

    return url;
  }

  try {
    const res = await http.get(original, {
      timeout: 25000,
      maxRedirects: 15,
      responseType: 'text',
      headers,
      validateStatus: s => s >= 200 && s < 500
    });

    let finalUrl = res?.request?.res?.responseUrl || original;

    if (/magazineluiza\.com\.br|magazinevoce\.com\.br/i.test(finalUrl)) {
      return toMagazineVoce(finalUrl);
    }

    const html = String(res.data || '');
    const match =
      html.match(/https?:\/\/www\.magazineluiza\.com\.br\/[^"'\\<>\s]+/i) ||
      html.match(/https?:\/\/www\.magazinevoce\.com\.br\/[^"'\\<>\s]+/i);

    if (match?.[0]) {
      return toMagazineVoce(
        decodeURIComponent(match[0]).replace(/\\\//g, '/').replace(/&amp;/g, '&')
      );
    }
  } catch (err) {
    console.log('[Magalu OneLink] erro:', err.message);
  }

  return original;
}

async function productFromLink(platform, link) {
  const originalUrl = cleanUrl(link);
  if (!originalUrl) throw new Error('Informe um link válido do produto.');

  let scrapeUrl = originalUrl;
  if (platform === 'magalu') {
    scrapeUrl = await resolveMagaluAffiliateUrl(originalUrl);
  }

  if (platform === 'shopee') {
    let shopeeProduct = null;
    try { shopeeProduct = await shopeeProductFromApi(originalUrl); }
    catch (err) { console.log('[Shopee API produto]', err.response?.data || err.message); }

    if (shopeeProduct) {
      const affiliateLink = shopeeProduct.affiliateLink || await convertAffiliate('shopee', shopeeProduct.link || originalUrl);
      return normalizeProduct({ ...shopeeProduct, affiliateLink }, 'shopee');
    }
  }

  const headers = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'user-agent': env('SCRAPER_USER_AGENT') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    referer: scrapeUrl
  };

  let title = 'Produto em oferta';
  let image = '';
  let price = '';
  let oldPrice = '';

  function first(...values) {
    for (const value of values.flat()) {
      const clean = String(value || '').replace(/\s+/g, ' ').trim();
      if (clean && clean !== 'undefined' && clean !== 'null') return clean;
    }
    return '';
  }

  function decodeHtml(text = '') {
    return String(text)
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#x2F;/g, '/')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
  }

  function cleanTitle(text = '') {
    return decodeHtml(text)
      .replace(/\s*[-|]\s*(Amazon).*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanPriceText(value = '') {
    const s = decodeHtml(value).replace(/\s+/g, ' ').trim();
    const m = s.match(/R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}|R\$\s*\d+,\d{2}|\d{1,3}(?:\.\d{3})*,\d{2}/);
    return m ? moneyBR(m[0]) : moneyBR(s);
  }

  function regexFirst(html, patterns) {
    for (const re of patterns) {
      const m = String(html || '').match(re);
      if (m?.[1]) return decodeHtml(m[1]);
    }
    return '';
  }

  function extractJsonLdProduct($) {
    const products = jsonLdProducts($);
    return products[0] || {};
  }

  try {
    const res = await http.get(scrapeUrl, {
      timeout: 25000,
      maxRedirects: 8,
      responseType: 'text',
      headers,
      validateStatus: s => s >= 200 && s < 500
    });

    const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || {});
    const $ = cheerio.load(html);
    const jsonProduct = extractJsonLdProduct($);

    const metaTitle = meta($, 'og:title') || meta($, 'twitter:title') || jsonProduct.name || $('title').first().text();
    const metaImage = meta($, 'og:image') || meta($, 'twitter:image') || meta($, 'twitter:image:src');
    const jsonImage = Array.isArray(jsonProduct.image) ? jsonProduct.image[0] : jsonProduct.image;

    title = first(metaTitle, jsonProduct.name, title);
    image = first(metaImage, jsonImage);

    if (platform === 'amazon') {
      title = first(
        $('#productTitle').text(),
        $('#title').text(),
        metaTitle,
        regexFirst(html, [
          /"title"\s*:\s*"([^"]{10,300})"/i,
          /"productTitle"\s*:\s*"([^"]{10,300})"/i
        ])
      );

      image = first(
        $('img#landingImage').attr('data-old-hires'),
        $('img#landingImage').attr('src'),
        $('img#imgBlkFront').attr('src'),
        metaImage,
        regexFirst(html, [
          /"hiRes"\s*:\s*"([^"]+)"/i,
          /"large"\s*:\s*"([^"]+)"/i,
          /"mainUrl"\s*:\s*"([^"]+)"/i
        ])
      );

      const amazonPrice = first(
        $('#corePrice_feature_div .a-price .a-offscreen').first().text(),
        $('#apex_desktop .a-price .a-offscreen').first().text(),
        $('.priceToPay .a-offscreen').first().text(),
        $('#priceblock_ourprice').text(),
        $('#priceblock_dealprice').text(),
        $('#priceblock_saleprice').text(),
        meta($, 'product:price:amount'),
        pickPriceFromJsonLd(jsonProduct),
        regexFirst(html, [
          /"displayPrice"\s*:\s*"(R\$\s?[^"]+)"/i,
          /"priceToPay"[\s\S]{0,300}?"displayString"\s*:\s*"(R\$\s?[^"]+)"/i,
          /"priceAmount"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i
        ])
      );

      price = cleanPriceText(amazonPrice);
    } else {
      const metaPrice = meta($, 'product:price:amount') || meta($, 'og:price:amount') || pickPriceFromJsonLd(jsonProduct);
      const selectorPrice = $('[class*=price], [class*=Price], [data-testid*=price]').first().text();
      price = cleanPriceText(first(metaPrice, selectorPrice));
    }

    title = cleanTitle(title);
    image = decodeHtml(image).replace(/\\\//g, '/');

    if (image.startsWith('//')) image = 'https:' + image;
  } catch (err) {
    console.log(`[${platform}] leitura do link falhou:`, err.message);
  }

  const affiliateLink =
    platform === 'magalu' && /magazineluiza\.onelink\.me/i.test(originalUrl)
      ? originalUrl
      : await convertAffiliate(platform, scrapeUrl);

  return normalizeProduct({
    title: title || 'Produto em oferta',
    price,
    priceNumber: toNumberBR(price),
    oldPrice,
    image: absoluteUrl(image, scrapeUrl),
    link: scrapeUrl,
    affiliateLink,
    source: platform === 'shopee' ? 'shopee-link-fallback' : `${platform}-link-manual`
  }, platform);
}

module.exports = { productFromLink, convertAffiliate, platformAffiliate, shopeeProductFromApi, extractShopeeIds };
