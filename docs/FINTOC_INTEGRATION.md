# Integración Fintoc — TallyFinance

> Documento interno · Abril 2026
> Responsable del módulo: backend team

## 1. Alcance

Conexión de cuentas bancarias chilenas vía Fintoc (Data Aggregation).
Permite que Gus detecte gastos automáticamente sin que el usuario los escriba.

El módulo cubre:

- Flujo de linking (web-initiated, widget de Fintoc)
- Webhook receiver (idempotente, firma HMAC validada)
- Sync automático de movimientos → `transactions`
- Desconexión de banco
- Auditoría append-only de cada evento

## 2. Arquitectura

```
┌──────────────┐   1. click "Conectar banco"
│   Frontend   │  ────────────────────────────────────►
│   (React)    │                                        ┌──────────────┐
└──────────────┘   2. POST /api/fintoc/link-intent    │   Backend    │
      │                                                │   (NestJS)   │
      │                                                └──────┬───────┘
      │                                                       │
      │              3. POST /link_intents                    │
      │           ◄──────────────────────────────────────────┤
      │                                                       │
      │ 4. Fintoc.create({widget_token, public_key})         │
      │                                                       │
      ▼                                                       │
┌──────────────┐                                             │
│   Widget     │  5. User ingresa credenciales del banco     │
│   Fintoc.js  │  ───────────────────────────────────────►   │
└──────────────┘                                              │
      │                                                       │
      │ 6. onSuccess(exchange_token)                          │
      │                                                       │
      ▼                                                       │
┌──────────────┐                                             │
│   Frontend   │  7. POST /api/fintoc/exchange               │
└──────────────┘  ────────────────────────────────────────►  │
                                                              │
                                     8. exchange, fetch       │
                                        accounts, persist    │
                                              ▼                │
                                       ┌──────────────┐       │
                                       │   Supabase   │       │
                                       │ (Vault + DB) │       │
                                       └──────────────┘       │
                                                               │
                          9. Webhook (cuando Fintoc refresca)  │
       ┌──────────────┐  ────────────────────────────────────►│
       │    Fintoc    │                                        │
       └──────────────┘  10. GET /movements, INSERT txs        │
```

## 3. Base de datos

### Tabla `fintoc_links` (1 fila por banco conectado)

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | UUID | PK local |
| `user_id` | UUID | FK users |
| `link_token_secret_id` | UUID | FK `vault.secrets` — cifrado AES-256-GCM |
| `fintoc_link_id` | TEXT UNIQUE | ID público de Fintoc (`link_xxx`) |
| `institution_id` | TEXT | ej: `cl_banco_de_chile` |
| `institution_name` | TEXT | "Banco de Chile" |
| `holder_name` | TEXT | Nombre del titular |
| `holder_id` | TEXT | RUT |
| `status` | TEXT | `active` / `credentials_changed` / `invalid` / `disconnected` |
| `last_refresh_at` | TIMESTAMPTZ | Último refresh exitoso |
| `last_webhook_at` | TIMESTAMPTZ | Último webhook recibido |

**RLS habilitado:** user solo ve sus propios links. Escritura solo vía `service_role`.

### Tabla `fintoc_access_log` (append-only)

Cada operación (intent, exchange, token decrypt, webhook, revoke) deja registro con
`actor_type`, `ip_address`, `user_agent`, `detail` (JSONB). UPDATE/DELETE revocados.

### Extensiones en tablas existentes

- `accounts`: `+ fintoc_account_id TEXT UNIQUE`, `+ fintoc_link_id UUID`, `+ last_synced_at`
- `payment_method`: `+ fintoc_account_id TEXT UNIQUE`, `+ fintoc_link_id UUID`
- `transactions`: `external_id`, `raw_description`, `merchant_name`, `auto_categorized`, `fintoc_link_id`, `transaction_at`

## 4. Seguridad — mapeo ISO 27001 / PCI-DSS

| Control | Implementación |
|---------|----------------|
| **A.8.24 Criptografía** | Supabase Vault (libsodium/AES-256-GCM) para `link_token`. Función `fintoc_get_link_token()` SECURITY DEFINER, sólo callable por `service_role` |
| **A.5.15 Control de acceso** | RLS en `fintoc_links`, ownership check en service layer, IP allowlist opcional para webhooks |
| **A.8.15 / A.8.16 Logging** | `fintoc_access_log` append-only (REVOKE UPDATE/DELETE) |
| **A.8.28 Secure coding** | ValidationPipe en todos los DTOs, HMAC-SHA256 timing-safe compare |
| **Anti-replay** | Timestamp en header `Fintoc-Signature` con tolerancia ±5 min |
| **Idempotencia** | Redis `SETNX fintoc:evt:{id}` TTL 7d |
| **CSRF** | Redis `fintoc:intent:{userId}` obligatorio antes de exchange |
| **TLS 1.3** | Render termina TLS automáticamente |
| **Secrets rotation** | Webhook secret se rota desde el dashboard de Fintoc (env var) |

## 5. Endpoints

### Frontend → Backend (JWT protected)

| Método | Path | Body | Retorna |
|--------|------|------|---------|
| `POST` | `/api/fintoc/link-intent` | — | `{ widget_token, public_key }` |
| `POST` | `/api/fintoc/exchange` | `{ exchange_token }` | `{ link, accounts }` |
| `GET`  | `/api/fintoc/links` | — | `FintocLinkPublicDto[]` |
| `DELETE` | `/api/fintoc/links/:id` | — | 204 |

### Fintoc → Backend (HMAC protected)

| Método | Path | Headers | Body |
|--------|------|---------|------|
| `POST` | `/webhooks/fintoc` | `Fintoc-Signature: t=<ts>,v1=<hmac>` | `{ id, type, mode, data }` |

## 6. Variables de entorno

### Backend (`backend/.env`)

```bash
FINTOC_SECRET_KEY=sk_test_...              # API key privada (para llamar a Fintoc)
FINTOC_PUBLIC_KEY=pk_test_...              # pública (se envía al frontend en el intent)
FINTOC_WEBHOOK_SECRET=whsec_...            # del dashboard de Fintoc, para validar firmas
FINTOC_API_BASE=https://api.fintoc.com/v1  # opcional, default ya aplica
FINTOC_WEBHOOK_IP_ENFORCE=false            # true en producción
```

### Frontend

No requiere var de entorno — la `public_key` viene del backend en cada `link-intent`.

## 7. Flujo completo paso a paso

### A. Link (web-initiated)

1. User clickea "Conectar banco" en onboarding o dashboard
2. Frontend: `fintocApi.createLinkIntent()` → `POST /api/fintoc/link-intent`
3. Backend:
   - Llama `POST api.fintoc.com/v1/link_intents` → recibe `widget_token`
   - Guarda `{widget_token}` en Redis key `fintoc:intent:{userId}` TTL 15 min (anti-CSRF)
   - Audit: `intent_created`
   - Responde `{ widget_token, public_key }`
4. Frontend: `Fintoc.create({widget_token, publicKey, onSuccess, onExit}).open()`
5. User autentica en el widget de Fintoc (credenciales bancarias nunca tocan nuestro backend)
6. Widget callback `onSuccess({ exchange_token })`
7. Frontend: `fintocApi.exchange({ exchangeToken })` → `POST /api/fintoc/exchange`
8. Backend:
   - Valida que `fintoc:intent:{userId}` exista (CSRF guard)
   - Llama `POST /link_tokens/_exchange` → recibe `link_token`
   - Llama `GET /accounts` con el `link_token`
   - **Transacción local:**
     - `SELECT public.fintoc_store_link_token(token, name)` → `secret_id`
     - `INSERT fintoc_links` con `link_token_secret_id`
     - `INSERT accounts` (N filas)
     - `INSERT payment_method` (N filas)
     - Si cualquier paso falla: rollback (DELETE local + DELETE secret + `DELETE /links/{id}` en Fintoc)
   - `DEL fintoc:intent:{userId}` en Redis
   - Audit: `exchange_succeeded`
   - Responde `{ link, accounts }`

**Al terminar el paso 8 el usuario está GARANTIZADAMENTE conectado:** token cifrado en Vault + accounts en DB + payment_methods creados. Si el 200 OK no llega al frontend, ningún efecto secundario se persiste.

### B. Webhook sync

1. Fintoc refresca la cuenta del banco (frecuencia según plan)
2. Fintoc envía `POST /webhooks/fintoc` con `Fintoc-Signature`
3. `FintocWebhookGuard` valida:
   - IP en allowlist (si `FINTOC_WEBHOOK_IP_ENFORCE=true`)
   - Timestamp fresco (±5 min)
   - Firma HMAC-SHA256 timing-safe
4. Controller pasa al service
5. Service: `acquireLock fintoc:evt:{id}` → si ya existe, retorna 200 dedup
6. Dispatch por `event.type`:
   - `account.refresh_intent.succeeded` → `FintocSyncService.syncLink(linkId)`:
     - Descifra `link_token` via Vault (sólo durante el request)
     - Pagina `GET /movements?since=last_sync` (300 por página, max 20 páginas)
     - Normaliza cada movimiento (merchant, name, auto_categorized)
     - `UPSERT transactions` con `onConflict: external_id` (idempotente)
     - Update `accounts.last_synced_at` y `fintoc_links.last_refresh_at`
   - `link.credentials_changed` → marca `status='credentials_changed'`, el user debe reconectar
   - `movements_removed` → marca `status='voided'` en las transactions afectadas
7. Audit: `webhook_processed`
8. Responde 200 `{ received: true }`

### C. Desconexión

1. User clickea "desconectar" en dashboard
2. Frontend: `DELETE /api/fintoc/links/:id`
3. Backend:
   - `DELETE /links/{fintoc_link_id}` en Fintoc
   - `fintoc_delete_link_token(secret_id)` → borra secret en Vault
   - `UPDATE fintoc_links SET status='disconnected'` (mantiene histórico)
   - Audit: `link_revoked`

## 8. Estructura del código

### Backend — `backend/src/fintoc/`

```
fintoc/
├── fintoc.module.ts
├── fintoc.controller.ts                 # /api/fintoc/*  (JWT)
├── fintoc-webhook.controller.ts         # /webhooks/fintoc (HMAC)
├── services/
│   ├── fintoc-api.client.ts             # Axios wrapper a api.fintoc.com
│   ├── fintoc-crypto.service.ts         # Wrapper Supabase Vault
│   ├── fintoc-link.service.ts           # Orquesta intent, exchange, revoke
│   ├── fintoc-sync.service.ts           # Pull movements + persist
│   ├── fintoc-webhook.service.ts        # Dedup + dispatch
│   └── fintoc-audit.service.ts          # Fire-and-forget audit log
├── guards/
│   └── fintoc-webhook.guard.ts          # HMAC + IP + timestamp
├── dto/
│   ├── create-link-intent.dto.ts
│   ├── exchange-token.dto.ts
│   ├── webhook-event.dto.ts
│   └── fintoc-link-response.dto.ts
├── contracts/
│   ├── fintoc-api.types.ts              # Tipos del API de Fintoc
│   └── fintoc-events.enum.ts            # Event types relevantes
└── constants/
    └── fintoc.constants.ts
```

### Frontend — `frontend_TallyFinance/src/features/fintoc/`

```
fintoc/
├── index.js                             # Barrel
├── api/
│   └── fintocApi.js                     # apiClient wrapper
├── hooks/
│   ├── useFintocWidget.js               # Carga JS SDK + open
│   └── useFintocLink.js                 # State machine
└── components/
    ├── FintocConnectButton.jsx          # Botón "Conectar banco"
    └── FintocConnectedBanks.jsx         # Listado + desconectar
```

Integrado en onboarding en `pages/onboarding/components/FintocStep.jsx` (paso `fintoc`).

## 9. Setup inicial (checklist)

- [ ] `supabase_vault` extension habilitada (ya está)
- [ ] Migrations aplicadas: `fintoc_integration_base` + `fintoc_consolidation_vault`
- [ ] `FINTOC_SECRET_KEY` / `FINTOC_PUBLIC_KEY` en `backend/.env` (ya están)
- [ ] Registrar webhook endpoint en dashboard de Fintoc (`https://<host>/webhooks/fintoc`)
- [ ] Copiar el `whsec_...` del dashboard a `FINTOC_WEBHOOK_SECRET`
- [ ] En dev: exponer backend con ngrok (`ngrok http 3000`) y actualizar la URL en dashboard
- [ ] En prod: setear `FINTOC_WEBHOOK_IP_ENFORCE=true`
- [ ] Frontend: no requiere config extra (la public_key viene del backend)

## 10. Troubleshooting

| Problema | Causa probable | Fix |
|----------|----------------|-----|
| `401 Invalid webhook signature` | `FINTOC_WEBHOOK_SECRET` incorrecto o rotado | Copiar de nuevo desde dashboard Fintoc |
| `403 No hay un link intent activo` | Expirado el `fintoc:intent:{userId}` (15min) | Reiniciar flujo desde frontend |
| `500 Vault store failed` | `supabase_vault` no disponible | Verificar `SELECT * FROM vault.secrets LIMIT 1` |
| Webhooks no llegan | Endpoint no registrado o IP allowlist bloqueando | Revisar dashboard Fintoc + `FINTOC_WEBHOOK_IP_ENFORCE` |
| Movements no se sincronizan | Link en estado `credentials_changed` | User debe reconectar desde dashboard |

## 11. Referencias

- Docs Fintoc: https://docs.fintoc.com
- Supabase Vault: https://supabase.com/docs/guides/database/vault
- Investigación inicial: `docs/FINTOC_API_RESEARCH.md`
