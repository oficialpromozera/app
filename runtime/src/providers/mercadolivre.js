const { env } = require('../userEnv');
const { http } = require('../lib/http');
const { normalizeProduct, uniqueByLink, moneyBR } = require('../lib/format');
const { demoProducts } = require('./demo');

function mlImage(id) {
  return id ? `https://http2.mlstatic.com/D_NQ_NP_${id}-O.webp` : '';
}

async function createAffiliateLink(url) {
  const cookie = env('ML_COOKIE') || '';
  const csrf = env('ML_CSRF_TOKEN') || '';
  const tag = env('ML_AFFILIATE_TAG') || '';
  if (!cookie || !csrf || !tag || !url) return url;
  try {
    const res = await http.post('https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink', {
      urls: [url], tag
    }, { headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' } });
    const data = res.data;
    return data?.links?.[0]?.short_url || data?.links?.[0]?.url || data?.urls?.[0]?.short_url || url;
  } catch { return url; }
}

async function search({ q = '', limit = 60, pages = 1, onlyDiscount = false }) {
  const pageSize = 50;
  const products = [];
  try {
    for (let page = 0; page < Math.min(Number(pages || 1), 20); page++) {
      const offset = page * pageSize;
      const url = q
        ? `https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(q)}&limit=${pageSize}&offset=${offset}`
        : `https://api.mercadolibre.com/sites/MLB/search?category=MLB1051&limit=${pageSize}&offset=${offset}`;
      const { data } = await http.get(url);
      for (const it of data.results || []) {
        const old = it.original_price || null;
        const p = normalizeProduct({
          id: it.id,
          title: it.title,
          priceNumber: it.price,
          oldPriceNumber: old,
          price: moneyBR(it.price),
          oldPrice: old ? moneyBR(old) : '',
          image: it.thumbnail?.replace('-I.jpg', '-O.jpg') || mlImage(it.thumbnail_id),
          link: it.permalink,
          rating: it.reviews?.rating_average || '',
          sold: it.sold_quantity || '',
          source: 'api-mercadolivre'
        }, 'mercadolivre');
        if (!onlyDiscount || p.discount) products.push(p);
      }
    }
    const out = uniqueByLink(products).slice(0, Math.max(limit, pages * pageSize));
    return Promise.all(out.map(async p => ({ ...p, affiliateLink: await createAffiliateLink(p.link) })));
  } catch (err) {
    console.log('[Mercado Livre] fallback demo:', err.message);
    return demoProducts('mercadolivre', q);
  }
}
module.exports = { search, createAffiliateLink };
