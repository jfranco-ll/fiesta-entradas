# 🎟️ Entradas Fiesta

Webapp sencilla para vender entradas en efectivo y controlar la puerta.

| Página | Para quién | Qué hace |
|---|---|---|
| `/` | Taquilla | Apuntas nombre + email de quien ha pagado → se crea la entrada y le llega un email con su QR |
| `/scanner` | Portero | Escanea el QR con la cámara del móvil y sale a pantalla completa **✅ ADELANTE + 🥃 COPA + CHUPITO** o **🍹 SOLO COPA**, o **⛔ YA USADA / ❌ NO VÁLIDA** |
| `/entrada/<código>` | Asistente | Su entrada con el QR (el enlace va en el email) |

- Las **50 primeras** entradas son *COPA + CHUPITO*; el resto *COPA*. Lo decide la base de datos, así que aunque haya dos taquillas a la vez nunca habrá 51.
- Si borras una entrada de chupito (devolución), esa plaza vuelve a quedar libre.
- Cada QR solo vale **una vez**. Si alguien lo enseña dos veces, sale en rojo con la hora a la que entró.
- Hay dos PIN: el de **taquilla** (puede todo) y el de **portero** (solo escáner).

---

## 1. Supabase (base de datos)

1. Entra en [supabase.com](https://supabase.com) → **New project**. Región: *West EU / Central EU*.
2. Menú izquierdo → **SQL Editor** → **New query** → pega todo el contenido de `supabase.sql` → **Run**.
3. Ve a **Project Settings → API Keys** y apunta:
   - **Project URL** → será `SUPABASE_URL`
   - la **Secret key** (`sb_secret_…`) o, si tu proyecto es antiguo, la **service_role** → será `SUPABASE_SERVICE_KEY`

> ⚠️ La clave secreta solo va en el servidor (Render). Nunca en el navegador ni en GitHub.

**¿Quieres que sean 30 u 80 con chupito?** Supabase → *Table Editor* → tabla `ajustes` → cambia `limite_primeras`.

---

## 2. Email (Brevo, gratis)

Render **bloquea el envío por SMTP en el plan gratis** (puertos 25/465/587), por eso la app envía los correos por la API HTTP de Brevo o de Resend.

**Brevo (recomendado, no necesitas dominio):**
1. Crea cuenta gratis en [brevo.com](https://www.brevo.com).
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender**: pon tu email (p. ej. tu Gmail) y verifícalo con el código que te llega.
3. **SMTP & API → API Keys → Generate a new API key**. Cópiala → `BREVO_API_KEY`.
4. `EMAIL_FROM` = el email que verificaste.

> El plan gratis da para unos cientos de correos al día, de sobra para una fiesta. Si envías desde un Gmail, algunos correos pueden caer en *spam*: avisa a la gente de que mire ahí. Con dominio propio verificado en Brevo llegan mejor.

**Resend (alternativa):** solo deja enviar a cualquier persona si verificas un dominio tuyo (registros DNS). Si lo usas, rellena `RESEND_API_KEY` y pon en `EMAIL_FROM` un email de ese dominio. Si están las dos claves, se usa Resend.

---

## 3. Probar en tu ordenador (opcional pero recomendable)

Necesitas [Node.js 20 o superior](https://nodejs.org).

```bash
npm install
cp .env.example .env      # y rellena los valores
npm run dev
```

Abre http://localhost:3000 (taquilla) y http://localhost:3000/scanner (portero).

> 🧹 **Cuando acabes de probar**, vacía la tabla para que las entradas de prueba no cuenten (ni gasten números):
> en Supabase → SQL Editor: `truncate public.entradas restart identity;`

---

## 4. Subirlo a Render

1. Sube esta carpeta a un repositorio de **GitHub** (puede ser privado). El `.gitignore` ya evita subir el `.env`.
2. En [render.com](https://render.com) → **New → Web Service** → conecta el repo.
3. Configura:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance type:** Free
   - **Region:** Frankfurt
4. En **Environment Variables** añade las mismas que en `.env.example`:
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `TAQUILLA_PIN`, `PORTERO_PIN`, `EVENTO_NOMBRE`, `EVENTO_FECHA`, `EVENTO_LUGAR`, `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`.
   (`PUBLIC_URL` no hace falta de momento: Render la detecta sola.)
5. **Create Web Service**. En 1–3 minutos tendrás la web en `https://<nombre-del-servicio>.onrender.com`.

*(Alternativa: **New → Blueprint** y Render lee el `render.yaml` incluido; te pedirá los valores de las variables.)*

---

## 5. Poner tu propio dominio (p. ej. `entradas.tufiesta.com`)

Compra el dominio donde quieras (Namecheap, Cloudflare, DonDominio, IONOS…). Luego:

1. Render → tu servicio → **Settings → Custom Domains → + Add Custom Domain** → escribe el dominio y guarda.
2. En el panel DNS de donde compraste el dominio:

   | Si usas… | Tipo | Nombre | Valor |
   |---|---|---|---|
   | Un subdominio (`entradas.tufiesta.com`) — **lo más fácil** | `CNAME` | `entradas` | `<nombre-del-servicio>.onrender.com` |
   | El dominio raíz (`tufiesta.com`) | `A` | `@` | `216.24.57.1` (o `ALIAS/ANAME` → `<nombre>.onrender.com` si tu proveedor lo permite) |

   - **Borra cualquier registro `AAAA`** del dominio (Render no usa IPv6 y da problemas).
   - Si usas **Cloudflare**, deja la nube en gris (*DNS only*) hasta que Render verifique.
3. Vuelve a Render y pulsa **Verify**. Render pone el HTTPS (candado) automáticamente. Los cambios DNS pueden tardar de minutos a unas horas.
4. Añade la variable `PUBLIC_URL=https://entradas.tufiesta.com` en Render (para que los emails enlacen al dominio bonito). Se redespliega solo.

El plan gratis de Render incluye un par de dominios propios, suficiente para esto.

---

## 6. El día de la fiesta ✅

- **Despierta la web antes de abrir puertas**: en el plan gratis, Render apaga el servidor tras ~15 min sin visitas y el primer acceso tarda alrededor de un minuto. Abre `/scanner` 5 minutos antes y deja el móvil del portero con la página abierta (la app mantiene la pantalla encendida).
- **Supabase gratis se pausa** si el proyecto pasa una semana sin uso. Si vas a vender con días de antelación no hay problema; si no, entra al panel de Supabase unos días antes.
- La cámara del escáner **solo funciona con HTTPS** (Render ya lo da) y hay que darle permiso la primera vez.
- Si el QR no se lee (pantalla rota, sin brillo…): en el escáner escribe el **nº de entrada** que sale en su email y comprueba el nombre con su DNI.
- Si a alguien no le llega el email: búscalo en la taquilla → **Reenviar**, o **Ver QR** y que haga una foto a la pantalla.
- Si el portero se equivoca y marca a alguien que no entró: taquilla → **Desmarcar**.
- Pon PINs de 6 cifras o más y no los compartas por grupos grandes.

---

## Estructura

```
server.js            → servidor (API, emails, generación del QR)
supabase.sql         → tablas y regla de las 50 primeras
public/index.html    → taquilla
public/scanner.html  → escáner del portero
public/*.js / .css   → lógica y estilos del navegador
render.yaml          → configuración opcional para Render (Blueprint)
```
