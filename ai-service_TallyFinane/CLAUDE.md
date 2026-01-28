# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TallyFinance AI Service - A FastAPI-based microservice that provides AI orchestration for a personal finance chatbot called **"Gus"**. This service handles intent analysis (Phase A) and reply generation (Phase B) using OpenAI's API.

**Core principle:** "Backend ejecuta, IA entiende/decide/comunica" (Backend executes, AI understands/decides/communicates)

## Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Run development server
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

## Architecture

### Two-Phase Orchestration Flow

The `/orchestrate` endpoint handles two distinct phases via explicit `phase` field:

**Phase A (Intent Analysis):** `phase: "A"`
- Input: `user_text`, `user_context`, `tools`
- Analyzes user text to determine intent
- Returns one of: `tool_call`, `clarification`, or `direct_reply`
- Used by NestJS backend to decide which tool/action to execute
- Temperature: 0.3 (more deterministic)
- Response format: JSON mode

**Phase B (Reply Generation):** `phase: "B"`
- Input: `tool_name`, `action_result`, `user_context`
- Takes the result of a backend-executed action
- Generates personalized user-facing message based on persona (tone/intensity/mood)
- Returns `final_message`
- Temperature: 0.7 (more creative)
- Response format: Plain text
- **Special handling for `ask_app_info`**: Receives `appKnowledge`, `aiInstruction`, `userQuestion`

### File Structure

```
app.py                    # FastAPI app, routes /orchestrate, /health, /
config.py                 # Settings via pydantic-settings
schemas.py                # Pydantic models (Phase A/B requests/responses)
orchestrator.py           # Orchestrator class with phase_a() and phase_b()
tool_schemas.py           # 6 tool definitions for V1
prompts/
  phase_a_system.txt      # Intent classification prompt
  phase_b_system.txt      # Message generation prompt
```

### Key Schemas

**Phase A Request:**
```python
OrchestrateRequestPhaseA(phase="A", user_text, user_context, tools)
```

**Phase A Response:**
```python
OrchestrateResponsePhaseA(phase="A", response_type, tool_call?, clarification?, direct_reply?)
```

**Phase B Request:**
```python
OrchestrateRequestPhaseB(phase="B", tool_name, action_result, user_context)
```

**Phase B Response:**
```python
OrchestrateResponsePhaseB(phase="B", final_message)
```

### V1 Tools (6 Total)

| Tool | Required Args | Optional Args | Description |
|------|---------------|---------------|-------------|
| `ask_app_info` | `userQuestion` | `suggestedTopic` | **NEW** - Answer questions about TallyFinance, features, how-to, limitations |
| `register_transaction` | `amount`, `category` | `posted_at`, `payment_method`, `description` | Register expense/income |
| `ask_balance` | - | - | Query user's balance |
| `ask_budget_status` | - | - | Query active budget status |
| `ask_goal_status` | - | - | Query savings goals progress |
| `greeting` | - | - | Handle simple greetings |

### ask_app_info Tool Details

This tool handles questions about the app and requires special data flow:

**Phase A extracts:**
- `userQuestion`: The original user question (required)
- `suggestedTopic`: One of `capabilities`, `how_to`, `limitations`, `channels`, `getting_started`, `about`, `security`, `pricing`, `other`

**Phase B receives (via action_result.data):**
- `appKnowledge`: Knowledge base object from backend with app info
- `aiInstruction`: Additional context/instructions
- `userQuestion`: Original question for context

**Triggers:** Questions about bot capabilities, how to use the app, limitations, security, channels

### Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| INVALID_PHASE | 400 | Phase must be "A" or "B" |
| MISSING_USER_TEXT | 400 | Phase A requires user_text |
| MISSING_ACTION_RESULT | 400 | Phase B requires action_result |
| LLM_ERROR | 500 | OpenAI API error |
| LLM_TIMEOUT | 503 | Timeout >25s |

## Environment Variables

```
OPENAI_API_KEY              # Required: OpenAI API key
OPENAI_MODEL                # Optional: Model (default: gpt-4o-mini)
OPENAI_TIMEOUT              # Optional: Timeout seconds (default: 25.0)
OPENAI_TEMPERATURE_PHASE_A  # Optional: Phase A temperature (default: 0.3)
OPENAI_TEMPERATURE_PHASE_B  # Optional: Phase B temperature (default: 0.7)
```

## Integration with NestJS Backend

The NestJS backend (TallyFinance main app):
1. Receives user messages from Telegram/WhatsApp
2. Calls Phase A (`phase: "A"`) with user text + context + tool schemas
3. If `response_type: "tool_call"` → executes the tool locally in Supabase
4. Calls Phase B (`phase: "B"`) with tool_name + action_result + context
5. Returns `final_message` to user

The AI service never accesses the database directly.

## Supabase Schema Mapping

### AI Field → Supabase Table.Column

**For `register_transaction` tool:**
| AI Field | Supabase | Notes |
|----------|----------|-------|
| `amount` | `transactions.amount` | Required, number in CLP |
| `category` | `categories.name` → lookup `category_id` | Backend looks up by name |
| `posted_at` | `transactions.posted_at` | ISO date, default today |
| `payment_method` | `payment_method.name` → lookup `payment_method_id` | Backend uses default if not provided |
| `description` | `transactions.description` | Optional |

**For `user_context.personality`:**
| AI Field | Supabase | Values |
|----------|----------|--------|
| `tone` | `personality_snapshot.tone` | neutral, friendly, serious, motivational, strict |
| `intensity` | `personality_snapshot.intensity` | 0.0 - 1.0 |
| `mood` | `personality_snapshot.mood` | normal, happy, disappointed, tired, hopeful, frustrated, proud |

**For `user_context.prefs`:**
| AI Field | Supabase | Values |
|----------|----------|--------|
| `notification_level` | `user_prefs.notification_level` | none, light, medium, intense |
| `unified_balance` | `user_prefs.unified_balance` | boolean |

**For `user_context.active_budget`:**
| AI Field | Supabase | Notes |
|----------|----------|-------|
| `period` | `spending_expectations.period` | daily, weekly, monthly |
| `amount` | `spending_expectations.amount` | Budget limit |
| `spent` | Calculated from `transactions` | Not stored in spending_expectations |

## Personality System

The AI personalizes responses based on user preferences stored in `personality_snapshot`:

### Tone (how Gus speaks)

| Tone | Behavior |
|------|----------|
| `neutral` | Balanced between formal and friendly, moderate emojis |
| `friendly` | Warm, uses emojis, Chilean expressions allowed |
| `serious` | Concise, professional, no emojis |
| `motivational` | Encouraging, finance-related motivation |
| `strict` | Direct, data-focused, no fluff |

### Intensity (0.0 - 1.0)

| Range | Behavior |
|-------|----------|
| `> 0.7` | More expressive, enthusiastic, more emojis |
| `0.3 - 0.7` | Moderate balance |
| `< 0.3` | Sober, contained, minimal expression |

### Mood (Gus's emotional state)

| Mood | Behavior |
|------|----------|
| `normal` | Standard response |
| `happy` | Celebrates achievements joyfully |
| `disappointed` | Empathetic but motivating |
| `tired` | Concise but kind |
| `hopeful` | Optimistic about financial future |
| `frustrated` | Understanding, offers concrete help |
| `proud` | Celebrates user's accomplishments |

## Database Schema (Supabase)

### Tables

| Table | Purpose |
|-------|---------|
| `users` | Main user table with `package` tier |
| `transactions` | Financial transactions |
| `categories` | User-defined expense categories |
| `payment_method` | Credit/debit cards |
| `goals` | Savings goals |
| `spending_expectations` | Budget limits |
| `personality_snapshot` | Bot personality per user |
| `user_prefs` | Notification preferences |
| `user_emotional_log` | Tracks user emotions |
| `channel_accounts` | Links to Telegram/WhatsApp/Web |
| `channel_link_codes` | Account linking codes |

### Key Enums

| Enum | Values |
|------|--------|
| `bot_tone_enum` | neutral, friendly, serious, motivational, strict |
| `bot_mood_enum` | normal, happy, disappointed, tired, hopeful, frustrated, proud |
| `emotion_t` | neutral, feliz, triste, ansioso, enojado, estresado |
| `tx_source_t` | manual, chat_intent, import, bank_api, ai_extraction |
| `app_pkg_enum` | basic, intermedio, avanzado |
| `channel_t` | telegram, whatsapp, web |

## Known Issue: Personality Consistency

**Current Problem:** Gus's character personality (backstory, speaking style, catchphrases, easter eggs) is only sent to the AI-SERVICE when the `ask_app_info` tool is called. For other tools, the AI only receives raw data without character context.

**Result:** Gus has personality when answering app questions, but sounds generic for transactions, budget status, etc.

**Planned Solution:** Hybrid architecture where:
- **Static personality** (Gus's identity, style, knowledge) is embedded in AI-SERVICE prompts
- **Dynamic values** (tone, intensity, mood per user) continue from backend
