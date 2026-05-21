const { env } = require('../userEnv');
const crypto = require('crypto');
const { http } = require('../lib/http');
const { normalizeProduct, moneyBR, toNumberBR } = require('../lib/format');

const DEFAULT_API_URL = 'https://open-api.affiliate.shopee.com.br/graphql';

function getShopeeApiUrl() {
  return env('SHOPEE_API_URL') || DEFAULT_API_URL;
}

function hasShopeeCredentials() {
  return Boolean(env('SHOPEE_APP_ID') && env('SHOPEE_SECRET'));
}

function signPayload(payloadString) {
  const appId = String(env('SHOPEE_APP_ID') || '').trim();
  const secret = String(env('SHOPEE_SECRET') || '').trim();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = crypto
    .createHash('sha256')
    .update(`${appId}${timestamp}${payloadString}${secret}`)
    .digest('hex');
  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`;
}

async function shopeeGraphQL(query, variables = {}) {
  if (!hasShopeeCredentials()) {
    throw new Error('Configure SHOPEE_APP_ID e SHOPEE_SECRET no painel.');
  }
  const payload = JSON.stringify({ query, variables });
  const { data } = await http.post(getShopeeApiUrl(), payload, {
    timeout: 30000,
    headers: {
      'content-type': 'application/json',
      authorization: signPayload(payload)
    }
  });
  if (data?.errors?.length) {
    const msg = data.errors.map(e => e.message || e.extensions?.message || JSON.stringify(e)).join(' | ');
    throw new Error(`Shopee API: ${msg}`);
  }
  return data?.data || {};
}

function slugToKeyword(url = '') {
  try {
    const u = new URL(String(url));
    const path = decodeURIComponent(u.pathname || '');
    const beforeIds = path.split(/-i\.|\/product\//i)[0] || path;
    const last = beforeIds.split('/').filter(Boolean).pop() || '';
    return last
      .replace(/[-_]+/g, ' ')
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return String(url || '').replace(/https?:\/\/\S+/g, '').replace(/[-_]+/g, ' ').trim();
  }
}

function extractShopeeIds(inputUrl = '') {
  const raw = String(inputUrl || '').trim();
  const decoded = (() => { try { return decodeURIComponent(raw); } catch { return raw; } })();
  const patterns = [
    /[?&]shopid=(\d+).*?[?&]itemid=(\d+)/i,
    /[?&]itemid=(\d+).*?[?&]shopid=(\d+)/i,
    /(?:^|[\/.-])i\.(\d+)\.(\d+)(?:[/?#]|$)/i,
    /product\/(\d+)\/(\d+)/i,
    /shop\/(\d+)\/product\/(\d+)/i
  ];
  for (const re of patterns) {
    const m = decoded.match(re);
    if (!m) continue;
    if (re.source.includes('itemid=(\\d+).*?')) return { shopid: m[2], itemid: m[1] };
    return { shopid: m[1], itemid: m[2] };
  }
  return { shopid: '', itemid: '' };
}

async function searchProductOffers(keyword, limit = 10, page = 1) {
  const query = `
    query ProductOffers($keyword: String!, $limit: Int!, $page: Int!) {
      productOfferV2(keyword: $keyword, listType: 1, sortType: 5, page: $page, limit: $limit) {
        nodes {
          itemId
          productName
          productLink
          offerLink
          imageUrl
          priceMin
          priceMax
          priceDiscountRate
          sales
          ratingStar
          commissionRate
          sellerCommissionRate
          shopeeCommissionRate
          commission
          shopId
          shopName
          shopType
        }
        pageInfo { page limit hasNextPage }
      }
    }
  `;
  const data = await shopeeGraphQL(query, { keyword, limit, page });
  return data?.productOfferV2?.nodes || [];
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function calcOldPrice(price, discountRate) {
  const p = toNumber(price);
  const d = toNumber(discountRate);
  if (!p || !d || d <= 0 || d >= 100) return null;
  return p / (1 - d / 100);
}

function normalizeShopeeOffer(item = {}, keyword = '', originalUrl = '') {
  /*
    PRIORIDADE DO PREÇO:
    1. item.product_price.price.single_value
       Exemplo Shopee: 63388000 / 100000 = 633,88

    2. item.price_breakdown.price.single_value
       Caso venha preço final/Pix em outro bloco

    3. item.priceMin / item.priceMax da Open API oficial

    Nunca usar preço de parcela.
  */

  const rawShopeePrice =
    item?.price_breakdown?.price?.single_value ||
    item?.product_price?.price?.single_value ||
    item?.price_breakdown?.price?.single_value ||
    item?.price?.single_value ||
    null;

  let promoPrice = null;

  if (rawShopeePrice) {
    promoPrice = Number(rawShopeePrice) / 100000;
  } else {
    promoPrice =
      toNumber(item.priceMin) ||
      toNumber(item.priceMax);
  }

  const discountRate = toNumber(item.priceDiscountRate);

  const oldPriceRaw =
    item?.product_price?.price_before_discount?.single_value ||
    item?.price_before_discount?.single_value ||
    null;

  let oldPrice = null;

  if (oldPriceRaw) {
    oldPrice = Number(oldPriceRaw) / 100000;
  } else if (promoPrice && discountRate && discountRate > 0 && discountRate < 100) {
    oldPrice = promoPrice / (1 - discountRate / 100);
  }

  const link = item.productLink || originalUrl || item.offerLink || '';
  const affiliateLink = item.offerLink || link;

  return normalizeProduct({
    title: item.productName || item?.item?.title || 'Produto Shopee',

    price: promoPrice ? moneyBR(promoPrice) : '',

    priceNumber: promoPrice,

    oldPrice: oldPrice ? moneyBR(oldPrice) : '',

    oldPriceNumber: oldPrice,

    discount:
      discountRate && discountRate > 0
        ? `${String(discountRate).replace('%', '')}%`
        : '',

    image:
      item.imageUrl ||
      (item?.product_images?.images?.[0]
        ? `https://cf.shopee.com.br/file/${item.product_images.images[0]}`
        : ''),

    link,

    affiliateLink,

    sold: item.sales || '',

    rating: item.ratingStar || '',

    source: keyword ? `shopee-api:${keyword}` : 'shopee-api',

    raw: {
      itemId: item.itemId || item?.item?.item_id,
      shopId: item.shopId || item?.item?.shop_id,
      shopName: item.shopName,
      commissionRate: item.commissionRate,
      affiliateId: env('SHOPEE_AFFILIATE_ID') || '',
      apiPriceMin: item.priceMin,
      apiPriceMax: item.priceMax,
      apiDiscountRate: item.priceDiscountRate,
      shopeeRawPrice: rawShopeePrice
    }
  }, 'shopee');
}

function scoreOffer(item = {}, ids = {}, keyword = '') {
  let score = 0;
  if (ids.itemid && String(item.itemId || '') === String(ids.itemid)) score += 1000;
  if (ids.shopid && String(item.shopId || '') === String(ids.shopid)) score += 300;
  const name = String(item.productName || '').toLowerCase();
  for (const word of String(keyword || '').toLowerCase().split(/\s+/).filter(w => w.length > 2)) {
    if (name.includes(word)) score += 2;
  }
  return score;
}

async function productFromShopeeUrl(url) {
  const ids = extractShopeeIds(url);
  let keyword = slugToKeyword(url);
  if (!keyword) keyword = ids.itemid || 'produto';
  const attempts = [keyword, keyword.split(' ').slice(0, 8).join(' '), keyword.split(' ').slice(0, 5).join(' ')]
    .filter((v, i, arr) => v && arr.indexOf(v) === i);

  let best = null;
  let bestKeyword = attempts[0] || '';
  for (const term of attempts) {
    const nodes = await searchProductOffers(term, 20, 1);
    if (!nodes.length) continue;
    const sorted = [...nodes].sort((a, b) => scoreOffer(b, ids, term) - scoreOffer(a, ids, term));
    best = sorted[0];
    bestKeyword = term;
    if (ids.itemid && String(best.itemId || '') === String(ids.itemid)) break;
  }
  if (!best) throw new Error('Shopee API não retornou produto para esse link/palavra-chave. Tente pesquisar por um termo do produto.');
  return normalizeShopeeOffer(best, bestKeyword, url);
}

async function collectShopeePromotions(keyword, limit = 10) {
  const nodes = await searchProductOffers(keyword || 'oferta', limit, 1);
  return nodes.map(item => normalizeShopeeOffer(item, keyword));
}

async function affiliateFromShopeeUrl(url) {
  const product = await productFromShopeeUrl(url);
  return product.affiliateLink || product.link || url;
}

module.exports = {
  hasShopeeCredentials,
  shopeeGraphQL,
  searchProductOffers,
  productFromShopeeUrl,
  collectShopeePromotions,
  affiliateFromShopeeUrl,
  extractShopeeIds,
  DEFAULT_API_URL
};
