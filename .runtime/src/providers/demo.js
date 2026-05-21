const { normalizeProduct } = require('../lib/format');
const names = {
  mercadolivre: 'Mercado Livre', shopee: 'Shopee', magalu: 'Magazine Luiza', amazon: 'Amazon'
};
function demoProducts(platform, q = '') {
  const base = names[platform] || platform;
  return Array.from({ length: 12 }).map((_, i) => normalizeProduct({
    id: `${platform}-demo-${i}`,
    title: `${base} Oferta ${i + 1} ${q || 'produto em destaque'}`,
    priceNumber: 49.9 + i * 17,
    oldPriceNumber: 89.9 + i * 23,
    discount: `${20 + (i % 6) * 5}%`,
    image: `https://picsum.photos/seed/${platform}-${i}/700/700`,
    link: `https://www.google.com/search?q=${encodeURIComponent(base + ' ' + (q || 'ofertas'))}`,
    source: 'demo'
  }, platform));
}
module.exports = { demoProducts };
