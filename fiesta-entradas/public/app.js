// Código compartido: PIN, llamadas a la API y utilidades.
const PIN_KEY = 'fiesta_pin';
const getPin = () => { try { return localStorage.getItem(PIN_KEY) || ''; } catch { return ''; } };
const setPin = (p) => { try { localStorage.setItem(PIN_KEY, p); } catch {} };
const clearPin = () => { try { localStorage.removeItem(PIN_KEY); } catch {} };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(3, '0');
const hora = (iso) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

function mostrarLogin() {
  document.getElementById('login')?.classList.remove('hidden');
  setTimeout(() => document.getElementById('pinInput')?.focus(), 50);
}

async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-pin': getPin() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    clearPin();
    mostrarLogin();
    throw new Error('PIN incorrecto o caducado');
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

async function comprobarPin(pin) {
  const r = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  if (!r.ok) return null;
  return (await r.json()).rol;
}

// Muestra el login si hace falta y llama a onReady(rol) cuando el PIN es correcto.
async function requireLogin(onReady) {
  const overlay = document.getElementById('login');
  const form = document.getElementById('loginForm');
  const input = document.getElementById('pinInput');
  const err = document.getElementById('loginError');
  let listo = false;
  const arrancar = (rol) => {
    overlay.classList.add('hidden');
    if (!listo) { listo = true; onReady(rol); }
  };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    const pin = input.value.trim();
    const rol = await comprobarPin(pin).catch(() => null);
    if (!rol) { err.textContent = 'PIN incorrecto'; input.select(); return; }
    setPin(pin);
    input.value = '';
    arrancar(rol);
  });

  const guardado = getPin();
  const rol = guardado ? await comprobarPin(guardado).catch(() => null) : null;
  if (rol) arrancar(rol);
  else { clearPin(); mostrarLogin(); }

  document.getElementById('logout')?.addEventListener('click', () => { clearPin(); location.reload(); });
}

async function cargarConfig() {
  try {
    const c = await (await fetch('/api/config')).json();
    document.querySelectorAll('[data-evento]').forEach((el) => (el.textContent = c.evento));
    document.title = `${document.title} · ${c.evento}`;
  } catch {}
}
cargarConfig();
