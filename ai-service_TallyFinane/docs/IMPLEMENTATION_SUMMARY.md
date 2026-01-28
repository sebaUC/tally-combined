# Implementation Summary - AI Service TallyFinance

**Date:** December 27, 2024
**Project:** TallyFinance AI Service (FastAPI)
**Objective:** Implement Section 6 of MEGA_GUIA_HYBRID_BOT_V1.md - AI Service Components

---

## Table of Contents

1. [Initial State](#1-initial-state)
2. [Target Architecture](#2-target-architecture)
3. [Implementation Steps](#3-implementation-steps)
4. [Files Created/Modified](#4-files-createdmodified)
5. [Schema Alignment with Supabase](#5-schema-alignment-with-supabase)
6. [Testing Results](#6-testing-results)
7. [Final Architecture](#7-final-architecture)

---

## 1. Initial State

### Before Implementation

The project had a basic structure with implicit phase handling:

```
ai-service/
├── app.py                      # Basic FastAPI with /orchestrate
├── models/
│   ├── __init__.py
│   └── orchestrator.py         # Simple Pydantic models
├── services/
│   ├── __init__.py
│   ├── intent_analysis.py      # analyze_intent() function
│   └── reply_generation.py     # generate_reply() function
├── requirements.txt
└── .env
```

### Problems with Initial Implementation

| Issue | Description |
|-------|-------------|
| Implicit Phase Handling | Routed based on `actionResult` presence, not explicit `phase` field |
| Wrong Response Schema | Used `intent`, `confidence`, `slots`, `message` instead of `response_type`, `tool_call`, etc. |
| No Tool Definitions | No centralized tool schema registry |
| Embedded Prompts | Prompts hardcoded in Python functions |
| No Config Management | Scattered `os.getenv()` calls |
| Missing Health Endpoint | No `/health` endpoint |
| No Error Codes | Generic 500 errors instead of specific codes |

---

## 2. Target Architecture

Based on MEGA_GUIA_HYBRID_BOT_V1.md Section 6:

```
ai-service/
├── app.py                    # FastAPI app + endpoints
├── config.py                 # Centralized settings
├── schemas.py                # All Pydantic models
├── orchestrator.py           # Orchestrator class
├── tool_schemas.py           # Tool definitions
├── prompts/
│   ├── phase_a_system.txt    # Intent classification prompt
│   └── phase_b_system.txt    # Message generation prompt
├── requirements.txt
├── database.types.ts         # Supabase schema reference
├── CLAUDE.md                 # Documentation
└── .env
```

### Two-Phase Orchestration

**Phase A (Intent Analysis):**
- Input: `user_text`, `user_context`, `tools`
- Output: `response_type` (tool_call | clarification | direct_reply)

**Phase B (Reply Generation):**
- Input: `tool_name`, `action_result`, `user_context`
- Output: `final_message`

---

## 3. Implementation Steps

### Step 1: Create config.py + Update requirements.txt

**Created:** `config.py`
```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    OPENAI_API_KEY: str
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_TIMEOUT: float = 25.0
    OPENAI_TEMPERATURE_PHASE_A: float = 0.3
    OPENAI_TEMPERATURE_PHASE_B: float = 0.7
    SERVICE_VERSION: str = "1.0.0"
    MAX_RETRIES: int = 1
    ENDPOINT_TIMEOUT: float = 30.0
```

**Updated:** `requirements.txt` - Added `pydantic-settings`

---

### Step 2: Create schemas.py

**Created:** `schemas.py` with:

- **Enums matching Supabase:**
  - `ToneType` = "neutral" | "friendly" | "serious" | "motivational" | "strict"
  - `MoodType` = "normal" | "happy" | "disappointed" | "tired" | "hopeful" | "frustrated" | "proud"
  - `NotificationLevelType` = "none" | "light" | "medium" | "intense"
  - `GoalStatusType` = "in_progress" | "completed" | "canceled"

- **Models:**
  - `ToolCall(name, args)`
  - `Personality(tone, intensity, mood)`
  - `UserPrefs(notification_level, unified_balance)`
  - `Budget(period, amount, spent)`
  - `Goal(name, target_amount, progress_amount, status)`
  - `MinimalUserContext(user_id, personality, prefs, active_budget, goals_summary)`
  - `ActionResult(ok, action, data, userMessage, errorCode)`

- **Phase A:**
  - `OrchestrateRequestPhaseA(phase="A", user_text, user_context, tools)`
  - `OrchestrateResponsePhaseA(phase="A", response_type, tool_call, clarification, direct_reply)`

- **Phase B:**
  - `OrchestrateRequestPhaseB(phase="B", tool_name, action_result, user_context)`
  - `OrchestrateResponsePhaseB(phase="B", final_message)`

- **Error Codes:**
  - `INVALID_PHASE`, `MISSING_USER_TEXT`, `MISSING_ACTION_RESULT`, `LLM_ERROR`, `LLM_TIMEOUT`

---

### Step 3: Create tool_schemas.py

**Created:** `tool_schemas.py` with 6 V1 tools:

| Tool | Required Args | Optional Args | Description |
|------|---------------|---------------|-------------|
| `ask_app_info` | userQuestion | suggestedTopic | **NEW** - Answer questions about TallyFinance |
| `register_transaction` | amount, category | posted_at, payment_method, description | Register expense/income |
| `ask_balance` | - | - | Query account balance |
| `ask_budget_status` | - | - | Query budget status |
| `ask_goal_status` | - | - | Query goals progress |
| `greeting` | - | - | Handle greetings |

**Note:** `ask_app_info` was added post-V1 spec to handle questions about the app, its features, limitations, and how-to guides.

---

### Step 4: Create prompts/ Directory

**Created:** `prompts/phase_a_system.txt`
- Intent classification rules
- Field extraction guidance for register_transaction
- JSON response format specification
- Tool selection logic

**Created:** `prompts/phase_b_system.txt`
- Personality-based message generation
- Tone rules (neutral, friendly, serious, motivational, strict)
- Mood rules (normal, happy, disappointed, tired, hopeful, frustrated, proud)
- Intensity modulation
- CLP formatting rules

---

### Step 5: Create orchestrator.py

**Created:** `orchestrator.py` with `Orchestrator` class:

```python
class Orchestrator:
    def __init__(self, client: OpenAI, config: Settings)
    def load_prompt(self, filename: str) -> str
    def _call_openai_json(self, messages, temperature) -> dict
    def _call_openai_text(self, messages, temperature) -> str
    def phase_a(self, user_text, user_context, tools) -> OrchestrateResponsePhaseA
    def phase_b(self, tool_name, action_result, user_context) -> OrchestrateResponsePhaseB
```

**Features:**
- External prompt loading from files
- Retry logic (MAX_RETRIES + 1 attempts)
- JSON mode for Phase A
- Text mode for Phase B
- Personality extraction with defaults
- Mood support

---

### Step 6: Refactor app.py

**Updated:** `app.py` with:

- **POST /orchestrate** - Main endpoint with phase routing
- **GET /health** - Health check with model and version
- **GET /** - Root endpoint with service info
- **Error handling** with specific codes:
  - 400 INVALID_PHASE
  - 400 MISSING_USER_TEXT
  - 400 MISSING_ACTION_RESULT
  - 500 LLM_ERROR
  - 503 LLM_TIMEOUT

---

### Step 7: Clean Up Old Files

**Deleted:**
- `models/` directory (orchestrator.py, __init__.py)
- `services/` directory (intent_analysis.py, reply_generation.py, __init__.py)

---

### Step 8: Align with Supabase Schema

**Read:** `database.types.ts` (generated from Supabase)

**Aligned:**
- All enums match exactly (bot_tone_enum, bot_mood_enum, etc.)
- Tool fields map to correct table columns
- Added mood support to Personality model
- Updated transaction tool with `posted_at` instead of `date`
- Added `description` field to transaction tool

---

### Step 9: Update Documentation

**Updated:** `CLAUDE.md` with:
- Complete architecture documentation
- Supabase schema mapping tables
- Environment variables
- Integration guide

---

## 4. Files Created/Modified

| File | Action | Lines | Description |
|------|--------|-------|-------------|
| `config.py` | Created | 24 | Centralized settings with pydantic-settings |
| `schemas.py` | Created | 187 | All Pydantic models matching Supabase |
| `tool_schemas.py` | Created | 121 | 6 tool definitions (5 V1 + ask_app_info) |
| `orchestrator.py` | Created | 189 | Orchestrator class with phase_a/phase_b |
| `prompts/phase_a_system.txt` | Created | 45 | Intent classification prompt |
| `prompts/phase_b_system.txt` | Created | 49 | Message generation prompt |
| `app.py` | Rewritten | 126 | FastAPI with proper routing and error handling |
| `requirements.txt` | Modified | 6 | Added pydantic-settings |
| `CLAUDE.md` | Rewritten | 145 | Complete documentation |
| `models/` | Deleted | - | Replaced by schemas.py |
| `services/` | Deleted | - | Replaced by orchestrator.py |

**Total new code:** ~720 lines

---

## 5. Schema Alignment with Supabase

### Enums Mapping

| Supabase Enum | Python Type | Values |
|---------------|-------------|--------|
| `bot_tone_enum` | `ToneType` | neutral, friendly, serious, motivational, strict |
| `bot_mood_enum` | `MoodType` | normal, happy, disappointed, tired, hopeful, frustrated, proud |
| `notification_level_enum` | `NotificationLevelType` | none, light, medium, intense |
| `goal_status_enum` | `GoalStatusType` | in_progress, completed, canceled |
| `payment_type_t` | `PaymentTypeType` | credito, debito |
| `tx_source_t` | `TxSourceType` | manual, chat_intent, import, bank_api, ai_extraction |

### Transaction Tool → Supabase

| AI Tool Arg | Supabase Column | Notes |
|-------------|-----------------|-------|
| `amount` | `transactions.amount` | Required |
| `category` | `categories.name` → `category_id` | Backend looks up |
| `posted_at` | `transactions.posted_at` | Default: today |
| `payment_method` | `payment_method.name` → `payment_method_id` | Backend default if missing |
| `description` | `transactions.description` | Optional |

### Context → Supabase

| Context Field | Source Table | Columns |
|---------------|--------------|---------|
| `personality` | `personality_snapshot` | tone, intensity, mood |
| `prefs` | `user_prefs` | notification_level, unified_balance |
| `active_budget` | `spending_expectations` | period, amount (+ calculated spent) |
| `goals_summary` | `goals` | Formatted from name, progress, target |

---

## 6. Testing Results

### All Tests Passed

| Test | Endpoint | Result |
|------|----------|--------|
| Health Check | GET /health | ✅ `{"status":"healthy","model":"gpt-4o-mini","version":"1.0.0"}` |
| Root | GET / | ✅ `{"status":"ok","service":"ai-service","version":"1.0.0"}` |
| Phase A - Greeting | POST /orchestrate | ✅ Returns `tool_call: {name: "greeting"}` |
| Phase A - Transaction | POST /orchestrate | ✅ Extracts amount, category, posted_at, description |
| Phase A - Clarification | POST /orchestrate | ✅ Asks for missing info |
| Phase B - Friendly + Proud | POST /orchestrate | ✅ Celebratory message with emojis |
| Phase B - Friendly + Disappointed | POST /orchestrate | ✅ Empathetic message |
| Phase B - Serious | POST /orchestrate | ✅ Professional, no emojis |
| Invalid Phase | POST /orchestrate | ✅ Pydantic validation error |

---

## 7. Final Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         AI-SERVICE (FastAPI)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐     ┌──────────────┐     ┌─────────────────┐  │
│  │   app.py    │────►│ orchestrator │────►│    OpenAI API   │  │
│  │             │     │    .py       │     │                 │  │
│  │ /orchestrate│     │              │     │  gpt-4o-mini    │  │
│  │ /health     │     │  phase_a()   │     │                 │  │
│  │ /           │     │  phase_b()   │     └─────────────────┘  │
│  └─────────────┘     └──────────────┘                           │
│         │                   │                                    │
│         ▼                   ▼                                    │
│  ┌─────────────┐     ┌──────────────┐                           │
│  │ schemas.py  │     │   prompts/   │                           │
│  │             │     │              │                           │
│  │ PhaseA Req  │     │ phase_a.txt  │                           │
│  │ PhaseA Res  │     │ phase_b.txt  │                           │
│  │ PhaseB Req  │     │              │                           │
│  │ PhaseB Res  │     └──────────────┘                           │
│  └─────────────┘                                                 │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────┐     ┌──────────────┐                           │
│  │ config.py   │     │tool_schemas  │                           │
│  │             │     │    .py       │                           │
│  │  Settings   │     │              │                           │
│  │             │     │ 6 V1 tools   │                           │
│  └─────────────┘     └──────────────┘                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      NestJS Backend (Caller)                     │
│                                                                  │
│  1. Receive message from Telegram/WhatsApp                      │
│  2. Build MinimalUserContext from Supabase                      │
│  3. Call Phase A → Get tool_call/clarification/direct_reply     │
│  4. If tool_call → Execute handler (Supabase operations)        │
│  5. Call Phase B → Get final_message                            │
│  6. Send final_message to user                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Summary

The AI-Service has been fully implemented according to MEGA_GUIA_HYBRID_BOT_V1.md Section 6:

- ✅ Explicit Phase A/B handling with `phase` field
- ✅ Proper response types (tool_call, clarification, direct_reply)
- ✅ 6 tools defined (5 V1 + ask_app_info)
- ✅ External prompt files
- ✅ Centralized configuration
- ✅ Health endpoint
- ✅ Specific error codes
- ✅ Supabase schema alignment
- ✅ Mood and personality support
- ✅ All tests passing

**The AI-Service is production-ready for integration with the NestJS backend.**

---

## Post-V1 Additions

### ask_app_info Tool (Added January 2025)

A 6th tool was added to handle questions about the app:

**Purpose:** Answers user questions about TallyFinance features, how-to guides, limitations, security, etc.

**Phase A behavior:**
- Triggers on: "qué puede hacer el bot", "cómo funciona", "ayuda", "limitaciones", "seguridad"
- Extracts: `userQuestion` (required), `suggestedTopic` (optional)
- Topics: capabilities, how_to, limitations, channels, getting_started, about, security, pricing, other

**Phase B behavior:**
- Receives special fields in `action_result.data`:
  - `appKnowledge`: Knowledge base object from backend
  - `aiInstruction`: Additional context
  - `userQuestion`: Original question
- Special prompt rules for generating informative responses

**Backend requirement:** The NestJS `AskAppInfoHandler` must return the `appKnowledge` object with app information.

---

## Known Issue: Personality Consistency

**Problem:** Gus's character personality (backstory, speaking style, easter eggs) is only sent when `ask_app_info` is called. Other tools get generic responses.

**Planned Fix:** Embed static Gus personality in AI-SERVICE prompts so ALL tools respond in character.
