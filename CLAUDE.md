# CLAUDE.md — TallyFinance

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TallyFinance is a **personal finance assistant** that operates through Telegram and WhatsApp. Users interact with an AI character called **Gus** — a personality-driven chatbot that registers transactions, checks budgets, tracks goals, and provides financial guidance.

The system follows a two-phase AI orchestration pattern:
- **Backend (NestJS)** executes database operations and tool handlers
- **AI Service (FastAPI)** analyzes intent and generates personalized responses
- **Frontend (React/Vite)** provides web dashboard, onboarding, account linking, and admin tools

**Core Principle:** *"Backend ejecuta, IA entiende/decide/comunica"*

## Architecture

```
User Message → Channel Adapter → Backend (NestJS) → Phase A (AI) → Tool Handler → Phase B (AI) → Response
```

### Services

| Service | Port | Technology | Hosting | Purpose |
|---------|------|------------|---------|---------|
| Backend | 3000 | NestJS 11 / TypeScript 5.7 | Render | Webhooks, DB operations, tool execution, auth, admin |
| AI Service | 8000 | FastAPI / Python 3.11 | Render (free tier) | Intent analysis, response generation via OpenAI |
| Frontend | 5173 | React 19 / Vite 7 | Vercel | Web dashboard, onboarding, account linking |
| Database | — | Supabase (PostgreSQL) | Supabase | Persistent storage + auth |
| Cache | 6379 | Redis (Upstash / ioredis) | Upstash | Caching, rate limiting, state, locks |

### Two-Phase AI Orchestration

**Phase A (Intent Analysis):** Analyzes user message with slot-fill context + available categories. Returns `tool_call`, `clarification`, or `direct_reply`. Uses OpenAI gpt-4o-mini with temp=0.3, JSON mode.

**Phase B (Response Generation):** Takes tool result + RuntimeContext (metrics, mood, style, cooldowns, summary). Generates personalized message through Gus identity + personality settings. Uses temp=0.7, text mode. Returns `final_message` + metadata (`new_summary`, `did_nudge`, `nudge_type`).

### Bot Orchestration Loop (16 Steps)

```
1. Handle /start command (Telegram deep links)
2. Lookup linked user → build link reply if not found
3. TWO-PHASE DEDUP: check msg:{msgId} → done/processing/new
4. CONCURRENCY LOCK: acquire lock:{userId} (5s TTL)
5. LOAD ALL STATE in parallel (context, summary, pending, metrics, cooldowns)
6. Detect user style (regex: lucas, chilenismos, emojis, formal)
7. Get tool schemas + available categories
8. PHASE A: AI decides intent → tool_call / clarification / direct_reply
9. If direct_reply or clarification → return (no Phase B)
10. GUARDRAILS: validate tool arguments
11. EXECUTE TOOL HANDLER → ActionResult
12. Record metrics (if register_transaction + success)
13. If handler returns userMessage (slot-fill) → save pending → return
14. PHASE B: AI generates personalized response
15. Save summary + cooldowns
16. Release lock, set dedup to "done"
```

### Tool System (6 + 1 Fallback)

| Tool | Context | DB Tables | Purpose |
|------|---------|-----------|---------|
| `register_transaction` | Yes | categories, payment_method, transactions | Record expenses/income with slot-filling |
| `ask_balance` | Yes | user_prefs, payment_method, transactions, spending_expectations | Spending & budget query |
| `ask_budget_status` | Yes | spending_expectations | Active budget check (`.maybeSingle()`) |
| `ask_goal_status` | Yes | goals | Goals progress with % |
| `ask_app_info` | No | None (static knowledge base) | App info, help, FAQ |
| `greeting` | No | None | Returns `{ ok: true }` → Phase B generates greeting |
| `unknown` (fallback) | No | None | Returns userMessage directly (skips Phase B) |

**Registration:** ToolRegistry has 6 handlers in map + `unknown` as `fallbackHandler`.

## Repository Structure

```
TallyFinance/
├── CLAUDE.md                                    # This file (root project guidance)
├── docs/
│   ├── TALLYFINANCE_SYSTEM.md                   # Complete system reference (v2.2, 1100+ lines)
│   ├── TALLYFINANCE_ENDPOINTS.md                # Consolidated endpoint testing guide
│   ├── LANDING_PAGE_CONTENT.md                  # Landing page content
│   └── pruebas-handlers/                        # 7 tool handler test scripts
│
├── tally-combined/
│   ├── backend-API_TallyFinance/                # NestJS backend (68 TS files, ~7,800 lines)
│   │   ├── CLAUDE.md                            # Backend-specific guidance (835 lines)
│   │   ├── src/                                 # Source code
│   │   └── docs/                                # Endpoint & testing guides
│   │
│   └── ai-service_TallyFinane/                  # FastAPI AI service (12 files)
│       ├── CLAUDE.md                            # AI service-specific guidance (507 lines)
│       ├── app.py, config.py, schemas.py        # Core app
│       ├── orchestrator.py                      # Phase A/B logic, mood calc
│       ├── tool_schemas.py                      # 6 tool definitions
│       ├── debug_logger.py                      # Unified color-coded logger
│       └── prompts/                             # 4 prompt files (identity, phase A/B, variability)
│
├── frontend_TallyFinance/                       # React frontend (65 files, ~8,500 lines)
│   ├── CLAUDE.md                                # Frontend-specific guidance (649 lines)
│   └── src/                                     # Source code
│
├── docker-compose.yml                           # Full stack: redis, ai-service, backend, ngrok
├── render.yaml                                  # Render deployment config
└── Dockerfile.combined                          # Combined deployment option
```

## Build and Development Commands

### Backend (NestJS)
```bash
cd tally-combined/backend-API_TallyFinance
npm install
npm run start:dev      # Watch mode
npm run build          # Compile TypeScript (nest build)
npm run start:prod     # Production (node dist/main.js)
npm run lint           # ESLint with auto-fix
npm run test           # Jest unit tests
npm run test:watch     # Watch mode
npm run test:e2e       # End-to-end tests
```

### AI Service (FastAPI)
```bash
cd tally-combined/ai-service_TallyFinane
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

### Frontend (React/Vite)
```bash
cd frontend_TallyFinance
npm install
npm run dev            # Dev server on port 5173 (strictPort)
npm run build          # Production build (vite build)
npm run lint           # ESLint
```

### Docker (Full Stack)
```bash
docker-compose up --build
# Services: redis:6379, ai-service:8000, backend:3000, ngrok:4040
```

### Testing Endpoints
```bash
# Health checks
curl http://localhost:8000/health
curl http://localhost:3000/

# Test bot (simulates message — no channel adapter needed)
curl -X POST http://localhost:3000/bot/test \
  -H "Content-Type: application/json" \
  -d '{"channel":"test","externalId":"user-123","text":"gasté 15 lucas en comida"}'
```

## All Endpoints (30+)

### Auth (`/auth`) — 13 endpoints
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/auth/signup` | No | Email/password registration, sets HTTP-only cookies |
| POST | `/auth/signin` | No | Email/password login, sets cookies, triggers AI warmup |
| POST | `/auth/provider` | No | OAuth flow (Google only — `@IsIn(['google'])`) |
| GET | `/auth/callback` | No | OAuth callback handler |
| POST | `/auth/refresh` | Cookie | Refresh access token from refresh_token cookie |
| POST | `/auth/logout` | No | Clear auth cookies |
| GET | `/auth/me` | JWT | Get profile (with onboarding + link status) |
| GET | `/auth/sessions` | JWT | List user sessions |
| GET | `/auth/link-status` | JWT | Channel linking status |
| POST | `/auth/create-link-token` | JWT | Generate link code for web-initiated flow |
| POST | `/auth/link-channel` | JWT | Link channel via code (with force option) |
| POST | `/auth/unlink-channel` | JWT | Remove channel link |
| POST | `/auth/onboarding` | JWT | Submit onboarding (7 sync steps) |

### Connect (`/connect`) — 2 endpoints
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/connect/:code` | Cookie | Channel linking redirect flow |
| GET | `/connect/:code/api` | JWT | Channel linking JSON API |

### Bot (webhooks) — 3 endpoints
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/telegram/webhook` | No | Telegram Bot API webhook |
| POST | `/whatsapp/webhook` | No | WhatsApp Cloud API webhook |
| POST | `/bot/test` | No | Test endpoint (bypasses channel) |

### Users (`/api/users`) — 3 endpoints
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/users/me` | JWT | User profile |
| GET | `/api/users/context` | JWT | Full user context |
| GET | `/api/users/transactions?limit=` | JWT | Transactions (default 50, max 200) |

### Admin (`/admin`) — 9 endpoints (AdminGuard: hardcoded UUID whitelist)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/admin/check` | Verify admin access |
| GET | `/admin/dashboard?hours=` | Dashboard stats |
| GET | `/admin/messages?...` | Paginated messages (userId, channel, from, to, hasError) |
| GET | `/admin/messages/:id` | Message detail with Phase A/B debug |
| GET | `/admin/users/:userId/chat?limit=` | User chat history |
| GET | `/admin/users/:userId/profile` | User profile with personality |
| GET | `/admin/errors?limit=&offset=` | Error messages |
| GET | `/admin/users` | Active users list |
| GET | `/admin/usage?month=` | OpenAI API usage analytics |

### Frontend API Client Namespaces
| Namespace | Methods | Usage |
|-----------|---------|-------|
| `authApi` | signup, signin, me, refresh, logout, linkChannel, createLinkToken, submitOnboarding, linkStatus, linkCodeStatus | Auth flows |
| `userApi` | getTransactions | Dashboard data |
| `linkApi` | initiate, complete, status, unlink | New linking flow (`/api/link/*`) |
| `adminApi` | check, getDashboard, getMessages, getMessage, getUserChat, getUserProfile, getErrors, getActiveUsers, getUsage | Admin panel |

## Frontend Routes

| Path | Component | Auth | Purpose |
|------|-----------|------|---------|
| `/` | Home (MainLayout) | No | Landing page (9 sections, redirects auth users) |
| `/auth` | Auth | No | Login/register with Google OAuth |
| `/onboarding` | Onboarding | JWT | 10-step wizard |
| `/app` | Dashboard | JWT | Main app: linked → TransactionLog, unlinked → connect prompt |
| `/connect/:code` | ChannelLinkCapture | No | Auto-link channel, redirects to auth if needed |
| `/admin` | AdminLayout | Admin | Admin dashboard (nested routes) |
| `/admin/checklist` | AdminChecklist | Admin | Progress tracker |
| `/admin/docs` | AdminDocs | Admin | HTML docs viewer |
| `/admin/usage` | AdminUsage | Admin | OpenAI usage charts |
| `/admin/messages` | AdminMessages | Admin | Message browser |
| `/admin/messages/:id` | AdminMessageDetail | Admin | Message detail |

## Gus — AI Character

| Trait | Value |
|-------|-------|
| Name | Gus (full name "Gustavo" — Breaking Bad easter egg, used rarely) |
| Role | Personal finance assistant, "hired" by user |
| Personality | Serious but kind, professional, direct, slightly sarcastic |
| Origin | Chilean, default currency CLP |
| Company | TallyFinance SPA |
| Never says | That he's a bot/AI/program |
| Speaking style | Chilean Spanish when user does, understands "lucas" = x1000 CLP |

### Personality System

| Setting | Source | Values |
|---------|--------|--------|
| Tone | `personality_snapshot.tone` | neutral, friendly, serious, motivational, strict |
| Intensity | `personality_snapshot.intensity` | 0.0 - 1.0 |
| Mood | Calculated per request | frustrated → tired → normal → hopeful → happy → proud |

### 3-Circle Scope

| Circle | Topics | AI Action |
|--------|--------|-----------|
| 1 — Core | TallyFinance, Gus, transactions, budgets, goals | Always respond (tool_call) |
| 2 — Related | Personal finance, Chilean economy, savings tips | Respond with judgment (ask_app_info) |
| 3 — Out of domain | Science, history, politics, programming | Redirect politely (direct_reply with humor) |

## Database (Supabase)

### Core Tables

| Table | Purpose | Accessed By |
|-------|---------|-------------|
| `users` | User profiles | Backend (auth, onboarding, context) |
| `user_prefs` | Preferences (notifications, unified_balance) | Backend (context, onboarding) |
| `personality_snapshot` | Bot personality per user (tone, intensity, mood) | Backend (context, onboarding) |
| `channel_accounts` | Platform links (user ↔ Telegram/WhatsApp) | Backend (bot, auth, linking) |
| `channel_link_codes` | Temp link codes (10-min TTL) | Backend (linking flow) |
| `transactions` | Financial records | Backend (tools, user API) |
| `categories` | Expense categories (user-specific) | Backend (tools, onboarding) |
| `payment_method` | Payment accounts | Backend (tools, onboarding) |
| `goals` | Savings goals with progress | Backend (tools, onboarding) |
| `spending_expectations` | Budget config (daily/weekly/monthly) | Backend (tools, onboarding) |
| `bot_message_log` | Admin message log | Backend (admin, message-log service) |
| `user_emotional_log` | Emotion tracking (**schema exists, not accessed by code**) | None |

### Key Enums

| Enum | Values |
|------|--------|
| `bot_tone_enum` | neutral, friendly, serious, motivational, strict |
| `bot_mood_enum` | normal, happy, disappointed, tired, hopeful, frustrated, proud |
| `channel_t` | telegram, whatsapp, web |
| `goal_status_enum` | in_progress, completed, canceled |
| `tx_source_t` | manual, chat_intent, import, bank_api, ai_extraction |
| `payment_type_t` | credito, debito |
| `emotion_t` | neutral, feliz, triste, ansioso, enojado, estresado |

## Redis Architecture

| Key Pattern | TTL | Purpose | Service |
|-------------|-----|---------|---------|
| `ctx:{userId}` | 60s | User context cache | UserContextService |
| `rl:{externalId}` | 60s | Rate limiting (30 msgs/min) | AsyncRateLimiter |
| `lock:{userId}` | 5s | Concurrency lock | BotService |
| `msg:{msgId}` | 120s→24h | Two-phase message dedup | BotService |
| `tally:circuit:{service}` | — | Circuit breaker state | CircuitBreaker |
| `conv:{userId}:summary` | 2-24h | Conversation recap | ConversationService |
| `conv:{userId}:pending` | 10m | Slot-fill state | ConversationService |
| `conv:{userId}:metrics` | 30d | Streak, week count | MetricsService |
| `conv:{userId}:cooldowns` | 30d | Nudge cooldown timestamps | CooldownService |

**Fallback:** Single instance → in-memory Map with warning. Multi instance → fail hard (503).

## Resilience Patterns

| Pattern | Location | Config |
|---------|----------|--------|
| **Rate Limiting** | `bot.controller.ts` | 30 msgs/60s per user (ZSET + 5min cleanup) |
| **Circuit Breaker** | `orchestrator.client.ts` | 5 failures → OPEN (30s) → HALF_OPEN → CLOSED |
| **Message Dedup** | `bot.service.ts` | Two-phase: "processing" (120s) → "done" (24h) |
| **User Lock** | `bot.service.ts` | `lock:{userId}` 5s TTL, explicit drop if busy |
| **Context Cache** | `user-context.service.ts` | Redis 60s TTL, 6 parallel DB queries on miss |
| **Cold Start** | `orchestrator.client.ts` | Detects 502, sends wake-up GET to `/health` |
| **Stub Mode** | `orchestrator.client.ts` | Regex pattern matching when AI unavailable |
| **OpenAI Retry** | `orchestrator.py` | MAX_RETRIES=1 (2 total attempts), 25s timeout |

## Authentication

| Method | Details |
|--------|---------|
| Email/password | Signup with argon2 hashing, signin with JWT cookies |
| Google OAuth | Only supported provider (`@IsIn(['google'])`) |
| JWT Cookies | `access_token` (15min, HttpOnly, Secure, SameSite=None) + `refresh_token` (7d) |
| Frontend token | Module-level `currentAccessToken` in apiClient.js, auto 401 → refresh retry |

## Channel Linking Flow

**Bot-initiated:** User messages bot → bot creates link code (10-min TTL) → sends link URL → user clicks → web auto-links or redirects to login first.

**Web-initiated:** User generates code on dashboard → sends `/start CODE` to Telegram bot → bot validates → links account.

**Linking state machine** (frontend): `IDLE → INITIATING → AWAITING_BOT → POLLING → SUCCESS/ERROR/TIMEOUT/EXPIRED/CANCELLED` with exponential backoff polling (2s initial, 8s max, 1.5x factor, 100 max attempts).

## Onboarding

**Backend (7 sync steps in single POST):** users → user_prefs → personality_snapshot → categories → payment_methods → spending_expectations → goals

**Frontend (10-step wizard):** Intro → Tone → Intensity → Preferences → Accounts → Categories (710 lines, 3 layouts) → Balance → Spending → Goals → Outro

## Frontend Design System

| Property | Value |
|----------|-------|
| Font | Goldplay (CDN loaded, weights 400-800) |
| Primary Color | `#0364c6` (primaryDark: `#023a7e`) |
| Breakpoints | Mobile <640px, Tablet 640-1279px, Desktop 1280px+ (3-tier) |
| Border Radius | `rounded-2xl` (cards), `rounded-xl` (inputs), `rounded-full` (pills) |
| Shadows | Custom: `card` (0 4px 15px rgba), `glow` (0 0 25px primaryDark) |
| Backgrounds | Gradient blurs via `bg-gradient-to-br` + `backdrop-blur-xl` |

## Environment Variables

### Backend (.env)
```bash
# Server
PORT=3000
NODE_ENV=development
APP_BASE_URL=http://localhost:3000

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# AI Service
AI_SERVICE_URL=http://localhost:8000

# Redis
REDIS_URL=redis://localhost:6379

# Telegram
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_SECRET=secret

# WhatsApp
WHATSAPP_TOKEN=EAAx...
WHATSAPP_PHONE_NUMBER_ID=123456789

# Frontend
CORS_ORIGINS=http://localhost:5173
LINK_ACCOUNT_URL=http://localhost:5173/connect/

# Feature Flags
DISABLE_AI=0               # 1 = maintenance mode
MULTI_INSTANCE=false        # true = fail hard when Redis unavailable
```

### AI Service (.env)
```bash
OPENAI_API_KEY=sk-proj-xxx
OPENAI_MODEL=gpt-4o-mini
OPENAI_TIMEOUT=25.0
OPENAI_TEMPERATURE_PHASE_A=0.3
OPENAI_TEMPERATURE_PHASE_B=0.7
MAX_RETRIES=1              # OpenAI retry count
```

### Frontend (.env)
```bash
VITE_API_URL=http://localhost:3000   # Backend URL
```

## Adding a New Tool Handler

1. Create handler in `tally-combined/backend-API_TallyFinance/src/bot/tools/handlers/`:

```typescript
export class MyToolHandler implements ToolHandler {
  readonly name = 'my_tool';
  readonly schema: ToolSchema = {
    name: 'my_tool',
    description: 'Description for AI (in Spanish)',
    parameters: { type: 'object', properties: {}, required: [] },
  };
  readonly requiresContext = true; // or false

  async execute(userId: string, msg: DomainMessage, args: Record<string, unknown>): Promise<ActionResult> {
    return { ok: true, action: 'my_tool', data: {} };
  }
}
```

2. Register in `ToolRegistry` constructor (`tool-registry.ts`)
3. Add corresponding tool schema in AI service (`tool_schemas.py`)
4. Add stub response in `OrchestratorClient.stubPhaseB()` for offline fallback
5. Add guardrails validation in `guardrails.service.ts` if the tool has args
6. Add summary template in AI service `_summarize_action()` (`orchestrator.py`)

## Error Codes

### AI Service (returned to backend)
| Code | HTTP | When |
|------|------|------|
| `INVALID_PHASE` | 400 | Phase not "A" or "B" |
| `MISSING_USER_TEXT` | 400 | Phase A without user_text |
| `MISSING_ACTION_RESULT` | 400 | Phase B without action_result |
| `LLM_ERROR` | 500 | OpenAI API error |
| `LLM_TIMEOUT` | 503 | OpenAI timeout (>25s) |

### Backend (internal)
| Code | When |
|------|------|
| `INVALID_RESPONSE` | AI response failed validation/parsing |
| `COLD_START` | AI service returning 502 (Render free tier waking up) |

### User-Facing Messages (Spanish)
| Error | Message |
|-------|---------|
| `LLM_TIMEOUT` | "El servicio esta tardando mas de lo normal. Por favor intenta de nuevo." |
| `INVALID_RESPONSE` | "Recibi una respuesta inesperada. Podrias reformular tu mensaje?" |
| `LLM_ERROR` | "Hubo un problema con el servicio de IA. Por favor intenta de nuevo." |
| Default | "Hubo un problema procesando tu solicitud." |

## Detailed Documentation

| Document | Lines | Purpose |
|----------|-------|---------|
| `docs/TALLYFINANCE_SYSTEM.md` | 1100+ | Complete system reference (architecture, flows, schemas, gaps, roadmap) |
| `docs/TALLYFINANCE_ENDPOINTS.md` | — | Consolidated endpoint testing guide |
| `tally-combined/backend-API_TallyFinance/CLAUDE.md` | 835 | Backend: file structure, all endpoints, bot loop, tool handlers, Redis, auth, admin |
| `tally-combined/ai-service_TallyFinane/CLAUDE.md` | 507 | AI service: orchestrator, schemas, prompts, mood calc, nudge detection, debug logger |
| `frontend_TallyFinance/CLAUDE.md` | 649 | Frontend: file structure, routes, hooks, API client, design system, user flows |
