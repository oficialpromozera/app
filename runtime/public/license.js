const $ = id => document.getElementById(id);

function renderStatus(d = {}) {
  $('adminServer').textContent = d.adminServer || 'http://localhost:3001';
  $('licenseStatus').textContent = `${(d.status || 'offline').toUpperCase()} • ${d.message || 'Não foi possível verificar agora.'}`;
  $('licenseStatus').className = 'license-status ' + (d.ok ? 'ok' : 'bad');
  if (d.ok && d.status === 'active') location.href = '/';
}

async function status() {
  try {
    const r = await fetch('/api/license/status', { cache: 'no-store' });
    const d = await r.json();
    renderStatus(d);
  } catch (err) {
    renderStatus({ ok: false, status: 'offline', message: 'Falha ao conversar com o Agent local.' });
  }
}

async function activate() {
  const key = $('licenseKey').value.trim();
  if (!key) return renderStatus({ ok: false, status: 'missing', message: 'Informe uma licença.' });

  $('activateBtn').disabled = true;
  $('licenseStatus').textContent = 'Verificando...';
  $('licenseStatus').className = 'license-status';

  try {
    const r = await fetch('/api/license/activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key })
    });
    const d = await r.json();
    renderStatus(d);
  } catch (err) {
    renderStatus({ ok: false, status: 'offline', message: 'Falha ao verificar. Confirme se o Admin está aberto na porta 3001.' });
  } finally {
    $('activateBtn').disabled = false;
  }
}

$('activateBtn').onclick = activate;
$('licenseKey').addEventListener('keydown', e => { if (e.key === 'Enter') activate(); });
status();
setInterval(status, 5000);
