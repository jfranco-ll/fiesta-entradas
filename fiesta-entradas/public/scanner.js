const $ = (id) => document.getElementById(id);
const overlay = $('overlay');
const ovInner = $('ovInner');

let qr = null;
let ocupado = false;
let ultimo = { codigo: '', t: 0 };
let cierreAuto = null;
let audio = null;

// ───── Sonido y vibración ─────
function pitido(tipo) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const notas = tipo === 'ok' ? [[880, 0], [1320, 0.12]] : [[180, 0], [140, 0.18]];
    notas.forEach(([f, d]) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = tipo === 'ok' ? 'sine' : 'square';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.25, audio.currentTime + d);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + d + 0.16);
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + d);
      o.stop(audio.currentTime + d + 0.17);
    });
  } catch {}
  try { navigator.vibrate?.(tipo === 'ok' ? 120 : [250, 100, 250]); } catch {}
}

// Mantiene la pantalla encendida mientras se escanea
let wakeLock = null;
async function pantallaEncendida() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && qr) pantallaEncendida();
});

function pintarStats(s) {
  if (!s) return;
  $('stDentro').textContent = s.dentro;
  $('stVendidas').textContent = s.vendidas;
}
async function refrescarStats() {
  try { pintarStats(await api('/api/stats')); } catch {}
}

// ───── Resultado a pantalla completa ─────
function mostrar(r) {
  clearTimeout(cierreAuto);
  const e = r.entrada;
  let clase = r.estado;
  let html = '';

  if (r.estado === 'ok') {
    const primera = e.tipo === 'primera';
    html = `
      <div class="ov-title">✅ ADELANTE</div>
      <div class="ov-name">${esc(e.nombre)}</div>
      <div class="ov-sub">Entrada nº ${pad(e.numero)}</div>
      <div class="ov-tipo ${e.tipo}">
        ${primera ? '🥃 COPA + CHUPITO' : '🍹 SOLO COPA'}
        <small>${primera ? 'Dale ticket de copa y ticket de chupito' : 'Dale solo ticket de copa'}</small>
      </div>
      ${r.manual ? '<div class="ov-sub">⚠️ Validada a mano: comprueba el nombre con su DNI</div>' : ''}
      <div class="ov-tap">Toca para seguir</div>`;
    pitido('ok');
    cierreAuto = setTimeout(cerrar, r.manual ? 8000 : 4500);
  } else if (r.estado === 'usada') {
    html = `
      <div class="ov-title">⛔ YA USADA</div>
      <div class="ov-name">${esc(e.nombre)}</div>
      <div class="ov-sub">Entrada nº ${pad(e.numero)} · ${esc(e.etiqueta)}</div>
      <div class="ov-sub">Entró a las <b>${hora(e.usada_en)}</b></div>
      <div class="ov-tap">No dejar pasar · toca para seguir</div>`;
    pitido('mal');
  } else if (r.estado === 'invalida') {
    html = `
      <div class="ov-title">❌ NO VÁLIDA</div>
      <div class="ov-sub">Este código no es una entrada de la fiesta (o ha sido borrada).</div>
      <div class="ov-tap">No dejar pasar · toca para seguir</div>`;
    pitido('mal');
  } else {
    clase = 'error';
    html = `
      <div class="ov-title">⚠️ ERROR</div>
      <div class="ov-sub">${esc(r.mensaje || 'No se pudo comprobar')}</div>
      <div class="ov-sub">Revisa la conexión a internet y vuelve a escanear.</div>
      <div class="ov-tap">Toca para seguir</div>`;
    pitido('mal');
  }

  overlay.className = `overlay ${clase}`;
  ovInner.innerHTML = html;
}

function cerrar() {
  clearTimeout(cierreAuto);
  overlay.classList.add('hidden');
  ocupado = false;
  ultimo.t = Date.now(); // evita re-leer el mismo QR justo al cerrar
  try { qr?.resume(); } catch {}
}
overlay.addEventListener('click', cerrar);

async function comprobar(codigo) {
  ocupado = true;
  try { qr?.pause(true); } catch {}
  try {
    const r = await api('/api/escanear', { method: 'POST', body: { codigo } });
    mostrar(r);
    if (r.stats) pintarStats(r.stats);
  } catch (e) {
    mostrar({ estado: 'error', mensaje: e.message });
  }
}

function alLeer(texto) {
  const ahora = Date.now();
  if (ocupado) return;
  if (texto === ultimo.codigo && ahora - ultimo.t < 3000) return;
  ultimo = { codigo: texto, t: ahora };
  comprobar(texto);
}

// ───── Cámara ─────
async function empezar() {
  $('btnStart').disabled = true;
  $('camMsg').textContent = 'Abriendo cámara…';
  // Crea el audio con el toque del usuario (si no, iOS no deja sonar los pitidos)
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch {}
  try {
    qr = qr || new Html5Qrcode('reader', { verbose: false });
    await qr.start(
      { facingMode: 'environment' },
      {
        fps: 12,
        aspectRatio: 1,
        qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.72); return { width: s, height: s }; },
      },
      alLeer,
      () => {}
    );
    $('readerEmpty').classList.add('hidden');
    pantallaEncendida();
  } catch (e) {
    qr = null;
    $('btnStart').disabled = false;
    $('camMsg').textContent = 'No se pudo abrir la cámara. Da permiso a la cámara en el navegador y vuelve a intentarlo.';
    console.error(e);
  }
}
$('btnStart').addEventListener('click', empezar);

$('formManual').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const v = $('manualInput').value.trim();
  if (!v || ocupado) return;
  $('manualInput').value = '';
  $('manualInput').blur();
  comprobar(v);
});

requireLogin((rol) => {
  if (rol === 'taquilla') $('linkTaquilla').classList.remove('hidden');
  refrescarStats();
  setInterval(() => { if (!document.hidden) refrescarStats(); }, 20000);
});
