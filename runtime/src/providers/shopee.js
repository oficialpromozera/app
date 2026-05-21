const { collectShopeePromotions } = require('./shopeeOfficial');
const { uniqueByLink } = require('../lib/format');

async function search({ q = '', limit = 80 }) {
  const keyword = String(q || '').trim() || 'ofertas';
  const products = await collectShopeePromotions(keyword, Number(limit || 80));
  return uniqueByLink(products);
}

module.exports = { search };
