# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
npm run build          # Compile TypeScript
npm run start:dev      # Watch mode for development
npm run start          # Start without watch
npm run start:prod     # Production (runs dist/main.js)

npm run lint           # ESLint with auto-fix
npm run format         # Prettier formatting

npm run test           # Run unit tests (Jest)
npm run test:watch     # Watch mode for tests
npm run test:cov       # Test coverage
npm run test:e2e       # End-to-end tests
```

## Architecture Overview

This is a **NestJS backend for TallyFinance**, a personal finance assistant that operates via messaging channels (Telegram/WhatsApp). It uses **Supabase** for authentication and database.

### Module Structure

```
src/
├── app.module.ts          # Root module, imports all feature modules
├── main.ts                # Bootstrap with CORS, ValidationPipe
├── supabase/              # Global Supabase client provider (@Inject('SUPABASE'))
├── auth/                  # Authentication (web auth, OAuth, channel linking)
├── onboarding/            # User onboarding flow (preferences, payment methods, goals)
├── bot/                   # Chatbot core (AI orchestration, tools, adapters)
├── user/                  # User profile management
└── common/                # Shared utilities (resilience, link codes)
```

### Bot Architecture (AI-Orchestrated Tool Execution)

The bot uses a two-phase AI orchestration pattern:

```
User Message → Adapter → BotService → Phase A (AI) → Tool Handler → Phase B (AI) → Response
```

1. **Adapters** (`bot/adapters/`) - Transform platform-specific webhooks to `DomainMessage`:
   - `TelegramAdapter` - Handles Telegram Bot API format
   - `WhatsappAdapter` - Handles WhatsApp Cloud API format

2. **BotChannelService** (`bot/delegates/`) - Manages channel linking flow:
   - Creates link codes for unlinked users
   - Handles `/start <code>` commands for Telegram

3. **OrchestratorClient** (`bot/services/`) - AI service communication:
   - **Phase A**: AI analyzes message and decides: `direct_reply`, `clarification`, or `tool_call`
   - **Phase B**: AI generates personalized response from tool result
   - Includes circuit breaker for fault tolerance

4. **ToolRegistry** (`bot/tools/`) - OCP-compliant tool handler registry:
   - Self-registering handlers with schemas
   - Dynamic tool schema generation for AI
   - Conditional context loading support

5. **Tool Handlers** (`bot/tools/handlers/`) - Execute business logic:
   - `register_transaction` - Record expenses/income (requiresContext: true)
   - `ask_balance` - Query spending and budget (requiresContext: true)
   - `ask_budget_status` - Check budget configuration (requiresContext: true)
   - `ask_goal_status` - Query financial goals progress (requiresContext: true)
   - `greeting` - Handle greetings (requiresContext: false)
   - `unknown` - Fallback for unrecognized intents (requiresContext: false)

### Key Contracts

- `DomainMessage` (`bot/contracts.ts`) - Unified message format across channels
- `ActionResult` (`bot/actions/action-result.ts`) - Handler execution result
- `ToolHandler` (`bot/tools/tool-handler.interface.ts`) - Handler interface with schema and context flag
- `ToolSchema` (`bot/tools/tool-schemas.ts`) - Tool definition for AI

### Resilience Patterns

Located in `common/utils/resilience.ts`:
- **Retry with backoff** - `withRetry()` for transient failures
- **Circuit breaker** - `CircuitBreaker` class for AI service protection
- **Rate limiting** - `RateLimiter` class for abuse prevention (30 msgs/min/user)

### Channel Linking Flow

Circular flow that works regardless of auth state:

1. User sends message to bot (unlinked)
2. Bot creates link code → generates URL `/connect/{code}`
3. User clicks link → backend checks auth
4. If authenticated → auto-link and redirect to success
5. If not authenticated → redirect to login with return URL
6. After login → returns to `/connect/{code}` → auto-link

Key endpoints:
- `GET /connect/:code` - Main linking endpoint (redirects)
- `GET /connect/:code/api` - API endpoint for AJAX linking

### Authentication Flow

- Uses Supabase Auth with JWT tokens in HTTP-only cookies
- `JwtGuard` middleware validates tokens via Supabase
- `@User()` decorator extracts authenticated user from request
- OAuth support for external providers (Google, GitHub, etc.)

### Database Tables (Supabase)

Core tables:
- `users` - Extended user profiles (package, onboarding status)
- `user_prefs` - User preferences (unified balance, notifications)
- `channel_accounts` - Links messaging platform IDs to user accounts
- `channel_link_codes` - Temporary codes for channel linking
- `payment_method` - User payment methods
- `categories` - Transaction categories (parent/child hierarchy)
- `transactions` - Financial transactions
- `goals` - Financial goals with progress tracking
- `spending_expectations` - Budget periods (daily/weekly/monthly)
- `personality_snapshot` - Bot personality settings per user

## Environment Variables

Required configuration (set in `.env`):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` - Supabase connection
- `AI_SERVICE_URL` - External AI orchestration service base URL
- `APP_BASE_URL` - Backend base URL for link generation
- `TELEGRAM_BOT_TOKEN` - Telegram Bot API token
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_API_BASE`, `WHATSAPP_GRAPH_API_VERSION` - WhatsApp Cloud API
- `CORS_ORIGINS` - Comma-separated allowed origins
- `LINK_ACCOUNT_URL` - Frontend base URL (for redirects)
- `DISABLE_AI` - Set to "1" to disable AI processing (maintenance mode)

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
    // Implementation
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

3. Add stub response in `OrchestratorClient.stubPhaseB()` for testing without AI service.
