const crypto = require('crypto');

function toNumberBR(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value).trim();
  s = s.replace(/[^\d.,-]/g, '');
  if (!s) return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) s = s.replace(/\./g, '').replace(',', '.');
  else if (hasComma) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function moneyBR(value) {
  const n = toNumberBR(value);
  if (n === null) return '';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function cleanText(text = '') {
  return String(text).replace(/\s+/g, ' ').trim();
}

function absoluteUrl(url, base) {
  if (!url) return '';
  try { return new URL(url, base).toString(); } catch { return url; }
}

function pickImage(...values) {
  for (const value of values.flat()) {
    if (!value) continue;
    const s = String(value);
    if (/^https?:\/\//.test(s)) return s;
  }
  return '';
}

function discountFrom(price, oldPrice) {
  const p = toNumberBR(price);
  const o = toNumberBR(oldPrice);
  if (!p || !o || o <= p) return '';
  return `${Math.round(((o - p) / o) * 100)}%`;
}

function idFrom(input) {
  return crypto.createHash('md5').update(String(input || Math.random())).digest('hex').slice(0, 12);
}

function normalizeProduct(item = {}, platform = '') {
  const priceNumber = toNumberBR(item.priceNumber ?? item.price);
  const oldPriceNumber = toNumberBR(item.oldPriceNumber ?? item.oldPrice);
  const link = item.link || item.url || '';
  return {
    id: item.id || idFrom(`${platform}:${item.title}:${link}`),
    platform,
    title: cleanText(item.title || 'Produto em oferta'),
    priceNumber,
    oldPriceNumber,
    price: item.price || moneyBR(priceNumber),
    oldPrice: item.oldPrice || moneyBR(oldPriceNumber),
    discount: String(item.discount || discountFrom(priceNumber, oldPriceNumber)).replace('%%', '%'),
    image: item.image || '',
    link,
    affiliateLink: item.affiliateLink || item.link || '',
    rating: item.rating || '',
    sold: item.sold || '',
    source: item.source || platform,
    raw: item.raw || undefined
  };
}

function uniqueByLink(products) {
  const map = new Map();
  for (const p of products || []) {
    const key = p.link || p.title;
    if (!map.has(key)) map.set(key, p);
  }
  return [...map.values()];
}

function makeCopy(product) {
  const templates = [
`🔥 OFERTA ENCONTRADA!\n\n{{title}}\n\n💰 Por: {{price}}\n{{oldLine}}{{discountLine}}\n🛒 Garanta aqui:\n{{link}}`,
`🚨 PROMOÇÃO QUENTE!\n\n{{title}}\n\n✅ Preço: {{price}}\n{{discountLine}}👇 Link da oferta:\n{{link}}`,
`⚡ Achado de hoje!\n\n{{title}}\n\n💸 Saindo por {{price}}\n{{oldLine}}🔗 {{link}}`
  ];
  const tpl = templates[Math.floor(Math.random() * templates.length)];
  return tpl
    .replaceAll('{{title}}', product.title || 'Produto em oferta')
    .replaceAll('{{price}}', product.price || 'Conferir no link')
    .replaceAll('{{link}}', product.affiliateLink || product.link || '')
    .replaceAll('{{oldLine}}', product.oldPrice ? `❌ Antes: ${product.oldPrice}\n` : '')
    .replaceAll('{{discountLine}}', product.discount ? `🔥 Desconto: ${product.discount}\n` : '');
}

module.exports = { toNumberBR, moneyBR, cleanText, absoluteUrl, pickImage, discountFrom, idFrom, normalizeProduct, uniqueByLink, makeCopy };
