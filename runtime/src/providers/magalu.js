const { env } = require('../userEnv');
const { scrapeGeneric } = require('./scrapeFactory');
function affiliate(link) {
  const slug = env('MAGALU_STORE_SLUG') || '';
  if (!slug || !link) return link;
  return link.includes('?') ? `${link}&partner_id=${slug}` : `${link}?partner_id=${slug}`;
}
async function search({ q = '', limit = 60 }) {
  const url = `https://www.magazineluiza.com.br/busca/${encodeURIComponent(q || 'ofertas')}/`;
  const items = await scrapeGeneric('magalu', q, url, { card: '[data-testid="product-card"], li, .product-card', title: '[data-testid="product-title"], h2, h3', price: '[data-testid="price-value"], .price, [class*="price"]', oldPrice: 's, [class*="old"]', link: 'a' }, limit);
  return items.map(p => ({ ...p, affiliateLink: affiliate(p.link) }));
}
module.exports = { search };
