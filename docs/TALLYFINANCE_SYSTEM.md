# TallyFinance — Complete System Reference

**Version:** 2.3
**Last Updated:** February 2026
**Core Principle:** *"Backend ejecuta, IA entiende/decide/comunica"*

---

## Table of Contents

1. [Overview & Core Principle](#1-overview--core-principle)
2. [Architecture](#2-architecture)
3. [Two-Phase AI Orchestration](#3-two-phase-ai-orchestration)
4. [Tool System](#4-tool-system)
5. [Gus Personality & Adaptive Architecture](#5-gus-personality--adaptive-architecture)
6. [Backend Components (NestJS)](#6-backend-components-nestjs)
7. [AI Service Components (FastAPI)](#7-ai-service-components-fastapi)
8. [Database Schema](#8-database-schema)
9. [Resilience & Concurrency](#9-resilience--concurrency)
10. [Redis Architecture](#10-redis-architecture)
11. [Channel System](#11-channel-system)
12. [Stub Mode (Offline Fallback)](#12-stub-mode-offline-fallback)
13. [Error Handling](#13-error-handling)
14. [Current State & Gaps](#14-current-state--gaps)
15. [Planned Roadmap](#15-planned-roadmap)
16. [Environment Configuration](#16-environment-configuration)
17. [Related Documentation](#17-related-documentation)

---

## 1. Overview & Core Principle

TallyFinance is a **personal finance assistant** that operates through messaging channels (Telegram and WhatsApp). Users interact with a character called **Gus** — an adaptive, personality-driven chatbot that registers transactions, checks budgets, tracks goals, and provides financial guidance.

### Separation of Concerns

| Backend (NestJS) | AI Service (FastAPI) |
|-------------------|----------------------|
| Receives webhooks | Analyzes user intent |
| Executes DB operations | Decides which tool to use |
| Runs tool handlers | Generates personalized replies |
| Manages user sessions | Applies personality settings |
| Handles rate limiting | Computes mood adjustments |
| **Never calls OpenAI** | **Never touches database** |

### Services Stack

| Service | Port | Technology | Purpose | Hosting |
|---------|------|------------|---------|---------|
| Backend | 3000 | NestJS/TypeScript | Webhooks, DB, tool execution | Render |
| AI Service | 8000 | FastAPI/Python | Intent analysis, response generation | Render (free tier) |
| Frontend | 5173 | React/Vite | Web dashboard, account linking | Vercel |
| Database | — | Supabase (PostgreSQL) | Persistent storage | Supabase |
| Cache | 6379 | Redis (Upstash) | Caching, rate limiting, state | Upstash |

---

## 2. Architecture

### High-Level Flow

```
User Message → Channel Adapter → Backend (NestJS) → Phase A (AI) → Tool Handler → Phase B (AI) → Response
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL CHANNELS                               │
│         Telegram Bot                WhatsApp Cloud API          Web Test     │
└──────────┬────────────────────────────┬────────────────────────┬────────────┘
           │                            │                        │
           ▼                            ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         NestJS Backend (Port 3000)                           │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         BotController                                │    │
│  │   POST /telegram/webhook   POST /whatsapp/webhook   POST /bot/test   │    │
│  │              │                      │                     │          │    │
│  │              └──────────────────────┼─────────────────────┘          │    │
│  │                                     ▼                                │    │
│  │                        ┌─────────────────────┐                       │    │
│  │                        │   Channel Adapters  │                       │    │
│  │                        │  Telegram/WhatsApp  │                       │    │
│  │                        │   → DomainMessage   │                       │    │
│  │                        └──────────┬──────────┘                       │    │
│  └───────────────────────────────────┼──────────────────────────────────┘    │
│                                      ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                            BotService                                  │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐ │  │
│  │  │                     TOOL-CALLING LOOP                             │ │  │
│  │  │                                                                   │ │  │
│  │  │  1. Rate limit check (30 msgs/min/user)                          │ │  │
│  │  │  2. Two-phase dedup check                                        │ │  │
│  │  │  3. Acquire user lock (concurrency)                              │ │  │
│  │  │  4. Handle /start command (Telegram deep links)                  │ │  │
│  │  │  5. Lookup linked user (channel_accounts table)                  │ │  │
│  │  │  6. If not linked → generate link URL, return                    │ │  │
│  │  │  7. Load user context + conversation state (parallel)            │ │  │
│  │  │  8. Call AI-Service Phase A (intent analysis)                    │ │  │
│  │  │  9. If tool_call → validate args → execute handler               │ │  │
│  │  │ 10. Update metrics (if transaction registered)                   │ │  │
│  │  │ 11. Call AI-Service Phase B (response generation)                │ │  │
│  │  │ 12. Save conversation summary + cooldowns                        │ │  │
│  │  │ 13. Return personalized message                                  │ │  │
│  │  └──────────────────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                      │                                       │
│  ┌───────────────┬──────────────┬────┴────────┬───────────────┬───────────┐ │
│  │UserContext    │ToolRegistry  │ Tool        │ Guardrails    │ Orch.     │ │
│  │Service       │              │ Handlers    │ Service       │ Client    │ │
│  │(Redis cache) │ 7 handlers   │ Execute DB  │ Validate args │ HTTP→AI   │ │
│  ├──────────────┤──────────────┤─────────────┤───────────────┤───────────┤ │
│  │Conversation  │Metrics       │Cooldown     │Style          │Redis      │ │
│  │Service       │Service       │Service      │Detector       │Service    │ │
│  └──────────────┴──────────────┴─────────────┴───────────────┴───────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                       HTTP POST /orchestrate
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FastAPI AI-Service (Port 8000)                       │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  app.py: POST /orchestrate  |  GET /health  |  GET /                │   │
│  │         │                                                            │   │
│  │         ▼                                                            │   │
│  │  ┌──────────────────────────────────────────────────────────┐       │   │
│  │  │                    Orchestrator                            │       │   │
│  │  │  phase_a(user_text, context, tools)  → tool/clarify/reply │       │   │
│  │  │  phase_b(tool, result, context)      → final_message      │       │   │
│  │  │  calculate_final_mood()              → mood adjustment     │       │   │
│  │  └──────────────────────────────────────────────────────────┘       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌────────────┐ ┌────────────┐ ┌──────────────┐ ┌───────────────────────┐  │
│  │ config.py  │ │ schemas.py │ │tool_schemas  │ │ prompts/              │  │
│  │ Settings   │ │ Pydantic   │ │  .py         │ │ gus_identity.txt      │  │
│  │ OpenAI cfg │ │ models     │ │ 6 tools      │ │ variability_rules.txt │  │
│  │            │ │            │ │              │ │ phase_a_system.txt    │  │
│  │            │ │            │ │              │ │ phase_b_system.txt    │  │
│  └────────────┘ └────────────┘ └──────────────┘ └───────────────────────┘  │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
                          ┌─────────────────┐
                          │   OpenAI API    │
                          │  gpt-4o-mini    │
                          └─────────────────┘
```

---

## 3. Two-Phase AI Orchestration

### Phase A — Intent Analysis

**Purpose:** Analyze user message and decide what action to take.

| Config | Value |
|--------|-------|
| Model | gpt-4o-mini |
| Temperature | 0.3 (deterministic) |
| Response format | JSON mode |
| Prompt | `prompts/phase_a_system.txt` |

**Request:**
```typescript
interface PhaseARequest {
  phase: "A";
  user_text: string;              // "gaste 15 lucas en comida"
  user_context: MinimalUserContext;  // user_id is inside here
  tools: ToolSchema[];            // Available tools with schemas
  pending?: PendingSlotContext;   // Slot-fill state from previous turn
  available_categories?: string[];  // User's actual category names
}
```

**Response types:**

| Type | When Used | Example |
|------|-----------|---------|
| `tool_call` | User wants to perform an action | Register expense, check balance |
| `clarification` | Missing required information | "Cuanto fue el gasto?" |
| `direct_reply` | Simple response, no tool needed | Greeting responses |

**Response:**
```typescript
interface PhaseAResponse {
  phase: "A";
  response_type: "tool_call" | "clarification" | "direct_reply";
  tool_call?: { name: string; args: Record<string, any> };
  clarification?: string;
  direct_reply?: string;
}
```

> **Note:** `pending` and `available_categories` are on the **request** (sent by backend), not on the response. The AI service returns only `response_type` + the corresponding field.

### Phase B — Response Generation

**Purpose:** Generate personalized user-facing message based on tool result.

| Config | Value |
|--------|-------|
| Model | gpt-4o-mini |
| Temperature | 0.7 (creative) |
| Response format | Plain text |
| Prompt | `prompts/phase_b_system.txt` + `gus_identity.txt` |

**Request:**
```typescript
interface PhaseBRequest {
  phase: "B";
  tool_name: string;
  action_result: ActionResult;
  user_context: MinimalUserContext;
  runtime_context?: RuntimeContext;  // Extended context for adaptive behavior
}
```

**Response:**
```typescript
interface PhaseBResponse {
  phase: "B";
  final_message: string;
  new_summary?: string;           // Conversation summary for backend to save
  did_nudge?: boolean;
  nudge_type?: 'budget' | 'goal' | 'streak';
}
```

### Key Contracts

**MinimalUserContext** (sent with every request):
```typescript
interface MinimalUserContext {
  userId: string;
  displayName: string | null;
  personality: {
    tone: "neutral" | "friendly" | "serious" | "motivational" | "strict";
    intensity: number;  // 0.0 - 1.0
    mood: "normal" | "happy" | "disappointed" | "tired" | "hopeful" | "frustrated" | "proud";
  } | null;
  prefs: {
    timezone: string | null;
    locale: string | null;
    notificationLevel: "none" | "light" | "medium" | "intense";
    unifiedBalance: boolean | null;
  } | null;
  activeBudget: {
    period: "daily" | "weekly" | "monthly";
    amount: number;
    spent?: number;
  } | null;
  goalsCount: number;
  goalsSummary?: string[];  // ["Viaje a Europa (45%)", ...]
}
```

**RuntimeContext** (extended Phase B context for adaptive behavior):
```typescript
interface RuntimeContext {
  summary?: string;              // Natural language conversation recap
  metrics?: {
    tx_streak_days: number;
    week_tx_count: number;
    budget_percent?: number;
  };
  mood_hint?: -1 | 0 | 1;       // Backend hint, AI calculates final mood
  can_nudge: boolean;
  can_budget_warning: boolean;
  last_opening?: string;         // For variability (anti-repetition)
  user_style?: {
    uses_lucas: boolean;
    uses_chilenismos: boolean;
    emoji_level: 'none' | 'light' | 'moderate';
    is_formal: boolean;
  };
}
```

**ActionResult** (returned by tool handlers, sent to Phase B):
```typescript
interface ActionResult {
  ok: boolean;
  action: string;
  data?: Record<string, any>;
  userMessage?: string;          // Direct response (skip Phase B)
  errorCode?: string;
}
```

### Message Flows

**Happy path (register expense):**
```
User: "gaste 15 lucas en comida"
  → Phase A: tool_call { name: "register_transaction", args: { amount: 15000, category: "comida" } }
  → Handler: INSERT INTO transactions → ActionResult { ok: true }
  → Phase B: "Listo! Registre $15.000 en Comida"
```

**Clarification (missing info):**
```
User: "gaste en algo"
  → Phase A: clarification "Cuanto fue el gasto y en que categoria?"
  → Return clarification directly (NO Phase B)
```

**Slot-filling (handler requests info):**
```
User: "registra un gasto de 15000"
  → Phase A: tool_call { name: "register_transaction", args: { amount: 15000 } }
  → Handler: category missing → ActionResult { ok: true, userMessage: "En que categoria?" }
  → Return userMessage directly (NO Phase B)
```

**User not linked:**
```
User sends first message
  → lookupLinkedUser() → null
  → Create link code (10-min TTL)
  → Return link instructions with URL (NO AI call)
```

---

## 4. Tool System

### 4.1 Overview

6 registered tool handlers + 1 fallback in `backend-API_TallyFinance/src/bot/tools/handlers/`. ToolRegistry registers 6 handlers in its `handlers` map; `unknown` is set as `fallbackHandler` (used when no tool matches):

| Tool Name | Handler File | Context | Purpose |
|-----------|-------------|---------|---------|
| `register_transaction` | `register-transaction.tool-handler.ts` | Yes | Record expenses/income |
| `ask_balance` | `ask-balance.tool-handler.ts` | Yes | Query spending & budget |
| `ask_budget_status` | `ask-budget-status.tool-handler.ts` | Yes | Check budget configuration |
| `ask_goal_status` | `ask-goal-status.tool-handler.ts` | Yes | Query goals progress |
| `ask_app_info` | `ask-app-info.tool-handler.ts` | No | App info, help, FAQ (has knowledge base) |
| `greeting` | `greeting.tool-handler.ts` | No | Handle greetings |
| `unknown` | `unknown.tool-handler.ts` | No | Fallback handler |

All handlers implement the `ToolHandler` interface:
```typescript
interface ToolHandler {
  readonly name: string;
  readonly schema: ToolSchema;
  readonly requiresContext: boolean;
  execute(userId: string, msg: DomainMessage, args: Record<string, unknown>): Promise<ActionResult>;
}
```

### 4.2 register_transaction

**Arguments:**

| Arg | Type | Required | Description |
|-----|------|----------|-------------|
| `amount` | number | Yes | Amount in CLP |
| `category` | string | Yes | Category name |
| `posted_at` | string | No | ISO date (default: today) |
| `description` | string | No | Transaction description |
| `payment_method_id` | string | No | Payment method ID |

**Logic:**
1. Validate amount > 0
2. Lookup category by name (case-insensitive); if not found, fuzzy match and suggest alternatives
3. Get payment method (user's default if not specified)
4. Normalize date (default: today)
5. INSERT INTO transactions
6. Return ActionResult with transaction data

**Supabase mapping:**

| AI Tool Arg | Supabase Column | Notes |
|-------------|-----------------|-------|
| `amount` | `transactions.amount` | Required |
| `category` | `categories.name` → `category_id` | Backend looks up |
| `posted_at` | `transactions.posted_at` | Default: today |
| `payment_method` | `payment_method.name` → `payment_method_id` | Backend default if missing |
| `description` | `transactions.description` | Optional |

### 4.3 ask_balance

**Arguments:** None

**Logic:**
1. Check user's `unified_balance` preference
2. Query transactions for current month
3. Group by payment method if not unified
4. Calculate total spent
5. Get active budget (if exists)
6. Calculate remaining budget
7. Return spending summary

### 4.4 ask_budget_status

**Arguments:** None

**Logic:**
1. Query `spending_expectations` WHERE `active = true` using `.maybeSingle()` (returns one budget)
2. If no budget, return helpful message about setting one up
3. Return active budget config (period, amount, active status)

> **Note:** The handler uses `.maybeSingle()` so it returns a single active budget, even though `UserContextService` loads the first active budget for context. Multiple active budgets per user are supported at the DB level but only one is surfaced by this handler.

### 4.5 ask_goal_status

**Arguments:** `goalId` (optional — specific goal or all goals)

**Logic:**
1. Query goals (specific or all)
2. Calculate progress percentage for each (capped at 100%)
3. Return goals with progress

### 4.6 ask_app_info

**Arguments:** `userQuestion` (required), `suggestedTopic` (optional)

**Suggested topics:** `capabilities`, `how_to`, `limitations`, `channels`, `getting_started`, `about`, `security`, `pricing`, `conversation`

**Knowledge base structure:** Contains identity, character info (names: "Tally"/"Gus"), current features, coming-soon features, limitations, channel info, security, getting-started steps, FAQ, financial knowledge, and easter eggs.

**Special Phase B behavior:** Receives `appKnowledge`, `aiInstruction`, and `userQuestion` in `action_result.data` so the AI can generate informative, in-character responses.

### 4.7 greeting / unknown

Minimal handlers that return `{ ok: true }` and let Phase B generate the personality-driven response.

---

## 5. Gus Personality & Adaptive Architecture

### 5.1 Static Personality

Gus's core identity is defined in `prompts/gus_identity.txt` (AI service) and loaded into all Phase B prompts. This ensures personality consistency across all tools, not just `ask_app_info`.

**Character traits:**
- Name: "Gus" (full name "Gustavo" — Breaking Bad easter egg, used very rarely)
- "Tally" is the app name (TallyFinance), NOT a Gus alias
- Personality: Serious but kind, professional, direct, slightly sarcastic (NOT overly enthusiastic)
- Origin: Chilean, "recorro el mundo ayudando a reducir gastos"
- Never confirms being a bot/AI — presents as "Gus, asistente financiero"
- Technical details are "propiedad intelectual de TallyFinance SPA"
- Speaking style: Natural Chilean Spanish when user does, understands "lucas" = x1000 CLP

### 5.2 Tone

| Tone | Behavior | Example |
|------|----------|---------|
| `neutral` | Balanced, moderate emojis | "Registre $15.000 en Comida." |
| `friendly` | Warm, emojis, Chilean expressions | "Listo! $15.000 en Comida" |
| `serious` | Concise, professional, no emojis | "Transaccion registrada: $15.000 en Comida." |
| `motivational` | Encouraging, finance motivation | "Genial! Cada peso cuenta" |
| `strict` | Direct, data-focused | "$15.000 en Comida. Revisa tu presupuesto." |

### 5.3 Intensity (0.0 - 1.0)

| Range | Behavior |
|-------|----------|
| `> 0.7` | More expressive, enthusiastic, more emojis |
| `0.3 - 0.7` | Moderate balance |
| `< 0.3` | Sober, contained, minimal expression |

### 5.4 Mood System

**Mood ladder:** `frustrated` → `tired` → `normal` → `hopeful` → `happy` → `proud`

| Mood | Behavior |
|------|----------|
| `normal` | Standard response |
| `happy` | Celebrates achievements joyfully |
| `disappointed` | Empathetic but motivating |
| `tired` | Concise but kind |
| `hopeful` | Optimistic about financial future |
| `frustrated` | Understanding, offers concrete help |
| `proud` | Celebrates user's accomplishments |

**Mood calculation** (in AI service orchestrator):
```python
def calculate_final_mood(base_mood, mood_hint, budget_percent, streak_days):
    # 1. Start with base mood from personality_snapshot.mood
    #    - "disappointed" maps to "tired" (legacy value)
    #    - Unknown values default to "normal" (index 2)
    # 2. Apply mood_hint as +/-1 step on ladder (clamped to 0-5)
    # 3. Override for extreme cases:
    #    - budget > 95% → frustrated (index 0)
    #    - streak >= 7 AND budget < 50% → proud (index 5)
    # NOTE: Tone is NEVER modified — only mood changes
```

### 5.5 Style Detection

**StyleDetectorService** (backend, regex-based):
- `usesLucas` — detects "lucas" slang for money
- `usesChilenismos` — detects Chilean expressions
- `emojiLevel` — `none` | `light` | `moderate`
- `isFormal` — detects formal language

This user style is passed to Phase B so the AI can mirror the user's communication style.

### 5.6 Variability (Anti-Repetition)

`prompts/variability_rules.txt` provides guidelines to prevent Gus from starting messages the same way. The `last_opening` field in RuntimeContext tracks the previous response's opening phrase so the AI avoids repeating it.

**Known openings** (tracked by `_extract_opening()`): `listo`, `anotado`, `hecho`, `ya quedó`, `perfecto`, `ok`, `buena`, `dale`

**History-aware rules (Rule 6):** When conversation history is active, the model checks its own previous responses — not just `last_opening` — to avoid repeating structure, tone celebrations, and openings. During rapid sequential registrations, responses become progressively briefer.

### 5.7 Phase A Scope System (3 Circles)

The Phase A prompt (`phase_a_system.txt`) defines 3 concentric circles of scope:

| Circle | Scope | Action |
|--------|-------|--------|
| 1 — Core | TallyFinance, Gus identity, transactions, budgets, goals | Always respond (tool_call) |
| 2 — Related | Personal finance, Chilean economy (UF, IPC), savings tips | Respond with judgment (ask_app_info) |
| 3 — Out of domain | Science, history, math, programming, politics | Redirect politely (direct_reply with humor) |

**Deduction rule:** "DEDUCE ANTES DE PREGUNTAR" — AI must infer category from context before asking clarification. Only ask when truly undeducible.

**Category matching:** AI must use EXACT category from `available_categories` list. If no match, return `_no_match` (never invent categories).

**Reference resolution (context-aware):** Phase A includes explicit rules for resolving conversational references when history is available:

| User Pattern | Resolution |
|-------------|------------|
| "otra mas" / "otra igual" / "lo mismo" | Repeat last tool_call with same args |
| "pero en X" / "lo mismo pero en transporte" | Same tool_call, change only the mentioned field |
| "esa categoria" / "la misma" | Use category from last register_transaction |
| "el gasto anterior" / "el que registre recien" | Reference to last transaction in history |
| "cuanto llevo?" (after registering) | Resolve to ask_balance |
| User provides amount only (category given in recent turn) | Deduce category from context, don't ask |
| "no, eran 15 lucas" (correction) | Understand correction references last action |

**Rapid registration pattern:** When the user fires multiple expenses in sequence, Phase A processes each independently without chatty confirmations ("quieres registrar otro?").

### 5.8 Phase B Metadata (Nudge Detection + Summary)

Phase B response includes metadata the backend persists:

| Field | Purpose | How Detected |
|-------|---------|-------------|
| `new_summary` | Updated conversation summary (appended) | `_summarize_action()` per tool |
| `did_nudge` | Whether the AI included a nudge | Keyword heuristics on final_message |
| `nudge_type` | `"budget"` or `"streak"` | Budget: "presupuesto/gastado/límite/cuidado" when budget_percent>0.9. Streak: "racha/días seguidos/constante" when streak>=3 |

Backend uses `did_nudge`/`nudge_type` to set cooldowns (24h global nudge, 5h budget warning) preventing nudge spam.

**Enriched summaries:** `_summarize_action()` now generates context-rich summaries instead of flat action logs:

| Tool | Before | After |
|------|--------|-------|
| `register_transaction` | "Registró $15,000 en Comida." | "Registró $15,000 en Comida (almuerzo)." (includes description) |
| `ask_balance` | "Consultó su balance." | "Consultó su balance ($45,000 gastado este mes)." |
| `ask_budget_status` | "Revisó estado de presupuesto." | "Revisó presupuesto (le quedan $155,000)." |
| `ask_app_info` | "Preguntó sobre la app." | "Preguntó: cómo vincular mi Telegram?." |

These richer summaries give Phase B more context about what happened during the session, enabling pattern-aware responses.

**Session depth awareness:** Phase B receives `session_action_count` (derived from summary sentence count), letting the model modulate response length — brief during rapid registration, more engaging during exploratory sessions.

**Conversational behavior rules:** Phase B includes explicit instructions for pattern recognition on history:
- 2+ expenses in same category today → comment naturally
- Balance query followed by spending → connect the actions
- Large expense after small ones → note the change
- Sequential registrations → acknowledge the pattern
- Style coherence: mirror formality, emoji usage, and slang from previous turns
- Negative rules: never mention "having memory", never say "como te dije antes", no forced callbacks

### 5.9 Conversational Memory (3-Tier System)

TallyFinance implements a tiered conversational memory system that gives Gus context awareness across messages within a session. Each tier operates at a different granularity.

```
┌───────────────────────────────────────────────────────┐
│                  TIER 1: Working Memory                │
│  Raw message history (last N messages from Redis)      │
│  Injected directly into OpenAI message array           │
│  TTL: 2h │ Max: ~10 messages │ Status: IMPLEMENTED     │
├───────────────────────────────────────────────────────┤
│                TIER 2: Session Summary                  │
│  Compressed action log with pattern deduplication       │
│  Natural language summary in system prompt              │
│  TTL: 2-24h │ Unlimited actions │ Status: IMPLEMENTED   │
├───────────────────────────────────────────────────────┤
│              TIER 3: Long-Term Patterns                 │
│  Cross-session behavioral patterns and preferences      │
│  Spending habits, category preferences, time patterns   │
│  Storage: Supabase │ Status: PLANNED                    │
└───────────────────────────────────────────────────────┘
```

#### Tier 1 — Working Memory (Implemented)

**What:** Raw conversation messages (user + assistant) stored in Redis and injected into the OpenAI message array before the current user message.

**Storage:** Redis list at `conv:{userId}:history` (TTL 2h)
**Capacity:** Last ~10 messages (bounded by token budget)
**Injected into:** Both Phase A and Phase B message arrays

**Data flow:**
```
User message → Backend saves to Redis list → Loads history → Sends to AI service
→ AI service prepends history to OpenAI messages[] → LLM sees full recent context
```

**What the LLM can do with Tier 1:**
- Resolve references ("otra mas", "lo mismo pero en transporte")
- Deduce missing fields from recent context (category from 2 messages ago)
- Understand corrections ("no, eran 15 lucas")
- Maintain style coherence across turns
- Recognize patterns (repeated categories, balance-then-spend sequences)

#### Tier 2 — Session Summary (Implemented)

**What:** Compressed natural-language summary of actions performed during the session. Generated by `_summarize_action()` after each successful tool execution, compressed by `_compress_summary()` when categories repeat.

**Storage:** Redis string at `conv:{userId}:summary` (TTL 2-24h)
**Capacity:** Unlimited actions (compressed to prevent unbounded growth)
**Injected into:** Phase B system prompt as "CONTEXTO DE LA SESION"

**Summary generation examples:**
```
Action: register_transaction {amount: 15000, category: "Comida", description: "almuerzo"}
Summary: "Registró $15,000 en Comida (almuerzo)."

Action: ask_balance → {totalSpent: 45000}
Summary: "Consultó su balance ($45,000 gastado este mes)."
```

**Pattern compression** (`_compress_summary()`):
```
Before: "Registró $15,000 en Comida. Registró $8,000 en Comida. Registró $5,000 en Transporte."
After:  "Registró 2 gastos en Comida ($23,000 total). Registró $5,000 en Transporte."
```

**Session action count:** Derived from summary sentence count, passed to Phase B as `Acciones en esta sesion: N`. This lets the LLM modulate response verbosity — brief for rapid registrations, engaging for early-session interactions.

#### Tier 3 — Long-Term Patterns (Planned)

**Vision:** Cross-session behavioral intelligence that persists in Supabase and informs Gus's understanding of the user over weeks and months.

**What Tier 3 would capture:**

| Pattern Type | Example | How Used |
|-------------|---------|----------|
| Spending habits | "Usually spends $15-20k on lunch, $5-8k on transport" | Detect anomalies ("Este almuerzo fue el doble de lo habitual") |
| Category frequency | "Top categories: Comida (45%), Transporte (25%), Suscripciones (15%)" | Smarter category deduction for ambiguous messages |
| Time patterns | "Registers expenses mostly 12-14h and 19-21h" | Contextual greetings, session-aware responses |
| Budget behavior | "Consistently hits 80%+ of monthly budget by week 3" | Proactive warnings earlier in the month |
| Preferred payment | "Uses 'Tarjeta CMR' for large purchases, 'Cuenta RUT' for daily" | Suggest payment method based on amount/category |
| Conversation style | "Prefers informal, uses lucas, rarely uses emojis" | Persistent style matching without re-detection |
| Financial goals progress | "Saving for vacation, usually contributes $50k/month" | Encourage on-track, nudge when behind |

**Architecture (proposed):**
- **Storage:** New Supabase table `user_behavior_patterns` (user_id, pattern_type, pattern_data JSONB, updated_at)
- **Update frequency:** Batch job after session ends (not real-time), or periodic cron
- **Injection point:** Added to `MinimalUserContext` or `RuntimeContext` as `behavior_patterns`
- **Token budget:** Compressed to ~200 tokens max to avoid prompt bloat

**Tier 3 vs Tier 2:** Tier 2 knows "you registered 3 expenses in Comida today." Tier 3 would know "you usually register 2-3 Comida expenses per day, averaging $12,000 each — today you're spending more than usual."

**Dependencies:** Requires sufficient user data (weeks of usage) to generate meaningful patterns. Should launch after core CRUD tools are complete (Phase 2 roadmap).

---

## 6. Backend Components (NestJS)

### Core Services

| Component | File | Responsibility |
|-----------|------|----------------|
| **BotController** | `bot.controller.ts` | Receive webhooks, rate limiting, convert to DomainMessage |
| **BotService** | `bot.service.ts` | Orchestrate the tool-calling loop, state management |
| **TelegramAdapter** | `adapters/telegram.adapter.ts` | Convert Telegram format → DomainMessage, send replies |
| **WhatsAppAdapter** | `adapters/whatsapp.adapter.ts` | Convert WhatsApp format → DomainMessage, send replies |
| **BotChannelService** | `delegates/bot-channel.service.ts` | Channel linking, /start command handling |
| **UserContextService** | `services/user-context.service.ts` | Load & cache user context (Redis, 60s TTL) |
| **OrchestratorClient** | `services/orchestrator.client.ts` | HTTP client for AI-Service, circuit breaker |
| **GuardrailsService** | `services/guardrails.service.ts` | Validate & sanitize tool arguments |
| **ToolRegistry** | `tools/tool-registry.ts` | Map tool names → handler instances |
| **Tool Handlers** | `tools/handlers/*.ts` | Execute DB operations, return ActionResult |

### Adaptive Services (Gus architecture)

| Component | File | Responsibility |
|-----------|------|----------------|
| **RedisService** | `redis/redis.service.ts` | Generic Redis wrapper with in-memory fallback |
| **ConversationService** | `bot/services/conversation.service.ts` | Conversation memory (summary + pending slots) |
| **MetricsService** | `bot/services/metrics.service.ts` | Track engagement (streaks, week count), mood hints |
| **CooldownService** | `bot/services/cooldown.service.ts` | Prevent nudge spam (24h global, 5h budget warning) |
| **StyleDetectorService** | `bot/services/style-detector.service.ts` | Regex-based user style detection |

### State Update Write Order

The `bot.service.ts` follows a transaction-like pattern:

1. **LOAD** all state BEFORE processing (parallel)
2. **Phase A** (may fail — no state written)
3. **Tool execution** (may fail — no state written)
4. **Metrics** AFTER tool success only (`register_transaction`)
5. **Phase B** (may fail — but tool already executed → fallback message)
6. **Summary** AFTER Phase B success only
7. **Cooldowns** AFTER Phase B AND `did_nudge=true`
8. **Clear pending** if slot-fill completed

### File Structure

```
backend-API_TallyFinance/src/
├── main.ts
├── app.module.ts
├── supabase/                      # Global Supabase client
├── redis/                         # Redis module
│   ├── keys.ts                    # Key patterns + TTLs
│   ├── redis.service.ts           # Redis wrapper (in-memory fallback)
│   ├── redis.module.ts
│   ├── redis.health.ts
│   └── index.ts
├── bot/
│   ├── bot.controller.ts          # Webhooks + rate limiting
│   ├── bot.service.ts             # Main orchestration loop
│   ├── bot.module.ts
│   ├── contracts.ts               # DomainMessage
│   ├── adapters/
│   │   ├── telegram.adapter.ts
│   │   └── whatsapp.adapter.ts
│   ├── delegates/
│   │   └── bot-channel.service.ts
│   ├── services/
│   │   ├── user-context.service.ts
│   │   ├── orchestrator.client.ts
│   │   ├── orchestrator.contracts.ts
│   │   ├── guardrails.service.ts
│   │   ├── conversation.service.ts
│   │   ├── metrics.service.ts
│   │   ├── cooldown.service.ts
│   │   └── style-detector.service.ts
│   ├── tools/
│   │   ├── tool-registry.ts
│   │   ├── tool-handler.interface.ts
│   │   ├── tool-schemas.ts
│   │   └── handlers/
│   │       ├── register-transaction.tool-handler.ts
│   │       ├── ask-balance.tool-handler.ts
│   │       ├── ask-budget-status.tool-handler.ts
│   │       ├── ask-goal-status.tool-handler.ts
│   │       ├── ask-app-info.tool-handler.ts
│   │       ├── greeting.tool-handler.ts
│   │       └── unknown.tool-handler.ts
│   └── actions/
│       └── action-result.ts
├── auth/                          # Authentication (web, Google OAuth only, linking)
├── onboarding/                    # User onboarding flow
├── user/                          # User profile management
└── common/utils/
    └── resilience.ts              # CircuitBreaker, RateLimiter, withRetry
```

### Authentication System

| Method | Description |
|--------|-------------|
| Email/password | Signup with argon2 hashing, signin with JWT cookies |
| Google OAuth | Only provider supported (`@IsIn(['google']`) in ProviderLoginDto) |

**JWT cookies:** `access_token` (15min, HttpOnly, Secure, SameSite=None) and `refresh_token` (7d). Refresh endpoint rotates both.

### Admin System

- **AdminGuard** uses a **hardcoded UUID whitelist** (not role-based)
- Admin endpoints: dashboard stats, message browser, user chat viewer, error log, usage tracking
- `bot_message_log` table powers the admin message backoffice

### Onboarding (7 sync steps)

The onboarding service (`onboarding.service.ts`) processes 7 steps in sequence within a single POST to `/auth/onboarding`:
1. Upsert `users` (full_name, nickname, timezone, locale)
2. Upsert `user_prefs` (notification_level, unified_balance)
3. Upsert `personality_snapshot` (tone, intensity, mood)
4. Upsert categories (user's custom + system defaults)
5. Upsert payment methods
6. Upsert spending expectations (budgets)
7. Upsert goals

---

## 7. AI Service Components (FastAPI)

### Components

| Component | File | Responsibility |
|-----------|------|----------------|
| **app.py** | `app.py` | FastAPI routes (`/orchestrate`, `/health`, `/`), error handling, correlation IDs |
| **Orchestrator** | `orchestrator.py` | Phase A/B logic, OpenAI calls (JSON+text), mood calculation, summary generation, opening extraction |
| **config.py** | `config.py` | Centralized settings (pydantic-settings): OpenAI config + MAX_RETRIES + ENDPOINT_TIMEOUT |
| **schemas.py** | `schemas.py` | 17 Pydantic models: enums, contexts, Phase A/B requests/responses, PendingSlotContext, RuntimeContext, UserMetrics, UserStyle |
| **tool_schemas.py** | `tool_schemas.py` | 6 tool definitions for AI (what AI can extract from user messages) |
| **debug_logger.py** | `debug_logger.py` | Unified color-coded logger with 15 methods, correlation ID tracking, performance timing |
| **prompts/** | `prompts/*.txt` | 4 prompt files: Phase A/B system prompts, Gus identity, variability rules |

### Orchestrator Methods

```python
class Orchestrator:
    def __init__(self, client: OpenAI, config: Settings)
    def load_prompt(self, filename: str) -> str             # Load from prompts/ dir
    def get_gus_identity(self) -> str                       # Cached gus_identity.txt
    def calculate_final_mood(base_mood, mood_hint, budget_percent, streak_days) -> str
    def _call_openai_json(messages, temperature, cid) -> dict   # JSON mode + retry
    def _call_openai_text(messages, temperature, cid) -> str    # Text mode + retry
    def phase_a(user_text, user_context, tools, pending, available_categories, cid) -> OrchestrateResponsePhaseA
    def phase_b(tool_name, action_result, user_context, runtime_context, cid) -> OrchestrateResponsePhaseB
    def _extract_opening(response) -> str | None    # For variability tracking
    def _summarize_action(tool, result) -> str       # For conversation memory (enriched: amounts, descriptions, remaining budget)
    def _compress_summary(summary) -> str             # Tier 2: compress repeated transaction patterns
```

**OpenAI retry:** Both `_call_openai_json` and `_call_openai_text` retry `MAX_RETRIES` times (default 1, so 2 total attempts). Timeout per call: `OPENAI_TIMEOUT` (25s).

### File Structure

```
ai-service_TallyFinane/
├── app.py                         # FastAPI routes + error handling + correlation IDs
├── config.py                      # Settings via pydantic-settings (OpenAI + service config)
├── schemas.py                     # 17 Pydantic models (enums, contexts, requests, responses, slot-fill)
├── orchestrator.py                # Orchestrator: phase_a/b, mood calc, opening extraction, summary
├── tool_schemas.py                # 6 tool definitions for AI
├── debug_logger.py                # Unified color-coded logger (15 methods, env config, timing)
├── requirements.txt               # 6 dependencies
├── Dockerfile                     # python:3.11-slim, non-root, healthcheck, single worker
├── prompts/
│   ├── gus_identity.txt           # Static Gus personality (source of truth, cached at runtime)
│   ├── phase_a_system.txt         # Intent analysis prompt (3-circle scope, deduction, slot-fill, categories, reference resolution, rapid registration)
│   ├── phase_b_system.txt         # Response generation prompt (personality, ask_app_info rules, conversation memory behavior, pattern recognition, style coherence)
│   └── variability_rules.txt      # Anti-repetition guidelines (opening rotation, emoji, style mirroring, history-aware rules)
├── CLAUDE.md
└── docs/
    ├── GUIA_ENDPOINTS_Y_TESTING.md
    └── IMPLEMENTATION_SUMMARY.md
```

### Schema Alignment with Supabase

**Enums mapping:**

| Supabase Enum | Python Type | Values |
|---------------|-------------|--------|
| `bot_tone_enum` | `ToneType` | neutral, friendly, serious, motivational, strict |
| `bot_mood_enum` | `MoodType` | normal, happy, disappointed, tired, hopeful, frustrated, proud |
| `notification_level_enum` | `NotificationLevelType` | none, light, medium, intense |
| `goal_status_enum` | `GoalStatusType` | in_progress, completed, canceled |
| `payment_type_t` | `PaymentTypeType` | credito, debito |
| `tx_source_t` | `TxSourceType` | manual, chat_intent, import, bank_api, ai_extraction |

---

## 8. Database Schema

### Core Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | User profiles | id, full_name, nickname, timezone, locale, package |
| `user_prefs` | Preferences | id, notification_level, unified_balance |
| `personality_snapshot` | Bot personality per user | user_id, tone, intensity, mood |
| `channel_accounts` | Platform links | user_id, channel, external_user_id |
| `channel_link_codes` | Temp link codes | code, channel, external_user_id, expires_at |
| `transactions` | Financial records | user_id, amount, category_id, posted_at, source, description |
| `categories` | Expense categories | user_id, name, parent_id, icon |
| `payment_method` | Payment accounts | user_id, name, payment_type, currency |
| `goals` | Financial goals | user_id, name, target_amount, progress_amount, status |
| `spending_expectations` | Budget config | user_id, period, amount, active |
| `user_emotional_log` | Emotion tracking (schema exists, **not accessed by code**) | user_id, emotion_detected, confidence |
| `bot_message_log` | Admin message log | user_id, channel, user_text, bot_response, error, metadata |

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
| `app_pkg_enum` | basic, intermedio, avanzado |

### Context Loading (UserContextService)

Loaded via 4 parallel queries:
1. `personality_snapshot` → tone, intensity, mood
2. `user_prefs` → notification_level, unified_balance
3. `spending_expectations` WHERE active = true → period, amount
4. `goals` → id, name, progress_amount, target_amount

**NOT loaded** (to keep context minimal): transactions, full categories, payment_methods, channel_accounts.

---

## 9. Resilience & Concurrency

### Rate Limiting

- **Location:** `bot.controller.ts`
- **Config:** 30 messages per 60 seconds per user (by externalId)
- **Behavior:** Returns HTTP 429 when exceeded, automatic cleanup every 5 minutes
- **Implementation:** Redis-backed (`rl:{externalId}` ZSET, 60s TTL)

### Circuit Breaker

- **Location:** `orchestrator.client.ts`
- **Config:** Opens after 5 failures, 30s cooldown, 2 successes to close
- **States:** CLOSED → OPEN (reject for 30s) → HALF_OPEN (test) → CLOSED
- **Fallback:** When open, uses stub mode automatically

### Retry with Exponential Backoff

- **Location:** `common/utils/resilience.ts`
- **Config:** 3 max attempts, 100ms base delay, 2000ms max delay

### User Context Cache

- **Location:** `user-context.service.ts`
- **Storage:** Redis (`ctx:{userId}`, 60s TTL)

### Two-Phase Message Dedup

```
Message arrives → Check msg:{msgId}
  - "done"       → Ignore (already processed)
  - "processing" → Return "Procesando tu mensaje..."
  - missing      → Set "processing" (120s TTL)

Processing succeeds → Set "done" (24h TTL)
Processing fails    → Delete key (allow retry)
```

### User Lock (Concurrency)

```
Acquire lock:{userId} (5s TTL)
  - Success → Process message
  - Failure → Return "Dame un momento..." (explicit drop)
Finally → Release lock
```

---

## 10. Redis Architecture

### Key Patterns

| Key Pattern | TTL | Type | Description | Status |
|-------------|-----|------|-------------|--------|
| `ctx:{userId}` | 60s | JSON | User context cache | Active |
| `rl:{externalId}` | 60s | ZSET | Rate limiting (30 msgs/min) | Active |
| `lock:{userId}` | 5s | STRING | User-level concurrency lock | Active |
| `msg:{msgId}` | 120s→24h | STRING | Two-phase message dedup | Active |
| `tally:circuit:{service}` | — | STRING | Circuit breaker state | Active |
| `conv:{userId}:summary` | 2-24h | TEXT | Natural language conversation recap | Active (ConversationService) |
| `conv:{userId}:pending` | 10m | JSON | Slot-fill state for multi-turn | Active (ConversationService) |
| `conv:{userId}:metrics` | 30d | JSON | Transaction streak, week count | Active (MetricsService) |
| `conv:{userId}:cooldowns` | 30d | JSON | Nudge cooldown timestamps | Active (CooldownService) |

### Fallback Behavior

- **Single instance** (`MULTI_INSTANCE=false`): Falls back to in-memory Map with warning
- **Multi instance** (`MULTI_INSTANCE=true`): Fail hard (503) if Redis unavailable

---

## 11. Channel System

### Supported Channels

| Channel | Status | Notes |
|---------|--------|-------|
| Telegram | Production | Full support, deep links |
| WhatsApp | Webhook ready | Untested in production |
| Web (test) | Development | `POST /bot/test` endpoint |

### Channel Linking Flow

Two directions:

**Bot-initiated (user messages bot first):**
1. User sends message to bot (unlinked)
2. Bot creates link code (10-min TTL) in `channel_link_codes`
3. Returns link URL: `/connect/{code}`
4. User clicks link → web app checks auth
5. If authenticated → auto-link `channel_accounts` → success
6. If not authenticated → redirect to login with return URL → then auto-link

**Web-initiated (user starts from web):**
1. User generates code on web dashboard
2. User sends `/start CODE` to Telegram bot
3. Bot validates code → links account

**Conflict detection:** Warns if channel is already linked to another account.

### Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/telegram/webhook` | Telegram webhook receiver |
| POST | `/whatsapp/webhook` | WhatsApp webhook receiver |
| POST | `/bot/test` | Debug endpoint (bypasses channel) |
| GET | `/connect/:code` | Channel linking (redirects) |
| GET | `/connect/:code/api` | Channel linking (AJAX) |

---

## 12. Stub Mode (Offline Fallback)

### Cold Start Handling

When the AI service is on Render free tier, it sleeps after 15min of inactivity. The `OrchestratorClient` detects 502 responses as `COLD_START`:
- First 502 → logs `COLD_START`, sends a wake-up GET to `/health`
- Returns user-friendly message: "El servicio esta iniciando..."
- An `AiWarmupService` (cron) can periodically ping the AI service to prevent cold starts

### Activation Triggers

- `AI_SERVICE_URL` not configured
- Circuit breaker is OPEN
- AI service returns 404
- `DISABLE_AI=1` (maintenance mode)
- AI service returns 502 (cold start — triggers wake-up, not stub mode)

### Stub Phase A (Pattern Matching)

| Pattern | Response |
|---------|----------|
| `hola/buenos/buenas/hey/hi` | direct_reply with greeting |
| `gaste/compre/pague` | tool_call `register_transaction` |
| `saldo/balance/cuanto tengo` | tool_call `ask_balance` |
| `presupuesto/budget` | tool_call `ask_budget_status` |
| `meta/goal/ahorro` | tool_call `ask_goal_status` |
| App questions | tool_call `ask_app_info` |
| **Default** | tool_call `ask_app_info` with topic `conversation` |

### Stub Phase B (Simple Responses)

| Tool | Stub Response Example |
|------|----------------------|
| `register_transaction` | "Listo! Registre $15.000 en Comida." |
| `ask_balance` | "En este mes has gastado $X. De tu presupuesto quedan $Y." |
| `ask_budget_status` | "Tu presupuesto mensual es de $500.000." |
| `ask_goal_status` | "Tus metas: Viaje a Europa (45%), Fondo emergencia (80%)" |
| `greeting` | "Hola! En que te puedo ayudar hoy?" |
| `ask_app_info` | Uses knowledge base to generate informative response |

**Limitation:** Stub mode uses basic regex — it's brittle and only suitable as a temporary fallback.

---

## 13. Error Handling

### AI Service Error Codes

| Code | HTTP | When |
|------|------|------|
| `INVALID_PHASE` | 400 | Phase not "A" or "B" |
| `MISSING_USER_TEXT` | 400 | Phase A without user_text |
| `MISSING_ACTION_RESULT` | 400 | Phase B without action_result |
| `LLM_ERROR` | 500 | OpenAI API error |
| `LLM_TIMEOUT` | 503 | OpenAI timeout (>25s) |
| `INVALID_RESPONSE` | 500 | AI response failed validation/parsing |
| `COLD_START` | 503 | AI service returning 502 (Render free tier waking up) |

### Backend Error Messages (Spanish)

| Error | User Message |
|-------|--------------|
| `LLM_TIMEOUT` | "El servicio esta tardando mas de lo normal. Por favor intenta de nuevo." |
| `INVALID_RESPONSE` | "Recibi una respuesta inesperada. Podrias reformular tu mensaje?" |
| `LLM_ERROR` | "Hubo un problema con el servicio de IA. Por favor intenta de nuevo." |
| Default | "Hubo un problema procesando tu solicitud." |

### Correlation IDs

Every request gets a correlation ID (first 8 chars of UUID) for log tracing:
```
[abc12345] Incoming message: channel=telegram, text="gaste 15..."
[abc12345] Context loaded in 45ms
[abc12345] Phase A completed in 1200ms: tool_call
[abc12345] Tool executed in 89ms: ok=true
[abc12345] Phase B completed in 800ms
[abc12345] Complete flow: total=2134ms
```

### Guardrails Validations

| Tool | Validation |
|------|------------|
| `register_transaction` | amount > 0, amount < 100,000,000, date is valid ISO or null, category is non-empty string |
| `ask_balance` | No args, extras ignored |
| `ask_budget_status` | No args |
| `ask_goal_status` | No args |
| `greeting` | No args |

---

## 14. Current State & Gaps

### What Works Well

- Core transaction recording and querying (7 tool handlers)
- Two-phase AI orchestration with personality
- Channel linking with conflict detection (Telegram)
- Resilience: circuit breaker, rate limiting, stub mode, dedup, user locks
- Multiple budgets per user (daily/weekly/monthly)
- User context caching (Redis, 60s TTL)
- Cold start handling for Render free tier (wake-up mechanism)

### Current Gaps

| Capability | Current | Desired |
|------------|---------|---------|
| Edit transaction | Not supported | Full CRUD via conversation |
| Delete transaction | Not supported | Full CRUD via conversation |
| Create category | Not supported | Via conversation |
| Create budget | Web only | Via conversation |
| Create goal | Web only | Via conversation |
| Multi-turn context | **Implemented** (3-tier memory: working memory + session summary + prompt enrichment) | ~~Redis conversation memory~~ Done |
| Missing data handling | **Implemented** (slot-filling via `pending` + `PendingSlotContext`) | ~~Structured slot-filling~~ Done |
| Long-term patterns | Not started | Tier 3: cross-session behavioral patterns in Supabase |
| Proactive messages | None | Daily insights, alerts |
| Adaptive personality | **Partial** (MetricsService + mood hints active, evolution not yet) | Auto-evolves based on usage |
| WhatsApp | Webhook ready | Full end-to-end tested |

### Technical Debt

1. **AI Service cold starts:** Render free tier sleeps after 15min, causing 30-50s delays. Mitigation: wake-up mechanism. Solution: upgrade to paid tier.
2. **Stub mode limitations:** Pattern matching is brittle, basic regex only.
3. **Personality consistency:** Gus identity now embedded in all prompts (fixed), but extended knowledge base only available in `ask_app_info`.
4. **WhatsApp untested:** Webhook exists but needs end-to-end testing with Meta API.

---

## 15. Planned Roadmap

### Phase 2: CRUD Operations

| Feature | Priority |
|---------|----------|
| `edit_transaction` | High |
| `delete_transaction` | High |
| `add_category` | High |
| `create_budget` | Medium |
| `update_budget` | Medium |
| `create_goal` | Medium |
| `update_goal` | Medium |

### Phase 3: Conversation Intelligence

| Feature | Description | Status |
|---------|-------------|--------|
| Slot-filling | Multi-turn conversations for missing data (`conv:pending`) | **Implemented** |
| Tier 1: Working Memory | Raw message history injected into LLM context (`conv:history`) | **Implemented** |
| Tier 2: Session Summary | Compressed action log with pattern dedup (`conv:summary`) | **Implemented** |
| Prompt Enrichment | Reference resolution, context deduction, pattern recognition, style coherence rules in Phase A/B prompts | **Implemented** |
| Enriched Summaries | `_summarize_action()` includes amounts, descriptions, remaining budget, user questions | **Implemented** |
| Session Depth Awareness | `session_action_count` modulates response verbosity in Phase B | **Implemented** |
| Tier 3: Long-Term Patterns | Cross-session behavioral intelligence stored in Supabase (spending habits, time patterns, category preferences) | **Planned** |
| Smart categorization | AI-powered category suggestions | Not started |
| WhatsApp integration | Full end-to-end tested support | Not started |

### Phase 4: Adaptive Personality (GUS)

| Component | Description | Status |
|-----------|-------------|--------|
| `MetricsService` | Track engagement (streak, weekly count) | **Implemented** |
| `InsightService` | Generate personalized financial insights | Not started |
| `PersonalityEvolutionService` | Adapt bot personality over time based on usage | Not started |
| Mood detection | Adjust responses based on detected user mood | **Partial** (mood_hint + calculate_final_mood active) |
| Proactive insights | Daily/weekly financial summaries | Not started |

### Future Vision

| Feature | Description |
|---------|-------------|
| RAG | Semantic search for financial tips |
| OCR | Read amounts from receipt photos |
| Voice messages | Audio transcription and response |
| Web chat | Direct chat in web dashboard |

---

## 16. Environment Configuration

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
WHATSAPP_GRAPH_API_BASE=https://graph.facebook.com
WHATSAPP_GRAPH_API_VERSION=v17.0

# Frontend
CORS_ORIGINS=http://localhost:5173
LINK_ACCOUNT_URL=http://localhost:5173/connect/

# Feature Flags
DISABLE_AI=0               # Set to 1 for maintenance mode
MULTI_INSTANCE=false        # If true, fail hard when Redis unavailable
```

### AI Service (.env)

```bash
OPENAI_API_KEY=sk-proj-xxx
OPENAI_MODEL=gpt-4o-mini
OPENAI_TIMEOUT=25.0
OPENAI_TEMPERATURE_PHASE_A=0.3
OPENAI_TEMPERATURE_PHASE_B=0.7
```

---

## 17. Related Documentation

These documents are **not** consolidated here — they serve separate purposes:

| Document | Purpose |
|----------|---------|
| `CLAUDE.md` (root) | Claude Code instructions for the project |
| `backend-API_TallyFinance/CLAUDE.md` | Backend-specific Claude Code instructions |
| `ai-service_TallyFinane/CLAUDE.md` | AI service-specific Claude Code instructions |
| `tally-combined/backend-API_TallyFinance/CLAUDE.md` | Combined backend Claude Code instructions |
| `tally-combined/ai-service_TallyFinane/CLAUDE.md` | Combined AI service Claude Code instructions |
| `tally-combined/backend-API_TallyFinance/docs/GUIA_ENDPOINTS_POSTMAN.md` | Postman endpoint testing guide |
| `tally-combined/ai-service_TallyFinane/docs/GUIA_ENDPOINTS_Y_TESTING.md` | AI service testing guide |
| `docs/LANDING_PAGE_CONTENT.md` | Landing page content |
| `docs/pruebas-handlers/*` | Tool handler test scripts (7 files) |

---

**Document Version:** 2.3
**Last Updated:** February 2026
**Consolidated from:** SYSTEM_ARCHITECTURE.md, DIAGNOSTIC_JAN2026.md, GUS_ADAPTIVE_ARCHITECTURE.md, IMPLEMENTATION_SUMMARY.md, MEGA_GUIA_HYBRID_BOT_V1.md
**v2.1 fixes:** OAuth is Google-only, `user_emotional_log` unused, added `bot_message_log`, admin UUID whitelist, `COLD_START`/`INVALID_RESPONSE` error codes, `pending`/`available_categories` for slot-filling, `conv:*` Redis keys Active, onboarding 7-step, `ask_budget_status` `.maybeSingle()`
**v2.2 fixes:** Fixed Phase A request (user_id inside user_context, added pending+categories to request not response), added debug_logger.py+Dockerfile to AI service file structure, full Orchestrator method signatures (10 methods incl. retry, cid), fixed Gus character ("Gus" not "Tally", serious not friendly), added 3-circle scope system, Phase B nudge detection + summary generation, mood `disappointed`→`tired` legacy mapping, MAX_RETRIES/ENDPOINT_TIMEOUT config
**v2.3 additions:** Conversational Memory 3-Tier System (Section 5.9) — documented Tier 1 (working memory), Tier 2 (session summary with enriched summaries and pattern compression), Tier 3 (long-term patterns, planned). Phase A reference resolution rules and rapid registration pattern (Section 5.7). Phase B conversational behavior rules, pattern recognition, style coherence, and session depth awareness (Section 5.8). History-aware variability rules (Section 5.6). Enriched `_summarize_action()` with amounts, descriptions, remaining budgets. Updated roadmap Phase 3 with tier completion status.
