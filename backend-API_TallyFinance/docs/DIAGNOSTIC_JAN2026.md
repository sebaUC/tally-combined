# TallyFinance System Diagnostic - January 2026

## Overview

TallyFinance is a personal finance assistant operating through Telegram and WhatsApp with a two-phase AI orchestration pattern.

**Core Principle:** "Backend ejecuta, IA entiende/decide/comunica"

---

## Current Architecture

```
User Message → Channel Adapter → Backend (NestJS) → Phase A (AI) → Tool Handler → Phase B (AI) → Response
```

### Services Stack

| Service | Technology | Status |
|---------|------------|--------|
| Backend | NestJS/TypeScript | ✅ Production |
| AI Service | FastAPI/Python | ✅ Production (Render free tier) |
| Frontend | React/Vite | ✅ Production (Vercel) |
| Database | Supabase (PostgreSQL) | ✅ Production |
| Cache | Redis (Upstash) | ✅ Production |

---

## Current Features (What We Have)

### 1. Tool Handlers (7 total)

| Tool | Status | Context Required | Description |
|------|--------|------------------|-------------|
| `register_transaction` | ✅ | Yes | Record expenses/income with category, amount, description |
| `ask_balance` | ✅ | Yes | Query spending totals & budget remaining |
| `ask_budget_status` | ✅ | Yes | Check budget configuration by period |
| `ask_goal_status` | ✅ | Yes | Query savings goals progress |
| `ask_app_info` | ✅ | No | Answer app-related questions (has knowledge base) |
| `greeting` | ✅ | No | Handle greetings with personality |
| `unknown` | ✅ | No | Fallback for unrecognized intents |

### 2. User Context System

- **Personality**: tone, intensity, mood (affects Phase B responses)
- **Preferences**: timezone, locale, notification level, unified balance
- **Multiple Budgets**: daily, weekly, monthly (all active simultaneously)
- **Goals**: count and summary
- **Categories**: user's custom categories for transaction matching
- **Cache**: Redis with 60s TTL

### 3. Channel Linking

- **Web-initiated flow**: User generates code on web → sends `/start CODE` to bot
- **Bot-initiated flow**: Bot generates code → user completes on web
- **Conflict detection**: Warns if channel already linked to another account
- **Supported channels**: Telegram (WhatsApp planned)

### 4. AI Service Resilience

- **Cold start handling**: Wake-up mechanism for Render free tier (sleeps after 15min)
- **Circuit breaker**: Opens after 5 failures, 30s cooldown
- **Stub mode**: Pattern-matching fallback when AI unavailable
- **Rate limiting**: 30 msgs/min per user

### 5. Two-Phase AI Orchestration

| Phase | Model | Temperature | Mode | Purpose |
|-------|-------|-------------|------|---------|
| Phase A | gpt-4o-mini | 0.3 | JSON | Intent analysis, tool selection |
| Phase B | gpt-4o-mini | 0.7 | Text | Personalized response generation |

### 6. Database Schema

**Core Tables:**
- `users` - User profiles with full_name, nickname, timezone, locale
- `user_prefs` - Notification level, unified balance
- `personality_snapshot` - Bot personality per user
- `channel_accounts` - Linked channels (telegram, whatsapp)
- `transactions` - Financial records
- `categories` - User-defined categories
- `payment_method` - Payment methods
- `goals` - Savings goals with target amounts
- `spending_expectations` - Budgets by period (daily/weekly/monthly)

---

## Planned Features (What We Want)

### Phase 2: CRUD Operations

| Feature | Priority | Status |
|---------|----------|--------|
| `add_category` | High | 🔲 Not started |
| `edit_transaction` | High | 🔲 Not started |
| `delete_transaction` | High | 🔲 Not started |
| `create_budget` | Medium | 🔲 Not started |
| `update_budget` | Medium | 🔲 Not started |
| `create_goal` | Medium | 🔲 Not started |
| `update_goal` | Medium | 🔲 Not started |

### Phase 3: Advanced Features

| Feature | Description | Status |
|---------|-------------|--------|
| Slot-filling | Multi-turn conversations for missing data | 🔲 Not started |
| Conversation memory | Redis-backed context across messages | 🔲 Partial (keys defined) |
| Proactive insights | Daily/weekly financial summaries | 🔲 Not started |
| Smart categorization | AI-powered category suggestions | 🔲 Not started |
| WhatsApp integration | Full WhatsApp channel support | 🔲 Webhook ready |

### Phase 4: Adaptive Personality (GUS)

| Component | Description | Status |
|-----------|-------------|--------|
| `MetricsService` | Track user engagement metrics | 🔲 Not started |
| `InsightService` | Generate personalized insights | 🔲 Not started |
| `PersonalityEvolutionService` | Adapt bot personality over time | 🔲 Not started |
| Mood detection | Adjust responses based on user mood | 🔲 Not started |

---

## Gap Analysis: Current vs Desired

### User Interactions

| Capability | Current | Desired |
|------------|---------|---------|
| Record transaction | ✅ Single-turn | Multi-turn with slot-filling |
| Edit transaction | ❌ Not supported | ✅ Full CRUD |
| Delete transaction | ❌ Not supported | ✅ Full CRUD |
| Create category | ❌ Not supported | ✅ Via conversation |
| Create budget | ❌ Web only | ✅ Via conversation |
| Create goal | ❌ Web only | ✅ Via conversation |

### Conversation Intelligence

| Capability | Current | Desired |
|------------|---------|---------|
| Single message understanding | ✅ Works well | ✅ Maintained |
| Multi-turn context | ❌ Stateless | ✅ Redis conversation memory |
| Missing data handling | ❌ Asks AI to clarify | ✅ Structured slot-filling |
| Proactive messages | ❌ None | ✅ Daily insights, alerts |

### Personalization

| Capability | Current | Desired |
|------------|---------|---------|
| Static personality | ✅ tone/intensity/mood | ✅ Maintained |
| Adaptive personality | ❌ Manual only | ✅ Auto-evolves based on usage |
| User engagement tracking | ❌ None | ✅ MetricsService |
| Personalized insights | ❌ None | ✅ InsightService |

### Channels

| Channel | Current | Desired |
|---------|---------|---------|
| Telegram | ✅ Full support | ✅ Maintained |
| WhatsApp | ⚠️ Webhook ready | ✅ Full support |
| Web chat | ❌ None | 🤔 Consider |

---

## Technical Debt

1. **AI Service cold starts**: Render free tier sleeps, causing 30-50s delays
   - Mitigation: Wake-up mechanism implemented
   - Solution: Upgrade to paid tier or self-host

2. **Stub mode limitations**: Pattern matching is brittle
   - Current: Basic regex patterns
   - Desired: More sophisticated fallback or faster AI recovery

3. **Single budget assumption**: Legacy code assumed one budget
   - Fixed: Now supports multiple active budgets
   - Check: All consumers handle arrays correctly

4. **WhatsApp not tested**: Webhook exists but untested in production
   - Action needed: End-to-end testing with Meta API

---

## Redis Key Structure (Defined but Underutilized)

```
tally:{userId}:context        → User context cache (60s TTL) ✅ Used
tally:{userId}:conv           → Conversation state 🔲 Planned
tally:{userId}:slots          → Slot-filling state 🔲 Planned
tally:{userId}:metrics        → Engagement metrics 🔲 Planned
tally:{userId}:rateLimit      → Rate limiting ✅ Used
tally:circuit:{service}       → Circuit breaker state ✅ Used
```

---

## Summary

**What works well:**
- Core transaction recording and querying
- Two-phase AI orchestration with personality
- Channel linking with conflict detection
- Basic resilience (circuit breaker, rate limiting, stub mode)
- Multiple budgets per user

**Biggest gaps:**
- No CRUD operations for transactions/categories/budgets/goals
- No multi-turn conversation support
- No proactive engagement
- WhatsApp untested

**Recommended next priorities:**
1. `edit_transaction` and `delete_transaction` tools
2. Slot-filling for incomplete transactions
3. WhatsApp end-to-end testing
4. Basic conversation memory for context
