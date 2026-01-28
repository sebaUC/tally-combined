# Natural, Adaptive Gus - Architecture Documentation

## Overview

This document describes the new architecture that makes Gus (the TallyFinance chatbot) feel natural, adaptive, and alive. The key principle is:

> **Backend executes, AI understands/decides/communicates + computes mood**

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER MESSAGE                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BACKEND (NestJS)                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  bot.service.ts - Main Orchestration                                    ││
│  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌──────────────┐││
│  │  │ Two-Phase     │ │ User Lock     │ │ Load State    │ │ Style        │││
│  │  │ Dedup         │ │ (Concurrency) │ │ (Parallel)    │ │ Detection    │││
│  │  └───────────────┘ └───────────────┘ └───────────────┘ └──────────────┘││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                     │                                        │
│  ┌──────────────────────────────────┼──────────────────────────────────────┐│
│  │              REDIS (Ephemeral State)                                    ││
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐││
│  │  │ctx:{userId} │ │conv:summary │ │conv:pending │ │conv:metrics         │││
│  │  │(60s cache)  │ │(2-24h TEXT) │ │(10m JSON)   │ │conv:cooldowns (30d) │││
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘││
│  │  ┌─────────────┐ ┌─────────────┐                                        ││
│  │  │lock:{userId}│ │msg:{msgId}  │  Rate Limit: rl:{externalId}          ││
│  │  │(5s lock)    │ │(dedup)      │                                        ││
│  │  └─────────────┘ └─────────────┘                                        ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
            ┌─────────────────┐             ┌─────────────────┐
            │   PHASE A       │             │   PHASE B       │
            │   (Intent)      │             │   (Response)    │
            │                 │             │                 │
            │ - Minimal ctx   │             │ - Full ctx      │
            │ - Tool decision │             │ - RuntimeContext│
            │ - Clarification │             │ - Mood calc     │
            │ - Direct reply  │             │ - Variability   │
            └─────────────────┘             └─────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AI-SERVICE (FastAPI)                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  prompts/                                                               ││
│  │  ├── gus_identity.txt      <- Static Gus personality (source of truth) ││
│  │  ├── variability_rules.txt <- Anti-repetition guidelines               ││
│  │  ├── phase_a_system.txt    <- Intent analysis prompt                   ││
│  │  └── phase_b_system.txt    <- Response generation prompt               ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  orchestrator.py                                                        ││
│  │  - calculate_final_mood(base_mood, mood_hint, budget_percent, streak)  ││
│  │  - _extract_opening(response) -> for variability tracking              ││
│  │  - _summarize_action(tool, result) -> conversation memory              ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

## Redis Key Patterns

| Key Pattern | TTL | Type | Description |
|-------------|-----|------|-------------|
| `ctx:{userId}` | 60s | JSON | User context cache (from Supabase) |
| `conv:{userId}:summary` | 2-24h | TEXT | Natural language conversation recap |
| `conv:{userId}:pending` | 10m | JSON | Slot-fill state for multi-turn completion |
| `conv:{userId}:metrics` | 30d | JSON | Transaction streak, week count |
| `conv:{userId}:cooldowns` | 30d | JSON | Nudge cooldown timestamps |
| `rl:{externalId}` | 60s | ZSET | Rate limiting (30 msgs/min) |
| `lock:{userId}` | 5s | STRING | User-level concurrency lock |
| `msg:{msgId}` | 120s→24h | STRING | Two-phase message dedup |

## New Services (Backend)

### 1. RedisService (`src/redis/redis.service.ts`)
- Generic Redis wrapper with in-memory fallback
- Methods: `get`, `set`, `del`, `exists`, `acquireLock`, `releaseLock`, `rateLimitCheck`
- Guard: If `MULTI_INSTANCE=true` and Redis unavailable → fail hard (503)

### 2. ConversationService (`src/bot/services/conversation.service.ts`)
- Manages conversation memory with clean separation
- `getSummary(userId)` / `saveSummary(userId, text, ttlHours)` - TEXT string
- `getPending(userId)` / `setPending(userId, pending)` / `clearPending(userId)` - JSON

### 3. MetricsService (`src/bot/services/metrics.service.ts`)
- Tracks user engagement metrics
- `recordTransaction(userId)` - Updates streak and week count
- `calculateMoodHint(context, metrics)` - Returns -1, 0, or +1

### 4. CooldownService (`src/bot/services/cooldown.service.ts`)
- Prevents nudge spam with MVP-simple rules
- Global nudge: 24h cooldown
- Budget warning: 5h cooldown (only if spent > 90%)
- Easter eggs: DISABLED in MVP

### 5. StyleDetectorService (`src/bot/services/style-detector.service.ts`)
- Regex-based user style detection
- Detects: `usesLucas`, `usesChilenismos`, `emojiLevel`, `isFormal`

## Phase B Extended Contract

### Request (RuntimeContext)
```typescript
interface RuntimeContext {
  summary?: string;              // Natural language recap
  metrics?: {
    tx_streak_days: number;
    week_tx_count: number;
    budget_percent?: number;
  };
  mood_hint?: -1 | 0 | 1;        // Backend hint, AI calculates final
  can_nudge: boolean;
  can_budget_warning: boolean;
  last_opening?: string;         // For variability
  user_style?: {
    uses_lucas: boolean;
    uses_chilenismos: boolean;
    emoji_level: 'none' | 'light' | 'moderate';
    is_formal: boolean;
  };
}
```

### Response (Extended)
```typescript
interface PhaseBResponse {
  phase: "B";
  final_message: string;
  new_summary?: string;          // For backend to save
  did_nudge?: boolean;
  nudge_type?: 'budget' | 'goal' | 'streak';
}
```

## Mood Calculation (AI-Service)

The mood ladder: `frustrated` → `tired` → `normal` → `hopeful` → `happy` → `proud`

```python
def calculate_final_mood(base_mood, mood_hint, budget_percent, streak_days):
    # 1. Start with base mood from personality_snapshot.mood
    # 2. Apply mood_hint as ±1 step
    # 3. Override for extreme cases:
    #    - budget > 95% → frustrated
    #    - streak >= 7 AND budget < 50% → proud
```

## State Update Write Order

The bot.service.ts follows a transaction-like pattern:

1. **LOAD** all state BEFORE processing (parallel)
2. **Phase A** (may fail - no state written)
3. **Tool execution** (may fail - no state written)
4. **Metrics** AFTER tool success only (register_transaction)
5. **Phase B** (may fail - but tool already executed → fallback message)
6. **Summary** AFTER Phase B success only
7. **Cooldowns** AFTER Phase B AND did_nudge=true
8. **Clear pending** if slot-fill completed

## Concurrency Safety

### Two-Phase Dedup
```
Message arrives → Check dedup key
  - "done" → Ignore (already processed)
  - "processing" → Return "Procesando tu mensaje..."
  - missing → Set "processing" (120s TTL)

Processing succeeds → Set "done" (24h TTL)
Processing fails → Delete key (allow retry)
```

### User Lock
```
Acquire lock:{userId} (5s TTL)
  - Success → Process message
  - Failure → Return "Dame un momento..." (explicit drop)
Finally → Release lock
```

## Ready Flows

| Flow | Tool Handler | Status | Notes |
|------|--------------|--------|-------|
| Register expense/income | `register_transaction` | ✅ Ready | Full flow with metrics tracking |
| Check balance | `ask_balance` | ✅ Ready | Shows spending by period/account |
| Budget status | `ask_budget_status` | ✅ Ready | Shows active budget progress |
| Goal status | `ask_goal_status` | ✅ Ready | Shows savings goals progress |
| App info/help | `ask_app_info` | ✅ Ready | Simplified, personality from AI |
| Greeting | `greeting` | ✅ Ready | Simple greeting response |
| Unknown intent | `unknown` | ✅ Ready | Fallback handler |

### NOT Ready (Requires Implementation)

| Flow | Status | Notes |
|------|--------|-------|
| Add category | ❌ Not implemented | No handler exists |
| Edit transaction | ❌ Not implemented | Use web app |
| Delete transaction | ❌ Not implemented | Use web app |
| Create budget | ❌ Not implemented | Use web app |
| Create goal | ❌ Not implemented | Use web app |
| Slot-filling flow | ⚠️ Partial | `conv:pending` structure ready, handlers need update |

## Environment Variables

### Backend (NestJS)
```bash
# Required
REDIS_URL=redis://localhost:6379    # Redis connection URL
AI_SERVICE_URL=http://localhost:8000 # AI service URL

# Optional
MULTI_INSTANCE=false                # If true, fail hard when Redis unavailable
DISABLE_AI=0                        # Set to 1 for maintenance mode
```

### AI-Service (FastAPI)
```bash
OPENAI_API_KEY=sk-...               # Required
OPENAI_MODEL=gpt-4o-mini            # Optional, default: gpt-4o-mini
```

## Setup Checklist

### 1. Install Redis
```bash
# macOS
brew install redis
brew services start redis

# Or use Docker
docker run -d -p 6379:6379 redis:alpine
```

### 2. Install Backend Dependencies
```bash
cd backend-API_TallyFinance
npm install
```

### 3. Install AI-Service Dependencies
```bash
cd ai-service_TallyFinane
pip install -r requirements.txt
```

### 4. Set Environment Variables
```bash
# Backend .env
REDIS_URL=redis://localhost:6379
AI_SERVICE_URL=http://localhost:8000

# AI-Service .env
OPENAI_API_KEY=sk-your-key-here
```

### 5. Start Services
```bash
# Terminal 1: Redis (if not using brew services)
redis-server

# Terminal 2: AI-Service
cd ai-service_TallyFinane
uvicorn app:app --reload --port 8000

# Terminal 3: Backend
cd backend-API_TallyFinance
npm run start:dev
```

### 6. Test the Flow
```bash
# Test endpoint (bypasses channel linking)
curl -X POST http://localhost:3000/bot/test \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "your-supabase-user-id",
    "message": "Gasté 5000 en comida",
    "verbose": true
  }'
```

## File Structure Summary

```
backend-API_TallyFinance/
├── src/
│   ├── redis/                      # NEW: Redis module
│   │   ├── keys.ts                 # Key patterns + TTLs
│   │   ├── redis.service.ts        # Redis wrapper
│   │   ├── redis.module.ts         # NestJS module
│   │   ├── redis.health.ts         # Health check
│   │   └── index.ts                # Exports
│   │
│   ├── bot/
│   │   ├── services/
│   │   │   ├── user-context.service.ts    # MODIFIED: Redis cache
│   │   │   ├── conversation.service.ts    # NEW: Summary + pending
│   │   │   ├── metrics.service.ts         # NEW: Streaks + mood hint
│   │   │   ├── cooldown.service.ts        # NEW: Nudge cooldowns
│   │   │   ├── style-detector.service.ts  # NEW: User style regex
│   │   │   ├── orchestrator.client.ts     # MODIFIED: RuntimeContext
│   │   │   └── orchestrator.contracts.ts  # MODIFIED: Extended types
│   │   │
│   │   ├── bot.service.ts          # MODIFIED: Full state management
│   │   ├── bot.controller.ts       # MODIFIED: Async rate limiting
│   │   └── bot.module.ts           # MODIFIED: New providers
│   │
│   └── common/utils/
│       └── resilience.ts           # MODIFIED: AsyncRateLimiter

ai-service_TallyFinane/
├── prompts/
│   ├── gus_identity.txt            # NEW: Gus character
│   ├── variability_rules.txt       # NEW: Anti-repetition
│   ├── phase_a_system.txt          # Existing
│   └── phase_b_system.txt          # Existing
│
├── schemas.py                      # MODIFIED: RuntimeContext, extended response
├── orchestrator.py                 # MODIFIED: Mood calc, opening extraction
└── app.py                          # MODIFIED: Pass runtime_context
```

## Troubleshooting

### Redis Connection Failed
- Check if Redis is running: `redis-cli ping` (should return PONG)
- Check REDIS_URL in .env
- Single instance mode will fallback to in-memory (with warning)

### AI Service Not Responding
- Check AI_SERVICE_URL in backend .env
- Verify AI service is running on port 8000
- Check OPENAI_API_KEY is set in AI service .env

### 429 Too Many Requests
- Rate limit is 30 messages per minute per user
- Wait 60 seconds or restart Redis to clear rate limit

### Duplicate Message Ignored
- Message was already processed (dedup working correctly)
- Wait 24 hours or delete the `msg:{msgId}` key from Redis
