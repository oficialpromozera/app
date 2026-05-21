const $ = id => document.getElementById(id);
const platforms = [
  ['mercadolivre','🟡','Mercado Livre'],
  ['shopee','🟠','Shopee'],
  ['magalu','🔵','Magazine Luiza'],
  ['amazon','⚫','Amazon']
];
let currentPlatform = new URLSearchParams(location.search).get('platform') || 'mercadolivre';
const initialView = new URLSearchParams(location.search).get('view');
let currentView = ['settings','templates','queue','auto','sent','__disabled_licenses__'].includes(initialView) ? initialView : 'catalog';
let products = [];
let selectedProduct = null;
let activeFilter = 'all';
let lastCatalogRequest = { q: '', pages: 1, onlyDiscount: false, source: '', page: 1 };
let lastPagination = null;
let envGroups = [];
let envValues = {};
let selectedThemeId = localStorage.getItem('afiliadoProTheme') || 'neon-roxo';
let currentUser = null;
let queueTimer = null;
let queueRunning = false;
let autoProducts = [];
let autoTimer = null;
let autoRunning = false;
const themes = [
  ['neon-roxo','Neon Roxo','Tecnologia premium','#7c3cff','#00e5ff','#ff4d6d','🌌'],
  ['cyber-blue','Cyber Blue','Azul elétrico','#1463ff','#00eaff','#1bffb8','💠'],
  ['gold-black','Gold Black','Luxo escuro','#ffb300','#ff5f6d','#ffee75','🏆'],
  ['emerald','Emerald','Verde conversão','#00c853','#64ffda','#00e676','💚'],
  ['ruby','Ruby Sale','Vermelho oferta','#ff1744','#ff8a80','#ffd166','🔥'],
  ['ocean','Ocean','Azul limpo','#0091ea','#40c4ff','#84ffff','🌊'],
  ['sunset','Sunset','Laranja viral','#ff6d00','#ffca28','#ff4081','🌅'],
  ['purple-pink','Purple Pink','Influencer','#d500f9','#ff4081','#7c4dff','💜'],
  ['matrix','Matrix','Hacker promo','#00e676','#00bfa5','#69f0ae','🟢'],
  ['ice','Ice','Claro frio','#42a5f5','#b3e5fc','#ffffff','❄️'],
  ['coffee','Coffee','Elegante quente','#8d6e63','#ffcc80','#d7ccc8','☕'],
  ['steel','Steel','Cinza profissional','#607d8b','#90a4ae','#eceff1','⚙️'],
  ['lime','Lime Punch','Chamativo','#c6ff00','#76ff03','#ffee58','🍋'],
  ['royal','Royal','Azul nobre','#304ffe','#7c4dff','#00b0ff','👑'],
  ['candy','Candy','Suave moderno','#ff80ab','#82b1ff','#b388ff','🍬'],
  ['fire','Fire','Venda agressiva','#ff3d00','#ffab00','#ff1744','🚀'],
  ['mint','Mint','Leve e clean','#00bfa5','#64ffda','#a7ffeb','🌿'],
  ['galaxy','Galaxy','Espacial','#651fff','#18ffff','#ff4081','✨'],
  ['carbon','Carbon','Dark premium','#263238','#00e5ff','#78909c','⬛'],
  ['pix','Pix Verde','Pagamento rápido','#00b341','#00ffc6','#b9f6ca','💸'],
  ['telegram','Telegram','Social azul','#229ed9','#00e5ff','#7dd3fc','✈️'],
  ['whatsapp','WhatsApp','Social verde','#25d366','#a7ffeb','#00e676','📲'],
  ['pinterest','Pinterest','Social vermelho','#e60023','#ff8a80','#ffd1dc','📌'],
  ['amazon-dark','Amazon Dark','Loja premium','#ff9900','#232f3e','#f3a847','🛒']
];
const catalogEnabledPlatforms = new Set(['mercadolivre']);
function hasCatalog(){ return catalogEnabledPlatforms.has(currentPlatform); }

function setStatus(text){ $('status').textContent = text; }
async function loadCurrentUser(){
  try{
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if(!data.user){ location.href='/login.html'; return; }
    currentUser = data.user;
    const nameEl = $('userName');
    if(nameEl) nameEl.textContent = `${data.user.name} • ${data.user.email}`;
  }catch{ location.href='/login.html'; }
}
async function logout(){
  await fetch('/api/auth/logout', { method:'POST' });
  location.href='/login.html';
}
function platformLabel(id){ return platforms.find(p=>p[0]===id)?.[2] || id; }
function escapeHtml(s=''){ return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
function isSecretKey(key=''){ return /(TOKEN|SECRET|COOKIE|CSRF|KEY|ACCESS)/i.test(key); }
function keyHelp(key=''){
  const helps = {
    PORT: 'Porta local do painel. Use 3000 se não souber.',
    TELEGRAM_BOT_TOKEN: 'Token do bot criado no BotFather.',
    TELEGRAM_CHAT_ID: 'ID do usuário, grupo ou canal. Para canal, use @nomeDoCanal ou -100...',
    ML_COOKIE: 'Cookie da sessão do Mercado Livre para gerar links e acessar dados internos.',
    ML_CSRF_TOKEN: 'Token CSRF capturado da sessão do Mercado Livre.',
    ML_AFFILIATE_TAG: 'Sua tag de afiliado do Mercado Livre, exemplo: alexandreolivers.',
    SHOPEE_AFFILIATE_ID: 'Seu ID de afiliado Shopee. Normalmente é o mesmo App ID no painel afiliado.',
    SHOPEE_APP_ID: 'App ID da API oficial Shopee Afiliados/Open API.',
    SHOPEE_SECRET: 'Secret da API oficial Shopee Afiliados/Open API.',
    MAGALU_STORE_SLUG: 'Seu slug do Magazine Você. Exemplo: magazinepromozeraoficial. Fica salvo somente na sua conta.',
    WHATSAPP_PHONE_NUMBER_ID: 'ID do número na Meta WhatsApp Cloud API.',
    WHATSAPP_ACCESS_TOKEN: 'Token permanente ou temporário da Meta Cloud API.',
    WHATSAPP_TO: 'Número de destino com DDI e DDD. Exemplo: 5528999999999.',
    WHATSAPP_TEMPLATE_NAME: 'Nome do template aprovado na Meta. Exemplo: oferta_produto.',
    WHATSAPP_TEMPLATE_LANGUAGE: 'Idioma do template. Exemplo: pt_BR.',
  };
  return helps[key] || 'Configuração usada somente na sua conta.';
}


function playUiSound(type='click'){
  try{
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const theme = getTheme(selectedThemeId);
    const family = theme?.[0] || 'neon';
    const freq = type === 'success' ? (family.includes('whatsapp') ? 660 : family.includes('telegram') ? 820 : 740) : type === 'save' ? (family.includes('gold') ? 990 : 880) : family.includes('fire') ? 610 : 520;
    osc.frequency.value = freq;
    osc.type = family.includes('matrix') || family.includes('cyber') ? 'square' : family.includes('ice') || family.includes('mint') ? 'triangle' : 'sine';
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.045, audioCtx.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.13);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + 0.14);
  }catch{}
}
function getTheme(id){ return themes.find(t=>t[0]===id) || themes[0]; }
function applyTheme(id){
  selectedThemeId = id;
  const [,name,,accent,accent2,gold] = getTheme(id);
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent2', accent2);
  document.documentElement.style.setProperty('--gold', gold);
  document.documentElement.dataset.theme = id;
  document.body.dataset.theme = id;
  document.body.className = document.body.className.replace(/theme-[^\s]+/g, '').trim();
  document.body.classList.add('theme-' + id);
  setStatus(`Tema aplicado: ${name}. Clique em salvar para manter.`);
}
function renderTemplates(){
  const grid = $('templateGrid');
  if(!grid) return;
  grid.innerHTML = themes.map(([id,name,desc,accent,accent2,gold,emoji], i)=>`
    <article class="template-card ${id===selectedThemeId?'selected':''}" data-theme-id="${id}" style="animation-delay:${Math.min(i*0.02,.45)}s">
      <div class="template-preview" style="--p1:${accent};--p2:${accent2};--p3:${gold}">
        <div class="preview-sidebar"></div>
        <div class="preview-screen">
          <span></span><b></b><i></i>
        </div>
        <strong>${emoji}</strong>
      </div>
      <div class="template-info">
        <h3>${escapeHtml(name)}</h3>
        <p>${escapeHtml(desc)}</p>
        <button class="primary" type="button">Aplicar preview</button>
      </div>
    </article>`).join('');
  document.querySelectorAll('.template-card').forEach(card=>{
    card.onclick=()=>{
      playUiSound('click');
      applyTheme(card.dataset.themeId);
      renderTemplates();
    };
  });
}

function initNav(){
  $('platformNav').innerHTML = platforms.map(([id,icon,name]) => `<button class="nav-btn ${id===currentPlatform && currentView==='catalog'?'active':''}" data-platform="${id}">${icon} ${name}</button>`).join('');
  document.querySelectorAll('.nav-btn[data-platform]').forEach(btn => btn.onclick = () => switchPlatform(btn.dataset.platform));
  $('settingsNav')?.classList.toggle('active', currentView === 'settings');
  $('templatesNav')?.classList.toggle('active', currentView === 'templates');
  $('queueNav')?.classList.toggle('active', currentView === 'queue');
  $('autoNav')?.classList.toggle('active', currentView === 'auto');
  $('sentNav')?.classList.toggle('active', currentView === 'sent');
  $('licensesNav')?.classList.toggle('active', currentView === '__disabled_licenses__');
}
function showCatalog(){
  currentView = 'catalog';
  $('grid').classList.remove('hidden');
  $('settingsPage').classList.add('hidden');
  $('templatesPage')?.classList.add('hidden');
  $('queuePage')?.classList.add('hidden');
  $('autoPage')?.classList.add('hidden');
  $('sentPage')?.classList.add('hidden');
  $('licensesPage')?.classList.add('hidden');
  document.querySelector('.toolbar').classList.remove('hidden');
  document.querySelector('.filters').classList.remove('hidden');
  initNav();
}
function showSettings(){
  currentView = 'settings';
  history.replaceState(null,'','/?view=settings');
  $('grid').classList.add('hidden');
  $('settingsPage').classList.remove('hidden');
  $('templatesPage')?.classList.add('hidden');
  $('queuePage')?.classList.add('hidden');
  $('autoPage')?.classList.add('hidden');
  $('sentPage')?.classList.add('hidden');
  $('licensesPage')?.classList.add('hidden');
  document.querySelector('.toolbar').classList.add('hidden');
  document.querySelector('.filters').classList.add('hidden');
  $('pageTitle').textContent='Configurações';
  $('platformName').textContent='Conta';
  initNav();
  loadEnvSettings();
}

function showTemplates(){
  currentView = 'templates';
  history.replaceState(null,'','/?view=templates');
  $('grid').classList.add('hidden');
  $('settingsPage').classList.add('hidden');
  $('templatesPage')?.classList.remove('hidden');
  $('queuePage')?.classList.add('hidden');
  $('autoPage')?.classList.add('hidden');
  $('sentPage')?.classList.add('hidden');
  $('licensesPage')?.classList.add('hidden');
  document.querySelector('.toolbar').classList.add('hidden');
  document.querySelector('.filters').classList.add('hidden');
  $('manualLinkPanel')?.classList.add('hidden');
  $('pageTitle').textContent='Templates e Temas';
  $('platformName').textContent='Tema';
  renderTemplates();
  initNav();
}


function showQueue(){
  currentView = 'queue';
  history.replaceState(null,'','/?view=queue');
  $('grid').classList.add('hidden');
  $('settingsPage').classList.add('hidden');
  $('templatesPage')?.classList.add('hidden');
  $('queuePage')?.classList.remove('hidden');
  $('autoPage')?.classList.add('hidden');
  $('sentPage')?.classList.add('hidden');
  $('licensesPage')?.classList.add('hidden');
  document.querySelector('.toolbar').classList.add('hidden');
  document.querySelector('.filters').classList.add('hidden');
  $('manualLinkPanel')?.classList.add('hidden');
  $('mlPagination')?.classList.add('hidden');
  $('pageTitle').textContent='Fila de promoções';
  $('platformName').textContent='Fila';
  initNav();
  loadQueue();
}


function showAuto(){
  currentView = 'auto';
  history.replaceState(null,'','/?view=auto');
  $('grid').classList.add('hidden');
  $('settingsPage').classList.add('hidden');
  $('templatesPage')?.classList.add('hidden');
  $('queuePage')?.classList.add('hidden');
  $('autoPage')?.classList.remove('hidden');
  $('sentPage')?.classList.add('hidden');
  $('licensesPage')?.classList.add('hidden');
  document.querySelector('.toolbar').classList.add('hidden');
  document.querySelector('.filters').classList.add('hidden');
  $('manualLinkPanel')?.classList.add('hidden');
  $('mlPagination')?.classList.add('hidden');
  $('pageTitle').textContent='Gerar produtos automáticos';
  $('platformName').textContent='Relâmpago';
  initNav();
  renderAutoProducts();
}

function showSent(){
  currentView = 'sent';
  history.replaceState(null,'','/?view=sent');
  $('grid').classList.add('hidden');
  $('settingsPage').classList.add('hidden');
  $('templatesPage')?.classList.add('hidden');
  $('queuePage')?.classList.add('hidden');
  $('autoPage')?.classList.add('hidden');
  $('sentPage')?.classList.remove('hidden');
  $('licensesPage')?.classList.add('hidden');
  document.querySelector('.toolbar').classList.add('hidden');
  document.querySelector('.filters').classList.add('hidden');
  $('manualLinkPanel')?.classList.add('hidden');
  $('mlPagination')?.classList.add('hidden');
  $('pageTitle').textContent='Produtos enviados';
  $('platformName').textContent='Enviados';
  initNav();
  loadSentProducts();
}

function switchPlatform(id){
  currentPlatform=id;
  history.replaceState(null,'',`/?platform=${id}`);
  showCatalog();
  updateHeader();
  products=[];
  render();
  loadDefault();
}
function updateHeader(){
  if(currentView === 'settings') return;
  $('pageTitle').textContent=platformLabel(currentPlatform);
  $('platformName').textContent=platformLabel(currentPlatform).split(' ')[0];
  $('load20Btn').style.display=currentPlatform==='mercadolivre'?'block':'none';
  if (currentPlatform !== 'mercadolivre') {
    if ($('mlPagesDetected')) $('mlPagesDetected').textContent = '-';
    if ($('mlPagination')) $('mlPagination').classList.add('hidden');
  }
  $('manualLinkPanel')?.classList.toggle('hidden', hasCatalog());
  $('searchBtn').disabled = !hasCatalog();
  $('loadOffersBtn').disabled = !hasCatalog();
  $('searchInput').placeholder = hasCatalog() ? 'Pesquisar produto, categoria ou oferta...' : 'Catálogo automático desativado: cole um link abaixo';
}
function renderSkeleton(){ $('grid').innerHTML = Array.from({length:8}).map(()=>'<div class="skeleton"></div>').join(''); }

function productOriginalLink(product = {}) {
  return product.originalUrl || product.originalLink || product.rawLink || product.productUrl || product.urlOriginal || product.link || product.url || product.finalUrl || '';
}
async function convertMercadoLivreAffiliate(product = {}) {
  if ((product.platform || currentPlatform) !== 'mercadolivre') return product;
  if (product.affiliateConverted && product.finalUrl) return product;
  const originalUrl = productOriginalLink(product);
  if (!originalUrl) return product;
  try {
    const res = await fetch('/api/mercadolivre/converter-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: originalUrl })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Erro ao gerar link afiliado.');
    const affiliateLink = data.affiliateLink || data.affiliateUrl || data.shortUrl || data.short_url || data.url || data.link || '';
    if (!affiliateLink) throw new Error('Mercado Livre não retornou link afiliado.');
    return { ...product, originalUrl, originalLink: originalUrl, affiliateLink, finalUrl: affiliateLink, link: affiliateLink, url: affiliateLink, affiliateConverted: true };
  } catch (err) {
    setStatus('Mercado Livre afiliado: ' + err.message);
    return product;
  }
}
function normalizeLoadedProducts(list = []) {
  return (list || []).map((p, i) => ({
    ...p,
    platform: p.platform || currentPlatform,
    id: p.id || `${currentPlatform}-${i}-${btoa(unescape(encodeURIComponent(String(p.link || p.title || i)))).replace(/[^a-zA-Z0-9]/g,'').slice(0,12)}`,
    affiliateLink: p.affiliateLink || p.finalUrl || p.link || p.url || '',
    link: p.link || p.finalUrl || p.url || p.originalUrl || '',
    priceNumber: p.priceNumber || Number(String(p.price || '').replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',', '.')) || 0
  }));
}


function filtered(){
  let list = [...products];
  if(activeFilter==='discount') list = list.filter(p=>p.discount);
  if(activeFilter==='cheap') list.sort((a,b)=>(a.priceNumber||999999)-(b.priceNumber||999999));
  if(activeFilter==='expensive') list.sort((a,b)=>(b.priceNumber||0)-(a.priceNumber||0));
  return list;
}
function render(){
  const list = filtered();
  $('totalProducts').textContent = list.length;
  if(!list.length){ $('grid').innerHTML='<div class="glass" style="grid-column:1/-1;border-radius:24px;padding:30px;text-align:center;color:#9aa8c7">Nenhum produto carregado ainda.</div>'; renderMlPagination(); return; }
  $('grid').innerHTML = list.map((p,i)=>`
    <article class="card" style="animation-delay:${Math.min(i*0.015,.35)}s">
      ${p.discount ? `<div class="badge">-${escapeHtml(p.discount)}</div>`:''}
      <div class="imgbox"><img src="${escapeHtml(p.image || 'https://picsum.photos/seed/empty/700/700')}" loading="lazy" onerror="this.src='https://picsum.photos/seed/fallback/700/700'" /></div>
      <div class="content">
        <div class="title">${escapeHtml(p.title)}</div>
        <div class="price">${escapeHtml(p.price || 'Conferir no link')}</div>
        ${p.oldPrice ? `<div class="old">${escapeHtml(p.oldPrice)}</div>`:''}
        <div class="meta"><span>${escapeHtml(platformLabel(p.platform))}</span><span>${escapeHtml(p.source || '')}</span></div>
        <div class="actions">
          <button onclick="openCopy('${p.id}')" class="primary">Gerar copy</button>
          <a class="btn" href="${escapeHtml(p.affiliateLink || p.link)}" target="_blank">Abrir</a>
          <button onclick="quickTelegram('${p.id}')">Telegram</button>
          <button onclick="quickWhatsApp('${p.id}')">WhatsApp API</button>
          <button onclick="addToQueue('${p.id}')">Adicionar à fila</button>
          <button class="wide" onclick="quickPinterest('${p.id}')">Pinterest sem API</button>
        </div>
      </div>
    </article>`).join('');
}


function renderMlPagination(){
  const box = $('mlPagination');
  if (!box) return;

  if (currentPlatform !== 'mercadolivre' || !lastPagination || !lastPagination.detected) {
    box.classList.add('hidden');
    if ($('mlPagesDetected')) $('mlPagesDetected').textContent = '-';
    return;
  }

  const totalPages = Math.max(Number(lastPagination.totalPages || 1), 1);
  const currentPage = Math.min(Math.max(Number(lastPagination.currentPage || lastCatalogRequest.page || 1), 1), totalPages);

  if ($('mlPagesDetected')) $('mlPagesDetected').textContent = String(totalPages);

  const maxVisible = 10;
  let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let end = Math.min(totalPages, start + maxVisible - 1);
  start = Math.max(1, end - maxVisible + 1);

  const buttons = [];
  const pageMap = new Map((lastPagination.pages || []).map(p => [Number(p.page), p]));
  const getUrlArg = (page) => `'${encodeURIComponent(pageMap.get(Number(page))?.url || '')}'`;

  buttons.push(`<button ${currentPage <= 1 ? 'disabled' : ''} onclick="goMlPage(${currentPage - 1}, ${getUrlArg(currentPage - 1)})">&lt; anterior</button>`);
  for (let page = start; page <= end; page++) {
    buttons.push(`<button class="${page === currentPage ? 'active' : ''}" onclick="goMlPage(${page}, ${getUrlArg(page)})">${page}</button>`);
  }
  buttons.push(`<button ${currentPage >= totalPages ? 'disabled' : ''} onclick="goMlPage(${currentPage + 1}, ${getUrlArg(currentPage + 1)})">seguinte &gt;</button>`);

  box.innerHTML = `
    <div class="ml-pagination-info">
      <b>${totalPages}</b> páginas detectadas no Mercado Livre
      <span>Página atual: ${currentPage}</span>
    </div>
    <div class="ml-pagination-buttons">${buttons.join('')}</div>
  `;
  box.classList.remove('hidden');
}

function goMlPage(page, pageUrl = ''){
  pageUrl = pageUrl ? decodeURIComponent(pageUrl) : '';
  const totalPages = Math.max(Number(lastPagination?.totalPages || 1), 1);
  const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  fetchCatalog({ ...lastCatalogRequest, page: safePage, pageUrl }).catch(e=>setStatus(e.message));
}


async function fetchCatalog({q='', pages=1, onlyDiscount=false, source='', page=1, pageUrl=''}={}){
  showCatalog();
  updateHeader();
  renderSkeleton();
  setStatus(`Buscando em ${platformLabel(currentPlatform)}...`);
  const limit = $('limitSelect').value;
  const safePage = Math.max(Number(page || 1), 1);
  // O Mercado Livre pagina a lista usando _Desde_49, _Desde_97, etc.
  // Isso equivale a 48 itens por página, independente do limite escolhido no painel.
  const mlPageSize = 48;
  const offsetValue = (safePage - 1) * mlPageSize;
  lastCatalogRequest = { q, pages, onlyDiscount, source, page: safePage, pageUrl };
  let url = '';

  if (currentPlatform === 'mercadolivre') {
    const params = new URLSearchParams({
      q,
      limit,
      page: String(safePage),
      offset: String(offsetValue),
      sort: 'relevance'
    });
    if (source) params.set('source', source);
    if (pageUrl) params.set('pageUrl', pageUrl);
    if (pages) params.set('pages', String(pages));
    if (onlyDiscount) params.set('onlyDiscount', 'true');
    url = `/api/mercadolivre/catalogo?${params.toString()}`;
  } else {
    const params = new URLSearchParams({ q, limit, pages, onlyDiscount: String(onlyDiscount) });
    url = `/api/catalog/${currentPlatform}?${params.toString()}`;
  }

  const res = await fetch(url);
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || 'Erro ao buscar produtos');
  products = normalizeLoadedProducts(data.products || []);
  lastPagination = data.pagination || null;
  render();
  renderMlPagination();
  const pagesText = currentPlatform === 'mercadolivre' && lastPagination?.detected
    ? ` Página ${lastPagination.currentPage || safePage} de ${lastPagination.totalPages}.`
    : '';
  setStatus(`${products.length} produtos carregados em ${platformLabel(currentPlatform)}.${pagesText}`);
}
async function loadDefault(){
  if (!hasCatalog()) {
    products = [];
    render();
    setStatus(platformLabel(currentPlatform) + ': cole um link do produto para converter em afiliado e gerar post.');
    return;
  }
  const q = $('searchInput').value.trim();
  const options = currentPlatform === 'mercadolivre' && !q
    ? { q: '', source: 'ofertas', onlyDiscount: true }
    : { q };
  await fetchCatalog(options).catch(e=>{setStatus(e.message); render();});
}

async function createProductFromManualLink(){
  const url = $('manualProductLink').value.trim();
  if (!url) { setStatus('Cole o link do produto primeiro.'); return; }
  setStatus('Convertendo link em afiliado e lendo dados do produto...');
  const res = await fetch(`/api/link-product/${currentPlatform}`, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body: JSON.stringify({ url })
  });
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || 'Erro ao converter link.');
  const product = normalizeLoadedProducts([data.product])[0];
  products = [product, ...products.filter(p => p.link !== product.link)];
  render();
  setStatus('Link carregado. Agora gere a copy ou envie para Telegram, WhatsApp ou Pinterest.');
}

async function makeCopy(product){
  const res = await fetch('/api/copy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({product})});
  const data = await res.json();
  return data.copy;
}

function productShareLink(product = {}) {
  return product.affiliateLink || product.finalUrl || product.link || product.url || productOriginalLink(product) || '';
}
function whatsappShareUrl(text = '') {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
function pinterestShareUrl(product = {}, copy = '') {
  const url = productShareLink(product);
  const media = product.image || '';
  const description = copy || `${product.title || 'Oferta'} ${url}`.trim();
  const params = new URLSearchParams({ url, description });
  if (media) params.set('media', media);
  return `https://www.pinterest.com/pin/create/button/?${params.toString()}`;
}
function openShare(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}
window.openCopy = async id => {
  selectedProduct = products.find(p=>p.id===id);
  if(!selectedProduct) return;
  selectedProduct = await convertMercadoLivreAffiliate(selectedProduct);
  products = products.map(p => p.id === id ? selectedProduct : p);
  render();
  $('copyText').value = await makeCopy(selectedProduct);
  if ($('openWhats')) $('openWhats').href = whatsappShareUrl($('copyText').value);
  $('modal').classList.remove('hidden');
};
window.quickTelegram = async id => { selectedProduct = products.find(p=>p.id===id); if(!selectedProduct) return; selectedProduct = await convertMercadoLivreAffiliate(selectedProduct); const copy = await makeCopy(selectedProduct); await sendTelegram(selectedProduct, copy); };
window.quickWhatsApp = async id => { selectedProduct = products.find(p=>p.id===id); if(!selectedProduct) return; selectedProduct = await convertMercadoLivreAffiliate(selectedProduct); const copy = await makeCopy(selectedProduct); await sendWhatsApp(selectedProduct, copy); };
window.quickPinterest = async id => { selectedProduct = products.find(p=>p.id===id); if(!selectedProduct) return; selectedProduct = await convertMercadoLivreAffiliate(selectedProduct); const copy = await makeCopy(selectedProduct); openShare(pinterestShareUrl(selectedProduct, copy)); setStatus('Pinterest aberto sem API para criar o Pin manualmente.'); };
async function sendTelegram(product, copy){
  setStatus('Enviando para Telegram...');
  const res = await fetch('/api/telegram/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({product,copy})});
  const data = await res.json();
  setStatus(data.ok ? 'Enviado para Telegram com sucesso.' : `Telegram: ${data.error}`); if(data.ok) playUiSound('success');
}
async function sendWhatsApp(product, copy){
  setStatus('Enviando para WhatsApp via API...');
  const res = await fetch('/api/whatsapp/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({product,copy})});
  const data = await res.json();
  setStatus(data.ok ? `Enviado para WhatsApp com sucesso (${data.mode || 'api'}).` : `WhatsApp: ${data.error}`);
  if(data.ok) playUiSound('success');
}
window.addToQueue = async id => {
  let product = products.find(p=>p.id===id);
  if(!product) return;
  product = await convertMercadoLivreAffiliate(product);
  const copy = await makeCopy(product);
  const res = await fetch('/api/queue/add',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({product,copy})});
  const data = await res.json();
  setStatus(data.ok ? 'Produto adicionado à fila persistente.' : `Fila: ${data.error}`);
  if(data.ok) playUiSound('save');
};
async function sendPinterest(product, copy){
  openShare(pinterestShareUrl(product, copy));
  setStatus('Pinterest aberto sem API para criar o Pin manualmente.');
}



function lightningCopy(product = {}){
  const link = productShareLink(product);
  return [
    '⚡ PROMOÇÃO RELÂMPAGO NO MERCADO LIVRE! ⚡',
    '',
    product.title || 'Produto em oferta relâmpago',
    product.price ? `🔥 Por: ${product.price}` : '',
    product.oldPrice ? `Antes: ${product.oldPrice}` : '',
    product.discount ? `✅ Desconto: ${product.discount}` : '',
    '',
    '⏰ Atenção: essa promoção relâmpago pode acabar em poucas horas ou quando o estoque terminar.',
    link ? `🛒 Garanta aqui: ${link}` : '',
    '',
    '#MercadoLivre #PromoçãoRelâmpago #Oferta'
  ].filter(Boolean).join('\n');
}
function renderAutoProducts(){
  const box = $('autoGrid');
  if(!box) return;
  $('autoCount').textContent = String(autoProducts.length);
  if(!autoProducts.length){ box.innerHTML = '<div class="glass empty-list" style="grid-column:1/-1">Clique em Buscar relâmpagos para carregar promoções automáticas do Mercado Livre.</div>'; return; }
  box.innerHTML = autoProducts.map((p,i)=>`
    <article class="card auto-card" style="animation-delay:${Math.min(i*0.015,.35)}s">
      <div class="badge">⚡ RELÂMPAGO</div>
      <div class="imgbox"><img src="${escapeHtml(p.image || 'https://picsum.photos/seed/lightning/700/700')}" loading="lazy" onerror="this.src='https://picsum.photos/seed/lightningfallback/700/700'" /></div>
      <div class="content">
        <div class="title">${escapeHtml(p.title || 'Produto')}</div>
        <div class="price">${escapeHtml(p.price || 'Conferir no link')}</div>
        ${p.oldPrice ? `<div class="old">${escapeHtml(p.oldPrice)}</div>`:''}
        <div class="meta"><span>Mercado Livre</span><span>Promoção relâmpago</span></div>
        <div class="actions">
          <button onclick="addAutoToQueue('${p.id}')" class="primary">Adicionar à fila</button>
          <button onclick="sendAutoNow('${p.id}')">Enviar agora</button>
          <a class="btn wide" href="${escapeHtml(productShareLink(p))}" target="_blank">Abrir oferta</a>
        </div>
      </div>
    </article>`).join('');
}
async function fetchAutoLightning(){
  showAuto();
  $('autoGrid').innerHTML = Array.from({length:8}).map(()=>'<div class="skeleton"></div>').join('');
  setStatus('Buscando promoções relâmpago do Mercado Livre...');
  const url = '/api/mercadolivre/catalogo?source=relampago&limit=80&page=1&onlyDiscount=true';
  const res = await fetch(url);
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || 'Erro ao buscar relâmpagos');
  autoProducts = normalizeLoadedProducts(data.products || []).map(p => ({...p, platform:'mercadolivre', lightning:true, source:'Promoção relâmpago ML'}));
  for (const p of autoProducts) p.copy = lightningCopy(p);
  renderAutoProducts();
  setStatus(`${autoProducts.length} promoções relâmpago carregadas.`);
  playUiSound('success');
}
window.addAutoToQueue = async id => {
  let product = autoProducts.find(p=>p.id===id);
  if(!product) return;
  product = await convertMercadoLivreAffiliate(product);
  const copy = lightningCopy(product);
  const res = await fetch('/api/queue/add',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({product,copy})});
  const data = await res.json();
  setStatus(data.ok ? 'Relâmpago adicionado à fila com copy especial.' : `Fila: ${data.error}`);
  if(data.ok) playUiSound('save');
};
window.sendAutoNow = async idOrProduct => {
  let product = typeof idOrProduct === 'object' ? idOrProduct : autoProducts.find(p=>p.id===idOrProduct);
  if(!product) return;
  product = await convertMercadoLivreAffiliate(product);
  const copy = lightningCopy(product);
  const channels = [];
  if($('autoTelegram')?.checked) channels.push('telegram');
  if($('autoWhatsApp')?.checked) channels.push('whatsapp');
  if(!channels.length){ setStatus('Selecione Telegram, WhatsApp ou os dois.'); return; }
  if(channels.includes('telegram')) await sendTelegram(product, copy);
  if(channels.includes('whatsapp')) await sendWhatsApp(product, copy);
};
async function addAllAutoToQueue(){
  if(!autoProducts.length){ await fetchAutoLightning(); }
  let added = 0;
  for (let product of autoProducts) {
    product = await convertMercadoLivreAffiliate(product);
    const copy = lightningCopy(product);
    const res = await fetch('/api/queue/add',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({product,copy})});
    const data = await res.json();
    if(data.ok) added++;
  }
  setStatus(`${added} promoções relâmpago foram adicionadas à fila persistente.`);
  playUiSound('save');
}
async function sendNextAuto(){
  if(!autoProducts.length) await fetchAutoLightning();
  const product = autoProducts.shift();
  renderAutoProducts();
  if(!product){ stopAutoSend(); return; }
  await window.sendAutoNow(product);
}
async function startAutoSend(){
  const minutes = Math.max(Number($('autoInterval')?.value || 5), 1);
  if(!autoProducts.length) await fetchAutoLightning();
  await addAllAutoToQueue();
  if($('queueInterval')) $('queueInterval').value = String(minutes);
  if($('queueTelegram')) $('queueTelegram').checked = !!$('autoTelegram')?.checked;
  if($('queueWhatsApp')) $('queueWhatsApp').checked = !!$('autoWhatsApp')?.checked;
  startQueueAuto();
  $('autoStatus').textContent = `Automático ligado via fila persistente: 1 relâmpago a cada ${minutes} min.`;
  setStatus(`Relâmpagos adicionados à fila e envio automático ativado a cada ${minutes} minutos.`);
  playUiSound('save');
}
function stopAutoSend(show=true){
  stopQueueAuto(false);
  autoRunning = false;
  if($('autoStatus')) $('autoStatus').textContent = 'Automático desligado.';
  if(show) setStatus('Envio automático de relâmpagos pausado.');
}

async function loadQueue(){
  const res = await fetch('/api/queue');
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || 'Erro ao carregar fila');
  renderQueue(data.items || []);
  $('queueCount').textContent = String((data.items || []).length);
}
function renderQueue(items){
  const box = $('queueList');
  if(!box) return;
  if(!items.length){ box.innerHTML = '<div class="glass empty-list">Fila vazia. Adicione produtos pelos cards.</div>'; return; }
  box.innerHTML = items.map(item=>`
    <article class="queue-item glass">
      <img src="${escapeHtml(item.image || 'https://picsum.photos/seed/queue/200/200')}" onerror="this.src='https://picsum.photos/seed/queuefallback/200/200'" />
      <div><b>${escapeHtml(item.title || 'Produto')}</b><span>${escapeHtml(item.price || '')} • ${escapeHtml(platformLabel(item.platform || ''))}</span><small>${escapeHtml(item.copy || '')}</small></div>
      <button onclick="removeQueueItem(${Number(item.id)})">Remover</button>
    </article>`).join('');
}
window.removeQueueItem = async id => {
  const res = await fetch(`/api/queue/${id}`, { method:'DELETE' });
  const data = await res.json();
  setStatus(data.ok ? 'Produto removido da fila.' : 'Não foi possível remover da fila.');
  loadQueue();
};
async function loadSentProducts(){
  const res = await fetch('/api/sent-products');
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || 'Erro ao carregar enviados');
  const items = data.items || [];
  $('sentList').innerHTML = items.length ? items.map(item=>`
    <article class="queue-item glass sent-item">
      <img src="${escapeHtml(item.image || 'https://picsum.photos/seed/sent/200/200')}" onerror="this.src='https://picsum.photos/seed/sentfallback/200/200'" />
      <div><b>${escapeHtml(item.title || 'Produto')}</b><span>${escapeHtml(item.price || '')} • ${escapeHtml((item.channels || []).join(' + '))}</span><small>Enviado em ${escapeHtml(new Date(item.sent_at || item.updated_at || Date.now()).toLocaleString('pt-BR'))}</small></div>
    </article>`).join('') : '<div class="glass empty-list">Nenhum produto enviado ainda.</div>';
}
async function sendNextQueue(){
  const channels = [];
  if($('queueTelegram')?.checked) channels.push('telegram');
  if($('queueWhatsApp')?.checked) channels.push('whatsapp');
  if(!channels.length){ setStatus('Selecione Telegram, WhatsApp ou os dois.'); return; }
  setStatus('Enviando próximo produto da fila...');
  const res = await fetch('/api/queue/send-next',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({channels})});
  const data = await res.json();
  if(data.empty){ setStatus('Fila vazia.'); stopQueueAuto(); }
  else setStatus(data.ok ? 'Produto enviado e movido para Produtos enviados.' : `Fila: ${data.error}`);
  await loadQueue();
}
function startQueueAuto(){
  const minutes = Math.max(Number($('queueInterval')?.value || 5), 1);
  stopQueueAuto(false);
  queueRunning = true;
  queueTimer = setInterval(()=>sendNextQueue().catch(e=>setStatus(e.message)), minutes * 60 * 1000);
  $('queueAutoStatus').textContent = `Automático ligado: 1 promoção a cada ${minutes} min.`;
  setStatus(`Fila automática ativada a cada ${minutes} minutos.`);
}
function stopQueueAuto(show=true){
  if(queueTimer) clearInterval(queueTimer);
  queueTimer = null;
  queueRunning = false;
  if($('queueAutoStatus')) $('queueAutoStatus').textContent = 'Automático desligado.';
  if(show) setStatus('Fila automática pausada.');
}

async function loadEnvSettings(){
  setStatus('Carregando configurações da sua conta...');
  $('envForms').innerHTML = '<div class="skeleton settings-skeleton"></div><div class="skeleton settings-skeleton"></div>';
  const res = await fetch('/api/settings/env');
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || 'Erro ao carregar configurações');
  envGroups = data.groups || [];
  envValues = data.values || {};
  renderEnvSettings();
  setStatus('Configurações carregadas.');
}
function renderEnvSettings(){
  $('envForms').innerHTML = envGroups.map(group => `
    <div class="env-card glass">
      <h3>${escapeHtml(group.title)}</h3>
      <div class="env-fields">
        ${(group.keys || []).map(key => `
          <label class="env-field">
            <span>${escapeHtml(key)}</span>
            <input data-env-key="${escapeHtml(key)}" type="${isSecretKey(key) ? 'password' : 'text'}" value="${escapeHtml(envValues[key] || '')}" placeholder="Cole aqui..." autocomplete="off" />
            <small>${escapeHtml(keyHelp(key))}</small>
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');
}
async function saveEnvSettings(){
  const values = {};
  document.querySelectorAll('[data-env-key]').forEach(input => values[input.dataset.envKey] = input.value);
  setStatus('Salvando configurações na sua conta...');
  const res = await fetch('/api/settings/env',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({values})});
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || 'Erro ao salvar configurações');
  envValues = data.values || values;
  renderEnvSettings();
  setStatus('Configurações salvas na sua conta. As integrações já usam os novos valores.');
}



function showLicenses(){
  currentView = '__disabled_licenses__';
  history.replaceState(null,'','/?view=licenses');
  $('grid').classList.add('hidden');
  $('settingsPage').classList.add('hidden');
  $('templatesPage')?.classList.add('hidden');
  $('queuePage')?.classList.add('hidden');
  $('autoPage')?.classList.add('hidden');
  $('sentPage')?.classList.add('hidden');
  $('licensesPage')?.classList.remove('hidden');
  document.querySelector('.toolbar').classList.add('hidden');
  document.querySelector('.filters').classList.add('hidden');
  $('manualLinkPanel')?.classList.add('hidden');
  $('mlPagination')?.classList.add('hidden');
  $('pageTitle').textContent='Venda de Licenças';
  $('platformName').textContent='Admin';
  initNav();
  loadLicenses().catch(e=>setStatus(e.message));
}
async function loadLicenses(){
  const res = await fetch('/api/admin/licenses');
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || 'Erro ao carregar licenças');
  const list = data.licenses || [];
  $('licenseCount').textContent = list.length;
  $('licenseOnlineCount').textContent = `${list.filter(x=>x.online).length} online`;
  $('licensesList').innerHTML = list.length ? list.map(lic=>`
    <article class="queue-item glass license-item ${lic.online?'online':'offline'}">
      <div class="license-key-box">
        <b>${escapeHtml(lic.key)}</b>
        <small>${escapeHtml(lic.clientName || 'Sem cliente')} • ${escapeHtml(lic.status.toUpperCase())}</small>
        <small>IP: ${escapeHtml(lic.lastIp || 'OFFLINE')} • Última verificação: ${lic.lastCheckAt ? escapeHtml(new Date(lic.lastCheckAt).toLocaleString('pt-BR')) : 'Nunca'}</small>
      </div>
      <div class="license-edit-row">
        <input value="${escapeHtml(lic.clientName || '')}" data-client="${lic.id}" placeholder="Cliente" />
        <input type="datetime-local" value="${lic.expiresAt ? new Date(lic.expiresAt).toISOString().slice(0,16) : ''}" data-expires="${lic.id}" />
      </div>
      <div class="queue-actions">
        <button onclick="copyLicense('${escapeHtml(lic.key)}')">Copiar</button>
        <button onclick="saveLicense(${lic.id})" class="primary">Salvar</button>
        <button onclick="toggleLicense(${lic.id}, ${lic.blocked ? 'false' : 'true'})">${lic.blocked ? 'Desbloquear' : 'Bloquear'}</button>
        <button onclick="deleteLicense(${lic.id})">Apagar</button>
      </div>
    </article>`).join('') : '<div class="glass empty-list">Nenhuma licença criada ainda.</div>';
}
async function createLicense(){
  const body = { clientName: $('licenseClient')?.value || '', expiresAt: $('licenseExpires')?.value || '' };
  const res = await fetch('/api/admin/licenses',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || 'Erro ao criar licença');
  $('licenseClient').value='';
  setStatus('Licença criada. Copie e envie para o Agent do cliente.');
  loadLicenses();
}
window.copyLicense = async key => { await navigator.clipboard.writeText(key); setStatus('Licença copiada.'); };
window.saveLicense = async id => {
  const body = { clientName: document.querySelector(`[data-client="${id}"]`)?.value || '', expiresAt: document.querySelector(`[data-expires="${id}"]`)?.value || '' };
  const res = await fetch(`/api/admin/licenses/${id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data = await res.json(); setStatus(data.ok ? 'Licença atualizada.' : data.error); loadLicenses();
};
window.toggleLicense = async (id, blocked) => {
  const res = await fetch(`/api/admin/licenses/${id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({blocked})});
  const data = await res.json(); setStatus(data.ok ? (blocked?'Licença bloqueada.':'Licença desbloqueada.') : data.error); loadLicenses();
};
window.deleteLicense = async id => { if(!confirm('Apagar esta licença?')) return; await fetch(`/api/admin/licenses/${id}`,{method:'DELETE'}); setStatus('Licença apagada.'); loadLicenses(); };
setInterval(()=>{ if(currentView==='__disabled_licenses__') loadLicenses().catch(()=>{}); }, 5000);

$('logoutBtn')?.addEventListener('click', logout);
$('templatesNav')?.addEventListener('click', showTemplates);
$('settingsNav')?.addEventListener('click', showSettings);
$('queueNav')?.addEventListener('click', showQueue);
$('autoNav')?.addEventListener('click', showAuto);
$('sentNav')?.addEventListener('click', showSent);
$('licensesNav')?.addEventListener('click', showLicenses);
$('createLicenseBtn')?.addEventListener('click', () => createLicense().catch(e=>setStatus(e.message)));
$('refreshLicensesBtn')?.addEventListener('click', () => loadLicenses().catch(e=>setStatus(e.message)));
$('saveThemeBtn')?.addEventListener('click', () => { localStorage.setItem('afiliadoProTheme', selectedThemeId); playUiSound('save'); setStatus('Tema salvo. Ele será mantido ao abrir o painel novamente.'); renderTemplates(); });
$('saveEnvBtn')?.addEventListener('click', () => saveEnvSettings().catch(e=>setStatus(e.message)));
$('searchBtn').onclick = () => fetchCatalog({q:$('searchInput').value.trim()}).catch(e=>setStatus(e.message));
$('manualLinkBtn')?.addEventListener('click', () => createProductFromManualLink().catch(e=>setStatus(e.message)));
$('manualProductLink')?.addEventListener('keydown', e=>{ if(e.key==='Enter') $('manualLinkBtn').click(); });
$('loadOffersBtn').onclick = () => fetchCatalog(currentPlatform === 'mercadolivre' ? {q:'', source:'ofertas', onlyDiscount:true} : {q:'', onlyDiscount:true}).catch(e=>setStatus(e.message));
$('load20Btn').onclick = () => { currentPlatform='mercadolivre'; initNav(); updateHeader(); fetchCatalog({q:'', source:'ofertas', pages:20, onlyDiscount:true}).catch(e=>setStatus(e.message)); };
$('searchInput').addEventListener('keydown', e=>{ if(e.key==='Enter') $('searchBtn').click(); });
document.querySelectorAll('.chip').forEach(chip=> chip.onclick=()=>{document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));chip.classList.add('active');activeFilter=chip.dataset.filter;render();});
$('closeModal').onclick=()=>$('modal').classList.add('hidden');
$('copyClipboard').onclick=async()=>{await navigator.clipboard.writeText($('copyText').value);setStatus('Copy copiada.');};
$('sendTelegram').onclick=async()=>{ if(!selectedProduct) return; selectedProduct = await convertMercadoLivreAffiliate(selectedProduct); sendTelegram(selectedProduct,$('copyText').value); };
$('sendWhatsApp')?.addEventListener('click', async()=>{ if(!selectedProduct) return; selectedProduct = await convertMercadoLivreAffiliate(selectedProduct); sendWhatsApp(selectedProduct,$('copyText').value); });
$('sendPinterest').onclick=async()=>{ if(!selectedProduct) return; selectedProduct = await convertMercadoLivreAffiliate(selectedProduct); sendPinterest(selectedProduct,$('copyText').value); };
$('sendNextQueueBtn')?.addEventListener('click', () => sendNextQueue().catch(e=>setStatus(e.message)));
$('startQueueBtn')?.addEventListener('click', startQueueAuto);
$('stopQueueBtn')?.addEventListener('click', () => stopQueueAuto(true));
$('autoFetchBtn')?.addEventListener('click', () => fetchAutoLightning().catch(e=>setStatus(e.message)));
$('autoQueueAllBtn')?.addEventListener('click', () => addAllAutoToQueue().catch(e=>setStatus(e.message)));
$('autoStartBtn')?.addEventListener('click', () => startAutoSend().catch(e=>setStatus(e.message)));
$('autoStopBtn')?.addEventListener('click', () => stopAutoSend(true));

async function boot(){
  await loadCurrentUser();
  applyTheme(selectedThemeId);
  initNav();
  if(currentView === 'settings') showSettings(); else if(currentView === 'templates') showTemplates(); else if(currentView === 'queue') showQueue(); else if(currentView === 'auto') showAuto(); else if(currentView === 'sent') showSent(); else if(currentView === '__disabled_licenses__') showLicenses(); else { updateHeader(); loadDefault(); }
}
boot();
