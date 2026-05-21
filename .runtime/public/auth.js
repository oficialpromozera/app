const form = document.querySelector('form');
const errorBox = document.getElementById('authError');

function showError(message) {
  errorBox.textContent = message || '';
}

async function submitAuth(endpoint, payload) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro ao autenticar.');
  location.href = '/';
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const data = Object.fromEntries(new FormData(form).entries());
  const endpoint = form.id === 'registerForm' ? '/api/auth/register' : '/api/auth/login';
  try {
    await submitAuth(endpoint, data);
  } catch (err) {
    showError(err.message);
  }
});
