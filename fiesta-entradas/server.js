import express from 'express';
import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ───────────────────────── Configuración ─────────────────────────
const {
  PORT = 3000,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  TAQUILLA_PIN,
  PORTERO_PIN,
  EVENTO_NOMBRE = 'La Fiesta',
  EVENTO_FECHA = '',
  EVENTO_LUGAR = '',
  EMAIL_FROM,
  EMAIL_FROM_NAME,
  BREVO_API_KEY,
  RESEND_API_KEY,
} = process.env;

// URL pública de la web (para los enlaces e imágenes del email).
// En Render se rellena sola con RENDER_EXTERNAL_URL si no pones PUBLIC_URL.
const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${PORT}`
).replace(/\/+$/, '');

const faltan = Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY, TAQUILLA_PIN, PORTERO_PIN })
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (faltan.length) {
  console.error(`❌ Faltan variables de entorno: ${faltan.join(', ')}`);
  process.exit(1);
}
if (!BREVO_API_KEY && !RESEND_API_KEY) {
  console.warn('⚠️  No hay BREVO_API_KEY ni RESEND_API_KEY: las entradas se crearán pero NO se enviarán emails.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ───────────────────────── Utilidades ─────────────────────────
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(3, '0');
const etiqueta = (tipo) => (tipo === 'primera' ? 'COPA + CHUPITO' : 'COPA');
const qrPng = (token) => QRCode.toBuffer(token, { width: 600, margin: 2, errorCorrectionLevel: 'M' });

function publica(e) {
  return {
    id: e.id,
    numero: e.numero,
    nombre: e.nombre,
    tipo: e.tipo,
    etiqueta: etiqueta(e.tipo),
    usada_en: e.usada_en,
  };
}

async function limitePrimeras() {
  const { data } = await supabase.from('ajustes').select('valor').eq('clave', 'limite_primeras').maybeSingle();
  return parseInt(data?.valor ?? '50', 10) || 50;
}

async function stats() {
  const contar = (q) => q.then(({ count, error }) => {
    if (error) throw error;
    return count ?? 0;
  });
  const base = () => supabase.from('entradas').select('id', { count: 'exact', head: true });
  const [vendidas, primeras, dentro, limite] = await Promise.all([
    contar(base()),
    contar(base().eq('tipo', 'primera')),
    contar(base().not('usada_en', 'is', null)),
    limitePrimeras(),
  ]);
  return { vendidas, primeras, dentro, limite, primerasRestantes: Math.max(0, limite - primeras) };
}

// ───────────────────────── PINs (acceso sencillo) ─────────────────────────
function rolDePin(pin) {
  if (!pin) return null;
  if (pin === TAQUILLA_PIN) return 'taquilla'; // la taquilla puede usar también el escáner
  if (pin === PORTERO_PIN) return 'portero';
  return null;
}
const requiere = (...roles) => (req, res, next) => {
  const rol = rolDePin(req.get('x-pin'));
  if (!rol || !roles.includes(rol)) return res.status(401).json({ error: 'PIN incorrecto' });
  req.rol = rol;
  next();
};

app.post('/api/login', async (req, res) => {
  const rol = rolDePin(String(req.body?.pin ?? ''));
  if (!rol) {
    await new Promise((r) => setTimeout(r, 800)); // frena a quien pruebe PINs al azar
    return res.status(401).json({ error: 'PIN incorrecto' });
  }
  res.json({ rol });
});

app.get('/api/config', (_req, res) => {
  res.json({ evento: EVENTO_NOMBRE, fecha: EVENTO_FECHA, lugar: EVENTO_LUGAR });
});

// ───────────────────────── Email ─────────────────────────
function plantillaEmail(e) {
  const urlEntrada = `${PUBLIC_URL}/entrada/${e.token}`;
  const incluye =
    e.tipo === 'primera'
      ? '🥃 Tu entrada incluye <b>COPA + CHUPITO</b>'
      : '🍹 Tu entrada incluye <b>COPA</b>';
  const info = [EVENTO_FECHA, EVENTO_LUGAR].filter(Boolean).map(esc).join(' · ');
  return `<!doctype html><html><body style="margin:0;background:#f3f0fa;font-family:Arial,Helvetica,sans-serif;color:#1d1630">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#6d28d9;color:#ffffff;padding:26px 24px;text-align:center">
  <div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;opacity:.85">Tu entrada</div>
  <div style="font-size:28px;font-weight:bold;margin-top:6px">${esc(EVENTO_NOMBRE)}</div>
  ${info ? `<div style="font-size:14px;margin-top:8px;opacity:.9">${info}</div>` : ''}
</td></tr>
<tr><td style="padding:26px 24px;text-align:center">
  <p style="font-size:16px;margin:0 0 18px">¡Hola <b>${esc(e.nombre)}</b>! Ya tienes tu entrada. Enséñale este código al portero en la puerta.</p>
  <img src="${PUBLIC_URL}/qr/${e.token}.png" width="260" height="260" alt="Código QR de tu entrada" style="display:block;margin:0 auto;border:0">
  <p style="font-size:14px;color:#555;margin:14px 0 18px">Entrada nº <b>${pad(e.numero)}</b></p>
  <div style="background:#f3f0fa;border-radius:12px;padding:14px;font-size:17px">${incluye}</div>
  <p style="margin:22px 0 8px"><a href="${urlEntrada}" style="display:inline-block;background:#6d28d9;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold">Ver mi entrada</a></p>
  <p style="font-size:12px;color:#888;margin:18px 0 0">Si no ves el QR, también va adjunto en este correo.<br>No compartas este código: solo vale para una persona y una vez.</p>
</td></tr></table></td></tr></table></body></html>`;
}

async function enviarEmail(e) {
  if (!BREVO_API_KEY && !RESEND_API_KEY) throw new Error('No hay proveedor de email configurado');
  if (!EMAIL_FROM) throw new Error('Falta la variable EMAIL_FROM');

  const asunto = `🎟️ Tu entrada para ${EVENTO_NOMBRE} (nº ${pad(e.numero)})`;
  const html = plantillaEmail(e);
  const adjunto = (await qrPng(e.token)).toString('base64');
  const nombreAdjunto = `entrada-${pad(e.numero)}.png`;
  const remitente = EMAIL_FROM_NAME || EVENTO_NOMBRE;

  let res;
  if (RESEND_API_KEY) {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${remitente} <${EMAIL_FROM}>`,
        to: [e.email],
        subject: asunto,
        html,
        attachments: [{ filename: nombreAdjunto, content: adjunto }],
      }),
    });
  } else {
    res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: remitente, email: EMAIL_FROM },
        to: [{ email: e.email, name: e.nombre }],
        subject: asunto,
        htmlContent: html,
        attachment: [{ name: nombreAdjunto, content: adjunto }],
      }),
    });
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`El proveedor de email respondió ${res.status}: ${txt.slice(0, 300)}`);
  }
  await supabase.from('entradas').update({ email_enviado: true }).eq('id', e.id);
}

// ───────────────────────── API taquilla ─────────────────────────
app.get('/api/entradas', requiere('taquilla'), async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  let query = supabase.from('entradas').select('*').order('numero', { ascending: false }).limit(300);
  if (/^#?\d+$/.test(q)) {
    query = query.eq('numero', parseInt(q.replace('#', ''), 10));
  } else if (q) {
    const s = q.replace(/[",()%\\*]/g, ' ').trim();
    if (s) query = query.or(`nombre.ilike."%${s}%",email.ilike."%${s}%",telefono.ilike."%${s}%"`);
  }
  const [{ data, error }, st] = await Promise.all([query, stats()]);
  if (error) throw error;
  res.json({ entradas: data, stats: st });
});

app.post('/api/entradas', requiere('taquilla'), async (req, res) => {
  const nombre = String(req.body?.nombre ?? '').trim().slice(0, 120);
  const email = String(req.body?.email ?? '').trim().toLowerCase().slice(0, 200);
  const telefono = String(req.body?.telefono ?? '').trim().slice(0, 40) || null;
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'El email no parece válido' });

  const { data: entrada, error } = await supabase
    .from('entradas')
    .insert({ nombre, email, telefono })
    .select()
    .single();
  if (error) throw error;

  let emailError = null;
  try {
    await enviarEmail(entrada);
    entrada.email_enviado = true;
  } catch (err) {
    emailError = err.message;
    console.error('Error enviando email:', err.message);
  }
  res.json({ entrada, emailError, stats: await stats() });
});

const idValido = (req, res, next) =>
  UUID_RE.test(req.params.id) ? next() : res.status(400).json({ error: 'ID no válido' });

app.post('/api/entradas/:id/reenviar', requiere('taquilla'), idValido, async (req, res) => {
  const { data, error } = await supabase.from('entradas').select('*').eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ error: 'No existe esa entrada' });
  await enviarEmail(data);
  res.json({ ok: true });
});

app.post('/api/entradas/:id/desmarcar', requiere('taquilla'), idValido, async (req, res) => {
  const { error } = await supabase.from('entradas').update({ usada_en: null }).eq('id', req.params.id);
  if (error) throw error;
  res.json({ ok: true });
});

app.delete('/api/entradas/:id', requiere('taquilla'), idValido, async (req, res) => {
  const { error } = await supabase.from('entradas').delete().eq('id', req.params.id);
  if (error) throw error;
  res.json({ ok: true });
});

// ───────────────────────── API portero ─────────────────────────
app.get('/api/stats', requiere('taquilla', 'portero'), async (_req, res) => {
  res.json(await stats());
});

// Recibe el texto del QR (o un nº de entrada escrito a mano) y marca la entrada como usada.
app.post('/api/escanear', requiere('taquilla', 'portero'), async (req, res) => {
  const codigo = String(req.body?.codigo ?? '').trim();
  let campo, valor;
  const m = codigo.match(UUID_RE);
  if (m) {
    campo = 'token';
    valor = m[0].toLowerCase();
  } else if (/^#?\d{1,6}$/.test(codigo)) {
    campo = 'numero';
    valor = parseInt(codigo.replace('#', ''), 10);
  } else {
    return res.json({ estado: 'invalida' });
  }

  // Actualización atómica: solo marca si todavía no estaba usada.
  const { data: marcada, error } = await supabase
    .from('entradas')
    .update({ usada_en: new Date().toISOString() })
    .eq(campo, valor)
    .is('usada_en', null)
    .select()
    .maybeSingle();
  if (error) throw error;

  if (marcada) {
    return res.json({ estado: 'ok', manual: campo === 'numero', entrada: publica(marcada), stats: await stats() });
  }

  const { data: existente, error: e2 } = await supabase.from('entradas').select('*').eq(campo, valor).maybeSingle();
  if (e2) throw e2;
  if (!existente) return res.json({ estado: 'invalida' });
  res.json({ estado: 'usada', entrada: publica(existente) });
});

// ───────────────────────── Público: QR y página de la entrada ─────────────────────────
app.get('/qr/:archivo', async (req, res) => {
  const token = req.params.archivo.replace(/\.png$/i, '');
  if (!/^[0-9a-f-]{36}$/i.test(token)) return res.status(404).end();
  res.type('png').set('Cache-Control', 'public, max-age=31536000, immutable').send(await qrPng(token.toLowerCase()));
});

app.get('/entrada/:token', async (req, res) => {
  const token = req.params.token;
  const { data: e } = UUID_RE.test(token)
    ? await supabase.from('entradas').select('*').eq('token', token).maybeSingle()
    : { data: null };

  const info = [EVENTO_FECHA, EVENTO_LUGAR].filter(Boolean).map(esc).join(' · ');
  const cuerpo = !e
    ? `<div class="ticket"><h1>Entrada no encontrada</h1><p class="muted">Este enlace no corresponde a ninguna entrada.</p></div>`
    : `<div class="ticket">
        <div class="eyebrow">Tu entrada</div>
        <h1>${esc(EVENTO_NOMBRE)}</h1>
        ${info ? `<p class="muted">${info}</p>` : ''}
        <img class="qr" src="/qr/${e.token}.png" alt="Código QR de la entrada">
        <p class="big-name">${esc(e.nombre)}</p>
        <p class="muted">Entrada nº ${pad(e.numero)}</p>
        <div class="incluye ${e.tipo}">${e.tipo === 'primera' ? '🥃 COPA + CHUPITO' : '🍹 COPA'}</div>
        ${e.usada_en ? `<p class="usada">✅ Ya usada el ${new Date(e.usada_en).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' })}</p>` : '<p class="muted small">Sube el brillo de la pantalla al enseñarla en la puerta.</p>'}
      </div>`;

  res.set('Cache-Control', 'no-store').send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Entrada · ${esc(EVENTO_NOMBRE)}</title><link rel="stylesheet" href="/style.css"></head>
<body class="entrada-page">${cuerpo}</body></html>`);
});

app.get('/healthz', (_req, res) => res.send('ok'));

// Errores
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err?.message || 'Error interno' });
});

app.listen(PORT, () => {
  console.log(`🎉 Entradas en marcha en ${PUBLIC_URL} (puerto ${PORT})`);
});
