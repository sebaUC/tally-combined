# Backend — TallyFinance

**NestJS backend for TallyFinance.** Handles webhooks, database operations, tool execution, auth, onboarding, and admin.

**Core Principle:** *"Backend ejecuta, IA entiende/decide/comunica"* — the backend never calls OpenAI directly.

## Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| NestJS | 11.0 | Framework |
| TypeScript | 5.7 | Language |
| Supabase JS | 2.76 | Database + Auth client |
| ioredis | 5.4 | Redis client |
| axios | 1.12 | HTTP client (AI service, Telegram, WhatsApp) |
| class-validator | 0.14 | DTO validation |
| class-transformer | 0.5 | DTO transformation |
| argon2 | 0.44 | Password hashing |
| moment-timezone | 0.6 | Timezone handling |
| Jest | 30.0 | Testing framework |

## Commands

```bash
npm run build          # Compile TypeScript (nest build)
npm run start:dev      # Watch mode for development
npm run start          # Start without watch
npm run start:prod     # Production (node dist/main.js)
npm run start:debug    # Debug mode with inspector

npm run lint           # ESLint with auto-fix
npm run format         # Prettier formatting

npm run test           # Run unit tests (Jest)
npm run test:watch     # Watch mode
npm run test:cov       # Coverage report
npm run test:e2e       # End-to-end tests
```

## Bootstrap (`main.ts`)

- CORS: configured from `CORS_ORIGINS` env (comma-separated), falls back to `true` (all origins)
- ValidationPipe: `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`
- Listens on `0.0.0.0:${PORT}` (default 3000)

## Complete File Structure

```
backend-API_TallyFinance/src/
├── main.ts                                # Bootstrap: CORS, ValidationPipe, port binding
├── app.module.ts                          # Root module: ConfigModule, Redis, Supabase, Auth, Users, Bot, Admin
├── app.controller.ts                      # GET / → "Hola jose!!!" (health check)
├── app.service.ts                         # AppService.getHello()
│
├── supabase/
│   └── supabase.module.ts                 # @Global provider 'SUPABASE' — SupabaseClient factory
│
├── redis/
│   ├── redis.module.ts                    # @Global provider RedisService
│   ├── redis.service.ts                   # Redis wrapper with in-memory fallback (247 lines)
│   ├── redis.health.ts                    # Health indicator for Redis
│   ├── keys.ts                            # All Redis key patterns + TTL constants
│   └── index.ts                           # Re-exports
│
├── common/
│   ├── common.module.ts                   # @Global: ChannelLinkCodeService, DataParserService, AiWarmupService
│   ├── utils/
│   │   ├── resilience.ts                  # withRetry, CircuitBreaker, RateLimiter, AsyncRateLimiter (318 lines)
│   │   ├── debug-logger.ts                # Structured logging with correlation IDs (293 lines)
│   │   ├── data-parser.service.ts         # Amount parsing, masked digits (44 lines)
│   │   └── channel-link-code.service.ts   # Link code CRUD: create, consume, peek, conflicts (288 lines)
│   └── services/
│       └── ai-warmup.service.ts           # Cold start detection & wake-up for Render free tier (157 lines)
│
├── auth/
│   ├── auth.module.ts                     # Imports: Supabase, Common, Onboarding
│   ├── auth.controller.ts                 # /auth/* — signup, signin, OAuth, refresh, link, onboarding (414 lines)
│   ├── auth.service.ts                    # Supabase auth operations: signUp, signIn, OAuth (184 lines)
│   ├── connect.controller.ts              # /connect/:code — channel linking redirect flow (368 lines)
│   ├── middleware/
│   │   └── jwt.guard.ts                   # CanActivate: Bearer token or cookie → Supabase validate (53 lines)
│   ├── decorators/
│   │   └── user.decorator.ts              # @User() param decorator → req.user
│   ├── services/
│   │   ├── auth-profile.service.ts        # User profile + sessions from Supabase (76 lines)
│   │   └── auth-channel.service.ts        # Channel linking: link, unlink, createToken, status (271 lines)
│   └── dto/
│       ├── sign-up.dto.ts                 # email, password(6+), fullName, nickname?, locale?, timezone?
│       ├── sign-in.dto.ts                 # email, password(6+)
│       ├── link-channel.dto.ts            # linkCode (8-char hex), force? (boolean)
│       └── provider-login.dto.ts          # provider (@IsIn(['google'])), redirectTo?
│
├── onboarding/
│   ├── onboarding.module.ts               # Imports: Supabase, Common
│   ├── onboarding.service.ts              # Multi-step onboarding processor (425 lines)
│   └── dto/
│       └── onboarding.dto.ts              # OnboardingDto with nested answers (189 lines)
│
├── user/
│   ├── user.module.ts                     # UsersController, UsersService, JwtGuard
│   ├── user.controller.ts                 # /api/users/* — me, context, transactions (29 lines)
│   └── user.service.ts                    # DB queries for user profile/transactions (106 lines)
│
├── admin/
│   ├── admin.module.ts                    # AdminGuard, dashboard/messages/usage services
│   ├── admin.controller.ts                # /admin/* — dashboard, messages, users, usage (163 lines)
│   ├── guards/
│   │   └── admin.guard.ts                 # UUID whitelist + Supabase auth check (83 lines)
│   ├── dto/
│   │   ├── query.dto.ts                   # MessagesQueryDto, DashboardQueryDto
│   │   └── usage-query.dto.ts             # UsageQueryDto (month param)
│   └── services/
│       ├── admin-dashboard.service.ts     # Dashboard stats from bot_message_log (80 lines)
│       ├── admin-messages.service.ts      # Message queries, user chat, profile (256 lines)
│       └── admin-usage.service.ts         # OpenAI API usage analytics (268 lines)
│
└── bot/
    ├── bot.module.ts                      # All bot providers + adapters (50 lines)
    ├── bot.controller.ts                  # Webhook endpoints + rate limiting (184 lines)
    ├── bot.service.ts                     # Main orchestration loop (429 lines)
    ├── contracts.ts                       # DomainMessage type definition
    ├── adapters/
    │   ├── telegram.adapter.ts            # Telegram webhook → DomainMessage + send reply (106 lines)
    │   └── whatsapp.adapter.ts            # WhatsApp webhook → DomainMessage + send reply (61 lines)
    ├── delegates/
    │   └── bot-channel.service.ts         # Channel linking from bot side (283 lines)
    ├── actions/
    │   └── action-result.ts               # ActionResult interface + PendingData
    ├── services/
    │   ├── orchestrator.client.ts         # AI service HTTP client with circuit breaker (1009 lines)
    │   ├── orchestrator.contracts.ts      # Phase A/B types, RuntimeContext, OrchestratorError (156 lines)
    │   ├── user-context.service.ts        # Load & cache user context (Redis 60s) (200 lines)
    │   ├── guardrails.service.ts          # Validate & sanitize tool arguments (137 lines)
    │   ├── conversation.service.ts        # Conversation memory: summary + pending slots (142 lines)
    │   ├── metrics.service.ts             # Engagement tracking: streaks, week count, mood hints (178 lines)
    │   ├── cooldown.service.ts            # Nudge spam prevention: 24h global, 5h budget (132 lines)
    │   ├── style-detector.service.ts      # Regex-based user style detection (59 lines)
    │   └── message-log.service.ts         # Fire-and-forget log to bot_message_log table (41 lines)
    └── tools/
        ├── tool-registry.ts               # Handler map + fallback (186 lines)
        ├── tool-schemas.ts                # 6 tool schema definitions for AI (107 lines)
        ├── tool-handler.interface.ts       # ToolHandler interface + BaseToolHandler (81 lines)
        ├── index.ts                       # Re-exports
        └── handlers/
            ├── register-transaction.tool-handler.ts  # Record expense/income with slot-filling (296 lines)
            ├── ask-balance.tool-handler.ts            # Spending & budget query (228 lines)
            ├── ask-budget-status.tool-handler.ts      # Active budget check (72 lines)
            ├── ask-goal-status.tool-handler.ts        # Goals progress (99 lines)
            ├── ask-app-info.tool-handler.ts           # App info with static knowledge base (359 lines)
            ├── greeting.tool-handler.ts               # Simple greeting (40 lines)
            └── unknown.tool-handler.ts                # Fallback handler (43 lines)
```

**Total: 68 TypeScript files (~7,800+ lines)**

## Module Architecture

```
AppModule
├── ConfigModule.forRoot({ isGlobal: true })
├── RedisModule (@Global — provides RedisService)
├── SupabaseModule (@Global — provides 'SUPABASE' token)
├── CommonModule (@Global — ChannelLinkCodeService, DataParserService, AiWarmupService)
├── AuthModule
│   ├── AuthController (/auth/*)
│   ├── ConnectController (/connect/*)
│   ├── AuthService, AuthProfileService, AuthChannelService
│   ├── JwtGuard
│   └── imports: OnboardingModule
├── UsersModule
│   ├── UsersController (/api/users/*)
│   └── UsersService
├── BotModule
│   ├── BotController (webhooks, /bot/test)
│   ├── BotService (orchestration loop)
│   ├── TelegramAdapter, WhatsappAdapter
│   ├── BotChannelService
│   ├── UserContextService, ConversationService, MetricsService
│   ├── CooldownService, StyleDetectorService, GuardrailsService
│   ├── OrchestratorClient, MessageLogService
│   └── ToolRegistry (7 handlers)
└── AdminModule
    ├── AdminController (/admin/*)
    ├── AdminGuard (UUID whitelist)
    └── AdminDashboardService, AdminMessagesService, AdminUsageService
```

## All Endpoints

### Root
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | No | Health check → "Hola jose!!!" |

### Auth (`/auth`)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/auth/signup` | No | Email/password registration, sets HTTP-only cookies |
| POST | `/auth/signin` | No | Email/password login, sets cookies, triggers AI warmup |
| POST | `/auth/provider` | No | OAuth flow (Google only currently) |
| GET | `/auth/callback` | No | OAuth callback handler |
| POST | `/auth/refresh` | Cookie | Refresh access token from refresh_token cookie |
| POST | `/auth/logout` | No | Clear auth cookies |
| GET | `/auth/me` | JWT | Get authenticated user profile (with onboarding + link status) |
| GET | `/auth/sessions` | JWT | List user sessions |
| GET | `/auth/link-status` | JWT | Get channel linking status (all linked channels) |
| POST | `/auth/create-link-token` | JWT | Generate link code for web-initiated flow |
| POST | `/auth/link-channel` | JWT | Link channel via code (with force option) |
| POST | `/auth/unlink-channel` | JWT | Remove channel link |
| POST | `/auth/onboarding` | JWT | Submit onboarding answers (multi-step) |
| GET | `/auth/link-code-status/:code` | No | Check link code status (conflict/pending/used/expired/invalid) |

### Connect (`/connect`)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/connect/:code` | Cookie | Channel linking redirect flow (→ login → auto-link → success) |
| GET | `/connect/:code/api` | JWT | Channel linking JSON API |

### Bot (webhooks)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/telegram/webhook` | No | Telegram Bot API webhook |
| POST | `/whatsapp/webhook` | No | WhatsApp Cloud API webhook |
| POST | `/bot/test` | No | Test endpoint: `{ message, userId, channel?, verbose? }` |

### Users (`/api/users`)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/users/me` | JWT | User profile |
| GET | `/api/users/context` | JWT | Full user context (personality, goals, prefs, budgets) |
| GET | `/api/users/transactions?limit=` | JWT | User transactions (default 50, max 200) |

### Admin (`/admin`) — protected by AdminGuard
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/admin/check` | Admin | Verify admin access → `{ isAdmin: true }` |
| GET | `/admin/dashboard?hours=` | Admin | Dashboard stats (default 24h, max 168h) |
| GET | `/admin/messages?...` | Admin | Paginated messages (userId, channel, from, to, hasError, limit, offset) |
| GET | `/admin/messages/:id` | Admin | Single message detail with Phase A/B debug |
| GET | `/admin/users/:userId/chat?limit=` | Admin | User chat history |
| GET | `/admin/users/:userId/profile` | Admin | User profile with personality, budgets, goals |
| GET | `/admin/errors?limit=&offset=` | Admin | Messages with errors |
| GET | `/admin/users` | Admin | Active users list |
| GET | `/admin/usage?month=` | Admin | OpenAI API usage analytics |

## Bot Orchestration Loop (`bot.service.ts`)

The main processing flow in `BotService.handle()`:

```
1. Handle /start command (Telegram deep links) → return if handled
2. Lookup linked user (channel_accounts) → build link reply if not found
3. TWO-PHASE DEDUP: check msg:{msgId} → "done" (ignore) / "processing" (return) / missing (set "processing")
4. CONCURRENCY LOCK: acquire lock:{userId} (5s TTL) → "Dame un momento..." if busy
5. processMessage():
   a. Check DISABLE_AI → "En mantenimiento." if set
   b. LOAD ALL STATE in parallel:
      - UserContext (from Redis cache or 6 DB queries)
      - Conversation summary
      - Pending slot-fill state
      - User metrics (streak, week count)
      - Cooldown flags
   c. Detect user style (regex: lucas, chilenismos, emojis, formal)
   d. Get tool schemas + available categories
   e. Convert pending state for AI
   f. PHASE A: AI decides intent → tool_call / clarification / direct_reply
   g. If direct_reply or clarification → return immediately (no Phase B)
   h. GUARDRAILS: validate tool arguments
   i. EXECUTE TOOL HANDLER
   j. Record transaction metrics (if register_transaction + success)
   k. If handler returns userMessage (slot-fill) → save pending state → return
   l. Build RuntimeContext (summary, metrics, mood_hint, cooldowns, style)
   m. PHASE B: AI generates personalized response
   n. Save conversation summary (if Phase B returns new_summary)
   o. Record nudge cooldowns (if Phase B did_nudge=true)
   p. Clear pending state (if slot-fill completed)
6. On success: set msg:{msgId} = "done" (24h TTL)
7. On failure: delete msg:{msgId} (allow retry)
8. Release lock:{userId}
```

### Write Order (Transaction-like Pattern)
1. **LOAD** all state BEFORE processing (parallel)
2. **Phase A** (may fail — no state written yet)
3. **Tool execution** (may fail — no state written yet)
4. **Metrics** AFTER tool success only (`register_transaction`)
5. **Phase B** (may fail — but tool already executed → fallback message)
6. **Summary** AFTER Phase B success only
7. **Cooldowns** AFTER Phase B AND `did_nudge=true`
8. **Clear pending** if slot-fill completed

### ProcessingMetrics
Every request tracks: `correlationId`, `totalMs`, `contextMs`, `phaseAMs`, `toolMs`, `phaseBMs`, `phaseAResponse`, `toolName`, `toolResult`.

## Tool System

### 7 Handlers

| Tool | File | Lines | Context | DB Tables | Purpose |
|------|------|-------|---------|-----------|---------|
| `register_transaction` | register-transaction.tool-handler.ts | 296 | Yes | categories, payment_method, transactions | Record expense/income with slot-filling |
| `ask_balance` | ask-balance.tool-handler.ts | 228 | Yes | user_prefs, payment_method, transactions, spending_expectations | Spending & budget query |
| `ask_budget_status` | ask-budget-status.tool-handler.ts | 72 | Yes | spending_expectations | Active budget check |
| `ask_goal_status` | ask-goal-status.tool-handler.ts | 99 | Yes | goals | Goals progress with % |
| `ask_app_info` | ask-app-info.tool-handler.ts | 359 | No | None (static knowledge base) | App info, help, FAQ |
| `greeting` | greeting.tool-handler.ts | 40 | No | None | Returns `{ ok: true, action: 'none' }` → Phase B generates greeting |
| `unknown` | unknown.tool-handler.ts | 43 | No | None | Fallback: returns userMessage directly (skips Phase B) |

**Registration:** ToolRegistry registers 6 handlers in its map + sets `unknown` as `fallbackHandler`.

### register_transaction — Slot-Filling Logic

**Schema args:** `amount` (number, required), `category` (string, required), `posted_at` (string, optional), `description` (string, optional)

1. Accepts `_categories` injection from BotService (avoids redundant DB query)
2. If `amount` missing → return `{ userMessage: "¿Cuánto fue?", pending: { collectedArgs, missingArgs: ['amount'] } }`
3. If `category` missing → return `{ userMessage: "¿En qué categoría?", pending: { collectedArgs, missingArgs: ['category'] } }`
4. Category matching: exact (case-insensitive) → substring → typo tolerance (2 char diff)
5. If no category match → return `{ userMessage: "No encontré la categoría..." }`
6. Validate: amount > 0 AND < 100,000,000
7. Get default payment method (first by user_id)
8. INSERT into transactions with `source: 'chat_intent'`, `status: 'posted'`

### ask_balance — Unified vs Multi-Account

1. Check `user_prefs.unified_balance`
2. Query all payment methods + current month transactions
3. Aggregate spending per payment method
4. Get active budget from `spending_expectations`
5. Returns: `{ unifiedBalance, totalSpent, accounts[], activeBudget: { period, amount, remaining }, periodLabel }`

### ask_app_info — Static Knowledge Base

Contains 359 lines of static knowledge including:
- Identity (Gus/Tally, Chilean origin, personality)
- Current features (7 capabilities with examples and tips)
- Coming soon features (5 planned)
- Limitations (current version)
- Security info (privacy, encryption, no bank access)
- Getting started steps (5 steps)
- FAQ (6 Q&A pairs)
- Conversation style guidelines

Returns `{ appKnowledge, aiInstruction, userQuestion, suggestedTopic }` for Phase B to generate in-character response.

## AI Service Communication (`orchestrator.client.ts`)

### Timeouts
| Scenario | Timeout |
|----------|---------|
| Normal request (warm) | 8s |
| Cold start retry | 55s |
| Wake-up ping | 60s |
| Telegram send | 15s |
| WhatsApp send | 10s |

### Circuit Breaker
- Opens after **5 failures**, 30s cooldown, 2 half-open attempts to close
- States: CLOSED → OPEN (reject for 30s) → HALF_OPEN (test) → CLOSED
- When open: falls back to **stub mode** (pattern matching)

### Cold Start Handling (Render Free Tier)
1. Detects 502 response → calls `GET /health` to wake service (60s timeout)
2. If wake-up succeeds → retries the original request
3. If wake-up fails → throws `COLD_START` error → user sees "😴💤 Estoy despertando..."
4. `AiWarmupService` tracks warm/cold state (14-min threshold before Render sleeps)
5. On signin, triggers async warmup ping

### Stub Mode (Offline Fallback)
When AI service unavailable, `stubPhaseA` uses regex pattern matching:

| Pattern | Tool Called |
|---------|-----------|
| `hola/buenos/buenas/hey/hi` | direct_reply (greeting) |
| `gasté/compré/pagué` | register_transaction (extracts amount + category) |
| `saldo/balance/cuánto tengo` | ask_balance |
| `presupuesto/budget` | ask_budget_status |
| `meta/goal/ahorro` | ask_goal_status |
| App questions (regex) | ask_app_info (with suggestedTopic detection) |
| **Everything else** | ask_app_info with topic='conversation' |

Stub mode also handles **pending slot-fill completion** — tries to extract amount/category from user response and complete the pending transaction.

`stubPhaseB` generates formatted responses per tool (CLP formatting, budget info, goal progress, knowledge base answers).

## Key Contracts

### DomainMessage
```typescript
interface DomainMessage {
  channel: 'telegram' | 'whatsapp' | 'test';
  externalId: string;          // chat_id (TG) or phone (WA)
  platformMessageId: string;   // message_id (TG) or wamid (WA)
  text: string;
  timestamp: string;           // ISO-8601
  profileHint?: { displayName?: string; username?: string };
}
```

### ActionResult
```typescript
interface ActionResult {
  ok: boolean;
  action: string;
  data?: Record<string, any>;
  userMessage?: string;       // Direct response (skip Phase B)
  errorCode?: string;
  pending?: PendingData;      // For slot-filling
}

interface PendingData {
  collectedArgs: Record<string, unknown>;
  missingArgs: string[];
}
```

### MinimalUserContext (sent to AI)
```typescript
interface MinimalUserContext {
  userId: string;
  displayName: string | null;
  personality: { tone, intensity, mood } | null;
  prefs: { timezone, locale, notificationLevel, unifiedBalance } | null;
  activeBudgets: BudgetInfo[];   // All active budgets
  activeBudget: BudgetInfo | null; // First/primary budget (legacy)
  goalsCount: number;
  goalsSummary: string[];        // ["Viaje a Europa (45%)", ...]
  categories: CategoryInfo[];    // For matching in tool handlers
}
```

### RuntimeContext (extended Phase B context)
```typescript
interface RuntimeContext {
  summary?: string;           // Natural language conversation recap
  metrics?: {
    tx_streak_days: number;
    week_tx_count: number;
    budget_percent?: number;  // spent/amount (0.0-1.0+)
  };
  mood_hint?: -1 | 0 | 1;    // Backend hint for AI mood calculation
  can_nudge: boolean;         // 24h cooldown
  can_budget_warning: boolean; // 5h cooldown
  last_opening?: string;      // Anti-repetition
  user_style?: {
    uses_lucas: boolean;
    uses_chilenismos: boolean;
    emoji_level: 'none' | 'light' | 'moderate';
    is_formal: boolean;
  };
}
```

### Phase A Request/Response
```typescript
// Request includes pending slot context + available categories
interface PhaseARequest {
  phase: 'A';
  user_id?: string;
  user_text: string;
  user_context: AiUserContextPayload;
  tools: ToolSchema[];
  pending?: PendingSlotContext | null;
  available_categories?: string[];
}

// Response: tool_call | clarification | direct_reply
interface PhaseAResponse {
  phase: 'A';
  response_type: 'tool_call' | 'clarification' | 'direct_reply';
  tool_call?: { name: string; args: Record<string, any> };
  clarification?: string;
  direct_reply?: string;
}
```

### Phase B Request/Response
```typescript
interface PhaseBRequest {
  phase: 'B';
  tool_name: string;
  action_result: ActionResult;
  user_context: AiUserContextPayload;
  runtime_context?: RuntimeContext | null;
}

interface PhaseBResponse {
  phase: 'B';
  final_message: string;
  new_summary?: string;     // Backend persists to Redis
  did_nudge?: boolean;
  nudge_type?: 'budget' | 'goal' | 'streak';
}
```

### OrchestratorError Codes
| Code | When |
|------|------|
| `INVALID_PHASE` | Phase not "A" or "B" |
| `MISSING_USER_TEXT` | Phase A without user_text |
| `MISSING_ACTION_RESULT` | Phase B without action_result |
| `LLM_ERROR` | OpenAI API error |
| `LLM_TIMEOUT` | OpenAI timeout (>25s) |
| `INVALID_RESPONSE` | Malformed AI response |
| `COLD_START` | Render service sleeping (502 / ECONNABORTED) |

## Redis Architecture

### Key Patterns
| Key Pattern | TTL | Type | Description |
|-------------|-----|------|-------------|
| `ctx:{userId}` | 60s | JSON | User context cache (6 parallel DB queries) |
| `conv:{userId}:summary` | 2h (max 24h) | TEXT | Conversation recap |
| `conv:{userId}:pending` | 10m | JSON | Slot-fill state (tool, collectedArgs, missingArgs) |
| `conv:{userId}:cooldowns` | 30d | JSON | Nudge cooldown timestamps |
| `conv:{userId}:metrics` | 30d | JSON | Streak days, last tx, week count |
| `rl:{externalId}` | 60s | ZSET | Rate limit sliding window (30 msgs/min) |
| `lock:{userId}` | 5s | STRING | Concurrency lock (NX SET) |
| `msg:{msgId}` | 120s→24h | STRING | Two-phase dedup ("processing" → "done") |

### Fallback Behavior
- `MULTI_INSTANCE=false` (default): falls back to in-memory Map with warning
- `MULTI_INSTANCE=true`: throws 503 if Redis unavailable
- `RedisService` wraps ioredis with retry strategy (exponential backoff, 3 retries, 2s max)

## Resilience Patterns

### Rate Limiting
- **Config:** 30 msgs/60s per external user ID
- **Location:** `BotController.checkRateLimit()` via `AsyncRateLimiter`
- **Storage:** Redis sorted set (`rl:{externalId}`) with in-memory fallback
- **Response:** HTTP 429 "Demasiados mensajes. Espera un momento..."

### Circuit Breaker
- **Config:** Opens after 5 failures, 30s reset timeout, 2 half-open attempts
- **Location:** `OrchestratorClient` wraps all Phase A/B calls
- **Fallback:** Stub mode (regex pattern matching)
- **Stats:** Exposed via `getCircuitBreakerStats()` → `{ state, failures }`

### Two-Phase Message Dedup
```
Message arrives → Check msg:{msgId}
  "done"       → Ignore ("[duplicate ignored]")
  "processing" → Return "Procesando tu mensaje..."
  missing      → Set "processing" (120s TTL)

Success → Set "done" (24h TTL)
Failure → Delete key (allow retry)
```

### Concurrency Lock
```
Acquire lock:{userId} (5s TTL via NX SET)
  Success → Process message
  Failure → Delete dedup key → Return "Dame un momento..."
Finally → Release lock
```

### Retry with Backoff
- `withRetry()` in resilience.ts: 3 max attempts, 100ms base, 2s max delay
- Telegram adapter: 3 retries on 429/5xx with exponential backoff

## Authentication

### Cookie Configuration
| Cookie | Name | Max-Age | Flags |
|--------|------|---------|-------|
| Access | `access_token` | 1 hour | httpOnly, secure (prod), sameSite=lax, path=/ |
| Refresh | `refresh_token` | 7 days | httpOnly, secure (prod), sameSite=lax, path=/ |

### JwtGuard
Extracts token from `Authorization: Bearer` header OR `access_token` cookie → validates via Supabase `auth.getUser(jwt)` → attaches to `req.user`.

### Signup Flow
1. Validate DTO (email, password 6+, fullName)
2. `supabase.auth.signUp()` (email confirmation disabled)
3. Upsert to `users` table (package from DEFAULT_PACKAGE env or 'basic')
4. Set access + refresh cookies
5. Return `{ user, session, access_token }`

### OAuth
Only **Google** supported currently (ProviderLoginDto validates `@IsIn(['google'])`). Uses Supabase OAuth flow with redirect callback.

## Admin System

### AdminGuard
**Hardcoded UUID whitelist** checked first:
```
9d1454f5-4317-4baf-aec8-78bd8a06edb0
4c023f2d-a5c6-44c7-b44d-b3cb3913e5bb
```
Falls back to Supabase `app_metadata.role === 'admin'` check.

### AdminDashboardService
Queries `bot_message_log` for stats within time window (default 24h): total messages, active users, messages by channel, error count.

### AdminMessagesService
- Paginated message queries with filters (userId, channel, dateRange, hasError)
- User chat history with profile joins
- Message detail with Phase A/B debug JSON

### AdminUsageService
Queries OpenAI API usage data (external fetch to OpenAI usage endpoint) for cost tracking.

## Onboarding

### OnboardingService.processOnboarding() — 7 Steps
1. **upsertUserPrefs**: `unified_balance`, `notification_level`
2. **upsertPersonalitySnapshot**: `tone`, `intensity`, `mood='normal'`
3. **syncSpendingExpectations**: DELETE all → INSERT active budgets (daily/weekly/monthly)
4. **syncPaymentMethods**: DELETE all → INSERT methods (or create default "Cuenta Principal" if unified)
5. **syncCategories**: DELETE all → INSERT parent categories + children (parent_id hierarchy)
6. **syncGoals**: DELETE all → INSERT goals (target_amount default 1 if ≤0, progress capped)
7. **markOnboardingCompleted**: UPDATE `users.onboarding_completed = true`

### OnboardingDto Structure
```typescript
{
  answers: {
    notifications: 'none' | 'light' | 'medium' | 'intense',
    unifiedBalance: boolean,
    personality: { tone: ToneEnum, intensity: 0.0-1.0 },
    spendingExpectations: { daily?, weekly?, monthly? },  // { active, amount }
    categories: CategoryDto[],     // max 50, with children SubCategoryDto[]
    goals: GoalDto[],              // max 20
    payment_method: PaymentMethodDto[]  // max 20
  }
}
```

## Channel Adapters

### TelegramAdapter
- Parses: `message`, `edited_message`, `channel_post` from webhook body
- Extracts: chat_id → externalId, message_id → platformMessageId, text, displayName, username
- Reply: `POST https://api.telegram.org/bot{TOKEN}/sendMessage`
- Retry: 3 attempts, exponential backoff on 429/5xx
- Forces IPv4 for Docker compatibility

### WhatsappAdapter
- Parses: `entry[0].changes[0].value.messages[0]` from webhook body
- Extracts: msg.from (phone) → externalId, msg.id (wamid) → platformMessageId, msg.text.body
- Reply: `POST {GRAPH_API_BASE}/{VERSION}/{PHONE_ID}/messages`
- Payload: `{ messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body } }`
- Timeout: 10s, no retry

### Channel Linking Flow

**Bot-initiated (user messages bot first):**
1. User sends message → `lookupLinkedUser()` → null
2. `buildLinkReply()` → create 8-char hex code (10-min TTL) in `channel_link_codes`
3. Return URL: `/connect/{code}` with instructions
4. User clicks URL → `ConnectController.handleConnect()` → check auth → auto-link → redirect

**Web-initiated (user starts from web):**
1. `authApi.createLinkToken({channel})` → creates code with format "pending:{userId}"
2. User sends `/start CODE` to Telegram bot
3. `handleStartCommand()` detects "pending:" prefix → `completeWebInitiatedLink()`
4. Creates/updates `channel_accounts` entry → returns success message

**Conflict detection:** If channel already linked to different user, returns error or requires `force=true` to overwrite.

## Database Tables Accessed

| Table | Modules | Operations |
|-------|---------|------------|
| `users` | Auth, Onboarding, User, UserContext | SELECT, UPSERT, UPDATE |
| `user_prefs` | Onboarding, UserContext, AskBalance | SELECT, UPSERT |
| `personality_snapshot` | Onboarding, UserContext, User | SELECT, UPSERT, UPDATE |
| `channel_accounts` | BotChannel, AuthChannel, Connect | SELECT, INSERT, UPDATE, DELETE |
| `channel_link_codes` | ChannelLinkCode | SELECT, UPSERT (code), UPDATE (used_at) |
| `transactions` | RegisterTransaction, AskBalance, User | SELECT, INSERT |
| `categories` | RegisterTransaction, Onboarding, UserContext | SELECT, DELETE+INSERT |
| `payment_method` | RegisterTransaction, AskBalance, Onboarding | SELECT, DELETE+INSERT |
| `goals` | AskGoalStatus, Onboarding, UserContext, User | SELECT, DELETE+INSERT |
| `spending_expectations` | AskBudgetStatus, AskBalance, Onboarding, UserContext | SELECT, DELETE+INSERT |
| `bot_message_log` | MessageLog, AdminDashboard, AdminMessages | INSERT, SELECT |
| `my_sessions` | AuthProfile | SELECT |

**Tables in schema but NOT accessed by backend code:** `user_emotional_log`.

## Guardrails Validation

| Tool | Validations |
|------|------------|
| `register_transaction` | amount: > 0 AND < 100,000,000; category: 1-100 chars; description: < 500 chars |
| `ask_balance` | No validation |
| `ask_budget_status` | No validation |
| `ask_goal_status` | goalId: optional UUID format |
| `greeting` | No validation |
| `ask_app_info` | userQuestion: 1-1000 chars; suggestedTopic: < 50 chars |

**Sanitizers:** amount → round to 2 decimals; category → trim + lowercase; description → trim; userQuestion → trim; suggestedTopic → trim + lowercase + default 'other'.

## Style Detection (`style-detector.service.ts`)

| Detection | Regex |
|-----------|-------|
| `usesLucas` | `/lucas?\|luca\b/i` |
| `usesChilenismos` | `/cachai\|wena\|po\b\|bacán\|fome\|pega\|polola?\|al tiro\|altiro/i` |
| `emojiLevel` | Count emojis in Unicode ranges → 0: 'none', 1-2: 'light', 3+: 'moderate' |
| `isFormal` | `/usted\|podría\|estimado\|favor\|disculpe\|le agradezco/i` |

## Metrics & Mood System

### MetricsService
- **Streak logic:** same day → keep; consecutive day → increment; gap > 1 day → reset to 1
- **Week count:** resets if > 7 days since last transaction
- **Redis key:** `conv:{userId}:metrics` (30d TTL)

### MoodHint Calculation
| Condition | Hint |
|-----------|------|
| Budget spent > 90% | -1 (negative) |
| Streak ≥ 7 days | +1 (positive) |
| Budget spent < 25% | +1 (positive) |
| Week transactions ≥ 10 | +1 (positive) |
| Otherwise | 0 (neutral) |

### Cooldown System
| Cooldown | Duration | Purpose |
|----------|----------|---------|
| Global nudge | 24 hours | Prevent nudge spam |
| Budget warning | 5 hours | Rate limit budget alerts |
| Easter egg | Always false | MVP placeholder |

## Debug Logging (`debug-logger.ts`)

Structured logging with correlation IDs and emoji prefixes:
```
📥 RECV    — Incoming messages
📤 SEND    — Outgoing responses
🔄 PHASE-A/B — AI orchestration
🔧 TOOL    — Tool execution
💾 STATE   — State persistence
⚡ PERF    — Performance (green <100ms, yellow <500ms, red ≥500ms)
✅ OK      — Success
❌ ERR     — Errors
⚠️ WARN    — Warnings
🔗 LINK    — Channel linking
🎯 MATCH   — Category matching
⏳ PENDING — Pending state
🧩 SLOT    — Slot-filling
```

Config via env: `DEBUG_LOGS` (default true), `DEBUG_LEVEL`, `DEBUG_TIMESTAMP`, `DEBUG_COLORS`.

## Environment Variables

```bash
# Server
PORT=3000                          # Listen port (default 3000)
NODE_ENV=development               # Environment
APP_BASE_URL=http://localhost:3000 # Backend base URL for link generation

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# AI Service
AI_SERVICE_URL=http://localhost:8000  # FastAPI AI service URL

# Redis
REDIS_URL=redis://localhost:6379     # Optional — falls back to in-memory
MULTI_INSTANCE=false                 # If true, fail hard when Redis unavailable

# Telegram
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_SECRET=secret               # Webhook verification

# WhatsApp
WHATSAPP_TOKEN=EAAx...
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_GRAPH_API_BASE=https://graph.facebook.com
WHATSAPP_GRAPH_API_VERSION=v17.0

# Frontend
CORS_ORIGINS=http://localhost:5173   # Comma-separated allowed origins
LINK_ACCOUNT_URL=http://localhost:5173/connect/  # Frontend URL for redirects

# Feature Flags
DISABLE_AI=0                         # Set to "1" for maintenance mode (returns "En mantenimiento.")
DEFAULT_PACKAGE=basic                # Default user package tier

# Debug
DEBUG_LOGS=true                      # Enable structured logging
DEBUG_LEVEL=debug                    # Log level
```

## Adding a New Tool Handler

1. Create handler in `src/bot/tools/handlers/` implementing `ToolHandler`:

```typescript
export class MyToolHandler implements ToolHandler {
  readonly name = 'my_tool';

  readonly schema: ToolSchema = {
    name: 'my_tool',
    description: 'Description for AI',
    parameters: {
      type: 'object',
      properties: { /* ... */ },
      required: [],
    },
  };

  readonly requiresContext = true; // or false

  constructor(private readonly supabase: SupabaseClient) {}

  async execute(
    userId: string,
    msg: DomainMessage,
    args: Record<string, unknown>,
  ): Promise<ActionResult> {
    return { ok: true, action: 'my_tool', data: { /* ... */ } };
  }
}
```

2. Register in `ToolRegistry` constructor:
```typescript
this.registerAll([
  // ... existing handlers
  new MyToolHandler(supabase),
]);
```

3. Add guardrails validation in `GuardrailsService` schema map.

4. Add stub response in `OrchestratorClient.stubPhaseB()` for offline fallback.

5. Add stub pattern in `OrchestratorClient.stubPhaseA()` if the tool has detectable patterns.
