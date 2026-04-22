# Backend — TallyFinance (V3)

**NestJS backend for TallyFinance.** Handles webhooks, Gemini-powered AI chat, database operations, auth, onboarding, and admin.

**V3 Architecture:** Single-pass Gemini function calling. No external AI service. The backend handles everything: intent detection, tool execution, and personality-driven response generation in one Gemini conversation turn.

## Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| NestJS | 11.0 | Framework |
| TypeScript | 5.7 | Language |
| @google/generative-ai | latest | Gemini SDK (function calling) |
| Supabase JS | 2.76 | Database + Auth client |
| ioredis | 5.4 | Redis client |
| axios | 1.12 | HTTP client (Telegram, WhatsApp APIs) |
| class-validator | 0.14 | DTO validation |
| class-transformer | 0.5 | DTO transformation |
| argon2 | 0.44 | Password hashing |
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
├── app.module.ts                          # Root module: Config, Redis, Supabase, Auth, Users, Bot, Admin, Categories
├── app.controller.ts                      # GET / → health check
├── app.service.ts                         # AppService.getHello()
│
├── supabase/
│   └── supabase.module.ts                 # @Global provider 'SUPABASE' — SupabaseClient factory
│
├── redis/
│   ├── redis.module.ts                    # @Global provider RedisService
│   ├── redis.service.ts                   # Redis wrapper with in-memory fallback
│   ├── redis.health.ts                    # Health indicator for Redis
│   ├── keys.ts                            # All Redis key patterns + TTL constants
│   └── index.ts                           # Re-exports
│
├── common/
│   ├── common.module.ts                   # @Global: ChannelLinkCodeService, DataParserService
│   └── utils/
│       ├── resilience.ts                  # withRetry, CircuitBreaker, RateLimiter, AsyncRateLimiter
│       ├── debug-logger.ts                # Structured logging with correlation IDs
│       ├── data-parser.service.ts         # Amount parsing, masked digits
│       └── channel-link-code.service.ts   # Link code CRUD: create, consume, peek, conflicts
│
├── auth/
│   ├── auth.module.ts                     # Imports: Supabase, Common, Onboarding
│   ├── auth.controller.ts                 # /auth/* — signup, signin, OAuth, refresh, link, onboarding
│   ├── auth.service.ts                    # Supabase auth operations: signUp, signIn, OAuth
│   ├── connect.controller.ts              # /connect/:code — channel linking redirect flow
│   ├── middleware/
│   │   └── jwt.guard.ts                   # CanActivate: Bearer token or cookie → Supabase validate
│   ├── decorators/
│   │   └── user.decorator.ts              # @User() param decorator → req.user
│   ├── services/
│   │   ├── auth-profile.service.ts        # User profile + sessions from Supabase
│   │   └── auth-channel.service.ts        # Channel linking: link, unlink, createToken, status
│   └── dto/
│       ├── sign-up.dto.ts                 # email, password(6+), fullName, nickname?, locale?, timezone?
│       ├── sign-in.dto.ts                 # email, password(6+)
│       ├── link-channel.dto.ts            # linkCode (8-char hex), force? (boolean)
│       └── provider-login.dto.ts          # provider (@IsIn(['google'])), redirectTo?
│
├── onboarding/
│   ├── onboarding.module.ts               # Imports: Supabase, Common
│   ├── onboarding.service.ts              # Multi-step onboarding processor
│   └── dto/
│       └── onboarding.dto.ts              # OnboardingDto with nested answers
│
├── user/
│   ├── user.module.ts                     # UsersController, UsersService, JwtGuard
│   ├── user.controller.ts                 # /api/users/* — me, context, transactions
│   └── user.service.ts                    # DB queries for user profile/transactions
│
├── categories/
│   ├── categories.module.ts               # REST API for category CRUD
│   ├── categories.controller.ts           # /api/categories — CRUD endpoints (JWT-protected)
│   ├── categories.service.ts              # Category DB operations
│   └── dto/
│       ├── create-category.dto.ts         # name, icon?, budget?, parent_id?
│       └── update-category.dto.ts         # Partial update fields
│
├── admin/
│   ├── admin.module.ts                    # AdminGuard, dashboard/messages/usage services
│   ├── admin.controller.ts                # /admin/* — dashboard, messages, users, usage
│   ├── guards/
│   │   └── admin.guard.ts                 # UUID whitelist + Supabase auth check
│   ├── dto/
│   │   ├── query.dto.ts                   # MessagesQueryDto, DashboardQueryDto
│   │   └── usage-query.dto.ts             # UsageQueryDto (month param)
│   └── services/
│       ├── admin-dashboard.service.ts     # Dashboard stats from bot_message_log
│       ├── admin-messages.service.ts      # Message queries, user chat, profile
│       └── admin-usage.service.ts         # API usage analytics
│
└── bot/
    ├── bot.module.ts                      # All bot providers + adapters
    ├── bot.controller.ts                  # Webhook endpoints + rate limiting + test endpoints
    ├── contracts.ts                       # DomainMessage, MediaAttachment, Channel types
    ├── adapters/
    │   ├── telegram.adapter.ts            # TG webhook → DomainMessage + send reply + media download
    │   └── whatsapp.adapter.ts            # WA webhook → DomainMessage + send reply + media download
    ├── delegates/
    │   └── bot-channel.service.ts         # Channel linking, /start command, unlinked user flow
    ├── actions/
    │   └── action-block.ts                # BotReply, BotButton types
    ├── services/
    │   ├── callback-handler.service.ts    # Undo button handlers (tx, category, rename)
    │   ├── user-context.service.ts        # Load & cache user context (Redis 60s, 7 parallel DB queries)
    │   ├── metrics.service.ts             # Streaks, weekly activity, mood hints
    │   ├── message-log.service.ts         # Fire-and-forget log to bot_message_log
    │   └── response-builder.service.ts    # Deterministic card builder (confirmations, undo buttons)
    └── v3/
        ├── bot-v3.service.ts              # Core V3 orchestration (~540 lines)
        ├── conversation-v3.service.ts     # Redis-backed Gemini conversation history
        ├── gemini.client.ts               # Gemini SDK wrapper + function calling loop
        ├── function-declarations.ts       # 9 Gemini tool declarations
        ├── function-router.ts             # Routes function calls → handlers
        ├── prompts/
        │   └── gus_system.txt             # System prompt (377 lines)
        └── functions/
            ├── register-expense.fn.ts     # Expense registration + reactive context + auto-create category
            ├── register-income.fn.ts      # Income registration + income_expectations linking
            ├── query-transactions.fn.ts   # List/sum/count transactions with filters
            ├── edit-transaction.fn.ts     # Edit transaction by ID or hints
            ├── delete-transaction.fn.ts   # Delete transaction + balance revert
            ├── manage-category.fn.ts      # Category CRUD (list, create, rename, delete, update_icon, update_budget)
            ├── get-balance.fn.ts          # Balance + budget + breakdown query
            ├── set-balance.fn.ts          # Set account balance directly
            ├── get-app-info.fn.ts         # Static knowledge base
            ├── emoji-mapper.ts            # Category emoji lookup (118 lines)
            └── shared/
                ├── chile-time.ts          # getChileTimestamp() — ISO-8601 with Chile offset
                ├── date-range.ts          # getDateRange() — today/week/month/year/custom
                ├── resolve-transaction.ts # resolveTransaction() — by ID or hints (amount, category, name)
                └── index.ts              # Re-exports
```

**Total: 77 TypeScript files (~10,700 lines)**

## Module Architecture

```
AppModule
├── ConfigModule.forRoot({ isGlobal: true })
├── RedisModule (@Global — provides RedisService)
├── SupabaseModule (@Global — provides 'SUPABASE' token)
├── AuthModule
│   ├── AuthController (/auth/*)
│   ├── ConnectController (/connect/*)
│   ├── AuthService, AuthProfileService, AuthChannelService
│   ├── JwtGuard
│   └── imports: OnboardingModule
├── UsersModule
│   ├── UsersController (/api/users/*)
│   └── UsersService
├── CategoriesModule
│   ├── CategoriesController (/api/categories)
│   └── CategoriesService
├── BotModule
│   ├── BotController (webhooks, /bot/test, /bot/test-v3)
│   ├── BotV3Service (V3 orchestration)
│   ├── GeminiClient (Gemini SDK + function calling loop)
│   ├── ConversationV3Service (Redis conversation history)
│   ├── TelegramAdapter, WhatsappAdapter
│   ├── BotChannelService
│   ├── CallbackHandlerService (undo buttons)
│   ├── UserContextService (Redis-cached context)
│   ├── MetricsService (streaks, weekly activity)
│   ├── MessageLogService (fire-and-forget)
│   └── ResponseBuilderService (deterministic cards)
└── AdminModule
    ├── AdminController (/admin/*)
    ├── AdminGuard (UUID whitelist)
    └── AdminDashboardService, AdminMessagesService, AdminUsageService
```

## All Endpoints

### Root
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | No | Health check |

### Auth (`/auth`)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/auth/signup` | No | Email/password registration, sets HTTP-only cookies |
| POST | `/auth/signin` | No | Email/password login, sets cookies |
| POST | `/auth/provider` | No | OAuth flow (Google only) |
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
| GET | `/connect/:code` | Cookie | Channel linking redirect flow |
| GET | `/connect/:code/api` | JWT | Channel linking JSON API |

### Bot (webhooks + test)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/telegram/webhook` | No | Telegram Bot API webhook → BotV3Service |
| POST | `/whatsapp/webhook` | No | WhatsApp Cloud API webhook → BotV3Service |
| POST | `/bot/test` | No | Test: `{ message, userId, channel?, verbose? }` |
| POST | `/bot/test-v3` | No | V3 test: `{ message, userId, reset? }` |

### Users (`/api/users`)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/users/me` | JWT | User profile |
| GET | `/api/users/context` | JWT | Full user context (personality, goals, prefs, budgets) |
| GET | `/api/users/transactions?limit=` | JWT | User transactions (default 50, max 200) |

### Categories (`/api/categories`)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/categories` | JWT | List user categories |
| POST | `/api/categories` | JWT | Create category |
| PATCH | `/api/categories/:id` | JWT | Update category |
| DELETE | `/api/categories/:id?force=` | JWT | Delete category (force=true to unlink transactions) |

### Admin (`/admin`) -- protected by AdminGuard
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/admin/check` | Admin | Verify admin access |
| GET | `/admin/dashboard?hours=` | Admin | Dashboard stats (default 24h, max 168h) |
| GET | `/admin/messages?...` | Admin | Paginated messages (userId, channel, from, to, hasError, limit, offset) |
| GET | `/admin/messages/:id` | Admin | Single message detail with debug JSON |
| GET | `/admin/users/:userId/chat?limit=` | Admin | User chat history |
| GET | `/admin/users/:userId/profile` | Admin | User profile with personality, budgets, goals |
| GET | `/admin/errors?limit=&offset=` | Admin | Messages with errors |
| GET | `/admin/users` | Admin | Active users list |
| GET | `/admin/usage?month=` | Admin | API usage analytics |

## V3 Pipeline (`bot-v3.service.ts`)

The V3 architecture replaces the old two-phase AI orchestration with a single Gemini conversation turn. Gemini handles intent detection, function calling, and response generation all in one pass.

```
User message → Channel Adapter → BotController → BotV3Service.handle()

1. DEDUP CHECK: msg:{messageId} → "done" (ignore) / "processing" (return) / missing (set "processing", 120s TTL)
2. CONCURRENCY LOCK: acquire lock:{userId} (5s TTL) → "Dame un momento..." if busy
3. TOKEN LIMIT CHECK: daily 2M token limit per user
4. LOAD USER CONTEXT: displayName, tone, mood, categories, budgets, accounts (from Redis cache or 7 DB queries)
5. BUILD SYSTEM PROMPT: template variable substitution ({tone}, {mood}, {displayName}, {categories}, {budgets}, {accounts})
6. QUICK RESPONSE CHECK: dashboard/link keywords → deterministic reply (no Gemini call)
7. LOAD CONVERSATION HISTORY: from Redis (conv:v3:{userId}, 4h TTL, max 50 entries)
8. BUILD USER MESSAGE: text + inline media (base64 images/audio)
9. CREATE FUNCTION EXECUTOR: createFunctionRouter(supabase, userId)
10. GEMINI CHAT: sendMessage with function declarations → function calling loop (max 10 iterations)
    a. Gemini returns functionCalls → reorder (deletes → creates → rest)
    b. Execute each function → return results to Gemini
    c. Repeat until Gemini returns text response (no more function calls)
11. SAVE CONVERSATION: append function calls + responses + final reply to history
12. TRACK TOKENS: daily + monthly counters in Redis
13. POST-ACTION: record metrics (streaks) on tx registration, invalidate context cache on mutations
14. LOG MESSAGE: fire-and-forget to bot_message_log
15. BUILD REPLIES: deterministic confirmation cards (ResponseBuilderService) + Gemini text response

On success: set msg:{messageId} = "done" (24h TTL)
On failure: delete msg:{messageId} (allow retry)
Finally: release lock:{userId}
```

### GeminiClient (`gemini.client.ts`)

Core AI client that wraps `@google/generative-ai`:

- Model: `gemini-2.5-flash` (configurable)
- System instruction: injected per-request (user-specific prompt)
- Tool config: `functionCallingConfig: { mode: 'AUTO' }`
- Function calling loop: max 10 iterations
- Reorders parallel function calls: `delete_transaction` first, then `manage_category(create)`, then everything else
- Tracks token usage: input + output per response, accumulated across loop iterations

Returns `GeminiResult`:
```typescript
interface GeminiResult {
  reply: string;                          // Final text response
  functionsCalled: {
    name: string;
    args: Record<string, any>;
    result: any;
  }[];
  tokensUsed: { input: number; output: number; total: number };
}
```

### ConversationV3Service (`conversation-v3.service.ts`)

Redis-backed conversation memory in Gemini's native `Content[]` format:

- Key: `conv:v3:{userId}` (4h TTL)
- Max entries: 50 (FIFO trim)
- Strips `inlineData` (base64 media) before saving to conserve space
- Ensures history starts with `role: 'user'` (Gemini SDK requirement)
- Supports `/reset` command to clear history

### Quick Responses

Pattern-matched responses that skip the Gemini call entirely:

| Pattern | Response |
|---------|----------|
| `dashboard\|link\|web\|app\|pagina\|reporte\|configurar` | Dashboard URL with tone-adapted message |

Dashboard messages are customized per tone (neutral, friendly, serious, motivational, strict, toxic).

## Function Handlers (9 functions)

All function handlers are pure async functions: `(supabase, userId, args) => Promise<Record<string, any>>`. No class hierarchy, no DI -- just functions.

### register_expense

**Args:** `amount` (required), `category`, `name`, `posted_at`, `description`

1. Validate amount (> 0 AND < 100M)
2. Match category: exact (case-insensitive) → substring → synonym → typo tolerance (2 char) → loose similarity (4 char, returns suggestion) → auto-create with emoji
3. Get default account from `accounts` table
4. INSERT transaction with `source: 'chat_intent'`, `type: 'expense'`
5. Update account balance via `update_account_balance` RPC
6. Compute **reactive context** (5 parallel queries): today's total, account balance, monthly/daily/category budget status, category frequency
7. Detect **ant expense** (gasto hormiga): amount <= $5,000 CLP in typical categories (cafe, snack, etc.)

**Synonym map:** Maps common words to canonical categories (comida/almuerzo -> Alimentacion, uber/taxi -> Transporte, etc.)

### register_income

**Args:** `amount` (required), `source`, `posted_at`, `description`, `recurring`, `period`

1. Validate amount
2. Match existing `income_expectations` by name/source
3. If recurring and no match, create new income_expectation
4. INSERT transaction with `type: 'income'`, linked to income_expectation
5. Update account balance
6. Compute reactive context (balance + budget headroom)

### query_transactions

**Args:** `operation` (required: list/sum/count), `type`, `category`, `period`, `start_date`, `end_date`, `limit`, `search`

Operations:
- `list`: Returns transactions with category join, ordered by date, limit 1-50
- `sum`: Returns total amount + count
- `count`: Returns count only

### edit_transaction

**Args:** `transaction_id`, `hint_amount`, `hint_category`, `hint_name`, `new_amount`, `new_category`, `new_name`, `new_description`, `new_posted_at`

1. Resolve transaction via `resolveTransaction()` (by ID or hints)
2. Build update payload with previous/new values
3. Resolve new category (exact match → substring match)
4. UPDATE transaction
5. Adjust account balance if amount changed

### delete_transaction

**Args:** `transaction_id`, `hint_amount`, `hint_category`, `hint_name`

1. Resolve transaction via `resolveTransaction()`
2. DELETE transaction
3. Revert account balance
4. Return reactive context (updated balance)

### manage_category

**Args:** `operation` (required: list/create/rename/delete/update_icon/update_budget), `name`, `new_name`, `icon`, `budget`, `force_delete`

- `create`: Check duplicates, max 50 categories, auto-pick emoji via `pickCategoryEmoji()`
- `delete`: Check for linked transactions, require `force_delete` to proceed, unlinks transactions
- `rename`: Case-insensitive lookup, update name
- `update_icon` / `update_budget`: Simple field updates

### get_balance

**Args:** `period`, `start_date`, `end_date`, `category`, `include_budget`, `include_breakdown`

Returns: totalBalance, totalSpent, totalIncome, netFlow, accounts list, optional budget status, optional category breakdown.

### set_balance

**Args:** `amount` (required), `account_name`

Updates `current_balance` directly on the account. NOT a transaction -- just a balance correction.

### get_app_info

**Args:** `question`

Returns static knowledge base (identity, capabilities, channels, limitations, security, getting started, coming soon, FAQ) for Gemini to formulate a response.

### Shared Utilities (`functions/shared/`)

| Utility | Purpose |
|---------|---------|
| `getChileTimestamp()` | ISO-8601 timestamp with Chile timezone offset |
| `getDateRange(period, start?, end?)` | Calculate start/end/label for today/week/month/year/custom |
| `resolveTransaction(supabase, userId, args)` | Find transaction by UUID or hints (amount, category, name). Returns single match, array (ambiguous), or null |

## Response Building (`response-builder.service.ts`)

Deterministic card builder that produces structured `BotReply` objects with HTML formatting and undo buttons. Called by `BotV3Service.buildReplies()` after Gemini execution.

### Reply Structure

Each function result can produce a confirmation card. Cards are sent BEFORE Gemini's text response:

```
[Confirmation Card 1]    ← deterministic, with undo button
[Confirmation Card 2]    ← if multiple functions were called
[Gemini text response]   ← personality-driven commentary
```

### Confirmation Templates

| Function | Card Format |
|----------|------------|
| `register_expense` | `$Amount -- Name` + `Icon Category . Date` + Undo button |
| `register_income` | `$Amount -- Source` + `Income . Date` + Undo button |
| `delete_transaction` | `Deleted $Amount in Category` + Restore button |
| `edit_transaction` | `Edited: Field: Old -> New` + Revert button |
| `query_transactions` (list) | Numbered transaction list with icons |
| `query_transactions` (sum) | `Total: $Amount (N transactions)` |
| `manage_category` | Operation-specific (created, renamed, deleted, listed) |
| `get_balance` | Balance + Spent + Budget status |
| `set_balance` | `Balance updated: $Amount` |

### Undo Buttons

Buttons have a `callbackData` pattern and 60s expiration:

| Action | Callback Pattern |
|--------|-----------------|
| Undo transaction | `undo:tx:{txId}` |
| Undo group | `undo:group:{id1},{id2},...` |
| Delete new category | `undo:cat:{catName}` |
| Revert rename | `undo:cat_rename:{from}:{to}` |

## Callback Handler (`callback-handler.service.ts`)

Handles button presses from Telegram inline keyboards and WhatsApp interactive buttons:

- `undo:tx:{id}` — Delete the transaction (verify ownership first)
- `undo:group:{ids}` — Delete multiple transactions
- `undo:cat:{name}` — Delete a category by name
- `undo:cat_rename:{from}:{to}` — Revert a category rename

In Telegram, the callback edits the original message text. In WhatsApp, it sends a new reply.

## Key Contracts

### DomainMessage
```typescript
type Channel = 'telegram' | 'whatsapp' | 'test';
type MediaType = 'image' | 'audio' | 'document';

interface MediaAttachment {
  type: MediaType;
  mimeType: string;       // image/jpeg, audio/ogg, application/pdf
  data: string;           // base64-encoded bytes
  fileName?: string;
}

interface DomainMessage {
  channel: Channel;
  externalId: string;          // chat_id (TG) or phone (WA)
  platformMessageId: string;   // message_id (TG) or wamid (WA)
  text: string;
  timestamp: string;           // ISO-8601
  profileHint?: { displayName?: string; username?: string };
  media?: MediaAttachment[];
}
```

### BotReply / BotButton
```typescript
interface BotButton {
  text: string;
  callbackData: string;
  expiresIn?: number;     // seconds
}

interface BotReply {
  text: string;
  buttons?: BotButton[];
  parseMode?: 'HTML';
  skipSend?: boolean;     // Internal flag (e.g. dedup markers)
}
```

### BotV3Result
```typescript
interface BotV3Result {
  reply: string;           // Gemini's final text response
  replies: BotReply[];     // Confirmation cards + text
  functionsCalled: { name: string; args: Record<string, any>; result: any }[];
  tokensUsed: { input: number; output: number; total: number };
}
```

### MinimalUserContext
```typescript
interface MinimalUserContext {
  userId: string;
  displayName: string | null;
  personality: { tone: string | null; intensity: number | null; mood: string | null } | null;
  prefs: { timezone: string | null; locale: string | null; notificationLevel: string | null; unifiedBalance: boolean | null } | null;
  activeBudgets: BudgetInfo[];   // All active budgets (daily, weekly, monthly)
  activeBudget: BudgetInfo | null; // Legacy: first/primary budget
  goalsCount: number;
  goalsSummary?: string[];
  categories?: CategoryInfo[];   // For matching in function handlers
  accounts?: AccountInfo[];      // User accounts with balance
}
```

## Redis Architecture

### Key Patterns
| Key Pattern | TTL | Type | Description |
|-------------|-----|------|-------------|
| `ctx:{userId}` | 60s | JSON | User context cache (7 parallel DB queries) |
| `conv:v3:{userId}` | 4h | JSON | Gemini conversation history (Content[], max 50 entries) |
| `conv:{userId}:metrics` | 30d | JSON | Streak days, last tx, week count |
| `rl:{externalId}` | 60s | ZSET | Rate limit sliding window (30 msgs/min) |
| `lock:{userId}` | 5s | STRING | Concurrency lock (NX SET) |
| `msg:{msgId}` | 120s→24h | STRING | Two-phase dedup ("processing" → "done") |
| `tokens:daily:{userId}` | 24h | STRING | Daily token usage counter |
| `tokens:monthly:{userId}` | 30d | STRING | Monthly token usage counter |

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

### Two-Phase Message Dedup
```
Message arrives → Check msg:{msgId}
  "done"       → Return empty (skip)
  "processing" → Return "Procesando tu mensaje anterior..."
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

### Token Limit
- Daily limit: 2,000,000 tokens per user
- When exceeded: "Has alcanzado tu limite diario de mensajes. Vuelve manana..."
- Non-blocking on Redis failure (allows the message)

### Cache Invalidation
After any mutation function (`register_expense`, `register_income`, `edit_transaction`, `delete_transaction`, `manage_category`, `set_balance`), the user context cache is invalidated so the next message has fresh data.

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
Only **Google** supported (ProviderLoginDto validates `@IsIn(['google'])`). Uses Supabase OAuth flow with redirect callback.

## Admin System

### AdminGuard
**Hardcoded UUID whitelist** checked first, then falls back to Supabase `app_metadata.role === 'admin'` check.

### Services
- **AdminDashboardService:** Dashboard stats from `bot_message_log` within time window (total messages, active users, by channel, error count)
- **AdminMessagesService:** Paginated messages with filters, user chat history, message detail with debug JSON
- **AdminUsageService:** API usage analytics

## Onboarding

### OnboardingService.processOnboarding() -- 7 Steps
1. **upsertUserPrefs**: `unified_balance`, `notification_level`
2. **upsertPersonalitySnapshot**: `tone`, `intensity`, `mood='normal'`
3. **syncSpendingExpectations**: DELETE all → INSERT active budgets (daily/weekly/monthly)
4. **syncPaymentMethods**: DELETE all → INSERT methods (or create default "Cuenta Principal" if unified)
5. **syncCategories**: DELETE all → INSERT parent categories + children (parent_id hierarchy)
6. **syncGoals**: DELETE all → INSERT goals (target_amount default 1 if <=0, progress capped)
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
- Buttons: inline keyboard via `sendReplyWithButtons()`
- Edit: `editMessageText()` for callback responses
- Typing indicator: `startTyping()` repeats every 4s until `stopTyping()` is called
- Media download: photos (highest resolution), voice messages, documents → base64
- Retry: 3 attempts, exponential backoff on 429/5xx
- Forces IPv4 for Docker compatibility

### WhatsappAdapter
- Parses: `entry[0].changes[0].value.messages[0]` from webhook body
- Extracts: msg.from (phone) → externalId, msg.id (wamid) → platformMessageId, msg.text.body
- Reply: `POST {GRAPH_API_BASE}/{VERSION}/{PHONE_ID}/messages`
- Buttons: interactive button messages via `sendInteractiveReply()`
- Media download: images, audio, documents → base64
- Mark as read: `markAsRead()` for blue checkmarks
- Timeout: 10s, no retry
- Verification handshake: `verifyChallenge(query)` — used by `GET /whatsapp/webhook` to answer Meta's `hub.challenge` when `hub.verify_token` matches `WHATSAPP_VERIFY_TOKEN`

### Meta WhatsApp setup (Cloud API)

Prod webhook URL: `https://tally-combined.onrender.com/whatsapp/webhook`

1. In Meta App dashboard → WhatsApp → Configuration → Webhook → Edit:
   - **Callback URL**: prod webhook URL above
   - **Verify Token**: must match `WHATSAPP_VERIFY_TOKEN` env var
   - Meta hits `GET /whatsapp/webhook` → returns `hub.challenge` if match
2. Subscribe to the `messages` field in "Webhook fields".
3. Add recipient phone numbers in API Setup (sandbox: only verified numbers receive messages).
4. For production: generate a permanent **System User token** (24h tokens die — don't use in Render).
5. HMAC signature guard (`WhatsappWebhookGuard`) is disabled by default. Enable by (a) `rawBody: true` in `main.ts`, (b) adding `WHATSAPP_APP_SECRET` env var + provider in `bot.module.ts`, (c) uncommenting `@UseGuards` on the POST handler.

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

## Gus -- AI Character

Gus is configured via the system prompt (`gus_system.txt`, 377 lines) with dynamic variable substitution:

| Variable | Source | Description |
|----------|--------|-------------|
| `{tone}` | `personality_snapshot.tone` | neutral, friendly, serious, motivational, strict |
| `{mood}` | `personality_snapshot.mood` | normal, happy, disappointed, tired, hopeful, frustrated, proud |
| `{displayName}` | `users.nickname` or `users.full_name` | User's name |
| `{categories}` | `categories` table | Comma-separated list of user's categories |
| `{budgets}` | `spending_expectations` table | Active budgets with amounts |
| `{accounts}` | `accounts` table | Account names and balances |

The system prompt includes: identity rules, personality instructions per tone, response formatting rules, function calling guidelines, Chilean Spanish rules ("lucas" = x1000 CLP), and anti-patterns to avoid.

## Metrics System

### MetricsService
- **Streak logic:** same day → keep; consecutive day → increment; gap > 1 day → reset to 1
- **Week count:** resets if > 7 days since last transaction
- **Redis key:** `conv:{userId}:metrics` (30d TTL)
- **Recorded after:** successful `register_expense` or `register_income` calls

### MoodHint Calculation
| Condition | Hint |
|-----------|------|
| Budget spent > 90% | -1 (negative) |
| Streak >= 7 days | +1 (positive) |
| Budget spent < 25% | +1 (positive) |
| Week transactions >= 10 | +1 (positive) |
| Otherwise | 0 (neutral) |

## Database Tables Accessed

| Table | Modules | Operations |
|-------|---------|------------|
| `users` | Auth, Onboarding, User, UserContext | SELECT, UPSERT, UPDATE |
| `user_prefs` | Onboarding, UserContext | SELECT, UPSERT |
| `personality_snapshot` | Onboarding, UserContext, User | SELECT, UPSERT, UPDATE |
| `channel_accounts` | BotChannel, AuthChannel, Connect | SELECT, INSERT, UPDATE, DELETE |
| `channel_link_codes` | ChannelLinkCode | SELECT, UPSERT, UPDATE |
| `transactions` | V3 functions, User, CallbackHandler | SELECT, INSERT, UPDATE, DELETE |
| `categories` | V3 functions, Onboarding, UserContext, CategoriesAPI | SELECT, INSERT, UPDATE, DELETE |
| `accounts` | V3 functions, UserContext | SELECT, UPDATE |
| `income_expectations` | register_income | SELECT, INSERT |
| `spending_expectations` | V3 functions, Onboarding, UserContext | SELECT, DELETE+INSERT |
| `goals` | Onboarding, UserContext, User | SELECT, DELETE+INSERT |
| `bot_message_log` | MessageLog, AdminDashboard, AdminMessages | INSERT, SELECT |
| `my_sessions` | AuthProfile | SELECT |

**Tables in schema but NOT accessed by code:** `user_emotional_log`.

## Environment Variables

```bash
# Server
PORT=3000                          # Listen port (default 3000)
NODE_ENV=development               # Environment
APP_BASE_URL=http://localhost:3000 # Backend base URL for link generation

# Gemini
GEMINI_API_KEY=AIza...             # Google Gemini API key

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Redis
REDIS_URL=redis://localhost:6379     # Optional — falls back to in-memory
MULTI_INSTANCE=false                 # If true, fail hard when Redis unavailable

# Telegram
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_SECRET=secret               # Webhook verification

# WhatsApp (Meta Cloud API)
WHATSAPP_TOKEN=EAAx...                              # System User permanent token
WHATSAPP_PHONE_NUMBER_ID=123456789                  # From Meta API Setup
WHATSAPP_GRAPH_API_BASE=https://graph.facebook.com
WHATSAPP_GRAPH_API_VERSION=v25.0
WHATSAPP_VERIFY_TOKEN=your-verify-token             # Random string, must match Meta webhook config
# WHATSAPP_APP_SECRET=xxx                           # Optional: enables HMAC guard (see bot.module.ts)

# Frontend
CORS_ORIGINS=http://localhost:5173   # Comma-separated allowed origins
LINK_ACCOUNT_URL=http://localhost:5173/connect/  # Frontend URL for redirects

# Feature Flags
DEFAULT_PACKAGE=basic                # Default user package tier

# Debug
DEBUG_LOGS=true                      # Enable structured logging
DEBUG_LEVEL=debug                    # Log level
```

## Adding a New Function Handler

1. Create pure function in `src/bot/v3/functions/my-function.fn.ts`:

```typescript
import { SupabaseClient } from '@supabase/supabase-js';

export async function myFunction(
  supabase: SupabaseClient,
  userId: string,
  args: { /* ... */ },
): Promise<Record<string, any>> {
  // Execute DB operations
  return { ok: true, data: { /* ... */ } };
}
```

2. Add Gemini tool declaration in `function-declarations.ts`:

```typescript
{
  name: 'my_function',
  description: 'Description for Gemini (in Spanish)',
  parameters: {
    type: 'object',
    properties: { /* ... */ },
    required: [],
  },
}
```

3. Register in `function-router.ts`:

```typescript
case 'my_function':
  return myFunction(supabase, userId, args as any);
```

4. Add confirmation template in `response-builder.service.ts` if the function produces a card.
