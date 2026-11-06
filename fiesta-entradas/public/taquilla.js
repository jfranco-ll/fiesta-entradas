const $ = (id) => document.getElementById(id);
const form = $('formEntrada');
const btnCrear = $('btnCrear');
const lista = $('lista');
const buscar = $('buscar');

const badge = (tipo) =>
  tipo === 'primera'
    ? '<span class="badge primera">COPA + CHUPITO</span>'
    : '<span class="badge normal">COPA</span>';

function pintarStats(s) {
  $('stVendidas').textContent = s.vendidas;
  $('stPrimeras').textContent = s.primerasRestantes;
  $('stDentro').textContent = s.dentro;
  $('siguiente').innerHTML =
    s.primerasRestantes > 0
      ? `La siguiente entrada será <b>COPA + CHUPITO</b> · quedan ${s.primerasRestantes} de ${s.limite}`
      : 'Ya se acabaron las de chupito · la siguiente será <b>COPA</b>';
}

function pintarLista(entradas) {
  if (!entradas.length) {
    lista.innerHTML = `<p class="muted">${buscar.value ? 'No hay resultados.' : 'Todavía no hay entradas.'}</p>`;
    return;
  }
  lista.innerHTML = entradas.map((e) => `
    <div class="item" data-id="${e.id}" data-nombre="${esc(e.nombre)}">
      <div class="item-main">
        <div><b>#${pad(e.numero)}</b> ${esc(e.nombre)} ${badge(e.tipo)}</div>
        <div class="muted small">${esc(e.email)}${e.telefono ? ' · ' + esc(e.telefono) : ''}</div>
        <div class="small">
          ${e.usada_en ? `<span class="dentro">✅ Dentro desde las ${hora(e.usada_en)}</span>` : '<span class="muted">⏳ Sin usar</span>'}
          ${e.email_enviado ? '' : ' · <span class="warn">✉️ email no enviado</span>'}
        </div>
      </div>
      <div class="item-actions">
        <a class="btn ghost small" href="/entrada/${e.token}" target="_blank" rel="noopener">Ver QR</a>
        <button class="btn ghost small" data-act="reenviar">Reenviar</button>
        ${e.usada_en ? '<button class="btn ghost small" data-act="desmarcar">Desmarcar</button>' : ''}
        <button class="btn ghost small danger" data-act="borrar">Borrar</button>
      </div>
    </div>`).join('');
}

async function cargar() {
  const q = buscar.value.trim();
  try {
    const data = await api('/api/entradas' + (q ? '?q=' + encodeURIComponent(q) : ''));
    pintarStats(data.stats);
    pintarLista(data.entradas);
  } catch (e) {
    lista.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const datos = {
    nombre: form.nombre.value.trim(),
    email: form.email.value.trim(),
    telefono: form.telefono.value.trim(),
  };
  if (!confirm(`¿Has cobrado la entrada?\n\n${datos.nombre}\n${datos.email}\n\nRevisa que el email esté bien escrito.`)) return;

  btnCrear.disabled = true;
  btnCrear.textContent = 'Creando y enviando…';
  $('resultado').innerHTML = '';
  try {
    const r = await api('/api/entradas', { method: 'POST', body: datos });
    const e = r.entrada;
    $('resultado').innerHTML = `
      <div class="resultado ${e.tipo}">
        <h3>✅ Entrada #${pad(e.numero)} creada · ${esc(e.nombre)} ${badge(e.tipo)}</h3>
        ${r.emailError
          ? `<p class="warn">⚠️ No se pudo enviar el email: ${esc(r.emailError)}</p>
             <p>Pulsa <b>Reenviar</b> en la lista o enséñale/mándale el QR: <a href="/entrada/${e.token}" target="_blank" rel="noopener">abrir entrada</a></p>`
          : `<p>📧 Enviada a <b>${esc(e.email)}</b></p>`}
      </div>`;
    form.reset();
    form.nombre.focus();
    pintarStats(r.stats);
    cargar();
  } catch (e) {
    $('resultado').innerHTML = `<p class="error">❌ ${esc(e.message)}</p>`;
  } finally {
    btnCrear.disabled = false;
    btnCrear.textContent = '💶 Pagado · Crear y enviar entrada';
  }
});

lista.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const item = btn.closest('.item');
  const { id, nombre } = item.dataset;
  const act = btn.dataset.act;

  if (act === 'borrar' && !confirm(`¿Borrar la entrada de ${nombre}? Su QR dejará de funcionar.`)) return;
  if (act === 'desmarcar' && !confirm(`¿Marcar la entrada de ${nombre} como NO usada? (podrá volver a entrar)`)) return;

  btn.disabled = true;
  const texto = btn.textContent;
  btn.textContent = '…';
  try {
    if (act === 'reenviar') {
      await api(`/api/entradas/${id}/reenviar`, { method: 'POST' });
      btn.textContent = 'Enviado ✓';
      setTimeout(cargar, 1200);
      return;
    }
    if (act === 'desmarcar') await api(`/api/entradas/${id}/desmarcar`, { method: 'POST' });
    if (act === 'borrar') await api(`/api/entradas/${id}`, { method: 'DELETE' });
    cargar();
  } catch (e) {
    alert(e.message);
    btn.disabled = false;
    btn.textContent = texto;
  }
});

let t;
buscar.addEventListener('input', () => { clearTimeout(t); t = setTimeout(cargar, 300); });

requireLogin((rol) => {
  if (rol === 'portero') { location.href = '/scanner'; return; }
  cargar();
  setInterval(() => { if (!document.hidden) cargar(); }, 20000);
});
