const { env } = require('../userEnv');
const { scrapeGeneric } = require('./scrapeFactory');
function affiliate(link) {
  const tag = env('AMAZON_ASSOCIATE_TAG') || env('AMAZON_PARTNER_TAG') || '';
  if (!tag || !link) return link;
  try { const u = new URL(link); u.searchParams.set('tag', tag); return u.toString(); } catch { return link; }
}
async function search({ q = '', limit = 60 }) {
  const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(q || 'ofertas')}`;
  const items = await scrapeGeneric('amazon', q, url, { card: '[data-component-type="s-search-result"]', title: 'h2 span', price: '.a-price .a-offscreen', oldPrice: '.a-price.a-text-price .a-offscreen', link: 'h2 a' }, limit);
  return items.map(p => ({ ...p, affiliateLink: affiliate(p.link) }));
}
module.exports = { search };
