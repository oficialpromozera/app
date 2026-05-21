const cheerio = require('cheerio');
const { getText } = require('../lib/http');
const { normalizeProduct, absoluteUrl, uniqueByLink, moneyBR } = require('../lib/format');
const { demoProducts } = require('./demo');

async function scrapeGeneric(platform, q, url, selectors, limit = 60) {
  try {
    const html = await getText(url);
    const $ = cheerio.load(html);
    const products = [];
    $(selectors.card).each((_, el) => {
      const card = $(el);
      const title = card.find(selectors.title).first().text().trim() || card.attr('title');
      const link = absoluteUrl(card.find(selectors.link).first().attr('href') || card.attr('href'), url);
      const priceText = card.find(selectors.price).first().text().trim();
      const oldText = selectors.oldPrice ? card.find(selectors.oldPrice).first().text().trim() : '';
      const image = card.find('img').first().attr('src') || card.find('img').first().attr('data-src') || card.find('img').first().attr('data-original');
      if (title && link) products.push(normalizeProduct({ title, price: moneyBR(priceText), priceNumber: priceText, oldPriceNumber: oldText, oldPrice: moneyBR(oldText), image: absoluteUrl(image, url), link, source: 'scrape' }, platform));
      if (products.length >= limit) return false;
    });
    return products.length ? uniqueByLink(products) : demoProducts(platform, q);
  } catch (err) { console.log(`[${platform}] fallback demo:`, err.message); return demoProducts(platform, q); }
}
module.exports = { scrapeGeneric };
