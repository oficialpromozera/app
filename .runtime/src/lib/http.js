const axios = require('axios');

const http = axios.create({
  timeout: 20000,
  headers: {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8'
  }
});

async function getText(url, options = {}) {
  const res = await http.get(url, { ...options, responseType: 'text' });
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
}

module.exports = { http, getText };
