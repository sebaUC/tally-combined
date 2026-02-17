# CLAUDE.md — AI Service (TallyFinance)

This file provides guidance to Claude Code when working with the AI service codebase.

## Overview

FastAPI microservice that provides AI orchestration for TallyFinance's chatbot **"Gus"**. Handles intent analysis (Phase A) and personalized reply generation (Phase B) using OpenAI's API. This service **never touches the database** — the NestJS backend handles all DB operations.

**Core principle:** *"Backend ejecuta, IA entiende/decide/comunica"*

## Tech Stack

| Dependency | Version | Purpose |
|------------|---------|---------|
| Python | 3.11 (Dockerfile) | Runtime |
| FastAPI | latest | Web framework |
| uvicorn[standard] | latest | ASGI server |
| openai | latest | OpenAI API client |
| pydantic | latest | Data validation, schemas |
| pydantic-settings | latest | Settings from env vars |
| python-dotenv | latest | .env file loading |

## Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Run development server (auto-reload)
uvicorn app:app --reload --host 0.0.0.0 --port 8000

# Production (as in Dockerfile)
uvicorn app:app --host 0.0.0.0 --port 8000 --workers 1
```

## Deployment

**Dockerfile** uses `python:3.11-slim`, runs as non-root user `appuser` (UID 1001), single worker. Health check every 30s hitting `/health`.

**Hosting:** Render (free tier — sleeps after 15min inactivity, causes cold starts with 30-50s delay).

## Complete File Structure

```
ai-service_TallyFinane/
├── app.py                          # FastAPI app, 3 endpoints, error handling, correlation IDs
├── config.py                       # Settings via pydantic-settings (OpenAI config + service config)
├── schemas.py                      # All Pydantic models (17 models + 5 error codes)
├── orchestrator.py                 # Orchestrator class: phase_a(), phase_b(), mood calc, summary, opening extraction
├── tool_schemas.py                 # 6 tool definitions for AI (what AI can extract from user messages)
├── debug_logger.py                 # Unified debug logger with color-coded output, correlation IDs, timing
├── requirements.txt                # 6 dependencies
├── Dockerfile                      # python:3.11-slim, non-root, single worker, healthcheck
├── prompts/
│   ├── gus_identity.txt            # Gus character definition (name, personality, rules, company)
│   ├── phase_a_system.txt          # Intent analysis prompt (scope circles, deduction rules, slot-filling, categories)
│   ├── phase_b_system.txt          # Response generation prompt (personality rules, tone/mood/intensity, ask_app_info special rules)
│   └── variability_rules.txt       # Anti-repetition rules (opening rotation, emoji variation, style mirroring)
├── .env                            # Environment variables (not committed)
├── CLAUDE.md                       # This file
└── docs/                           # Documentation (kept separately)
    ├── GUIA_ENDPOINTS_Y_TESTING.md
    └── IMPLEMENTATION_SUMMARY.md
```

## Endpoints

### POST /orchestrate

Main endpoint. Receives Phase A or Phase B requests, dispatches to `Orchestrator`.

```python
# Request: Union[OrchestrateRequestPhaseA, OrchestrateRequestPhaseB]
# Response: Union[OrchestrateResponsePhaseA, OrchestrateResponsePhaseB]

# Reads X-Correlation-Id header (or generates uuid[:8])
# Catches APITimeoutError → 503 LLM_TIMEOUT
# Catches Exception → 500 LLM_ERROR
# Catches RequestValidationError → 422 with body logged
```

### GET /health

Returns `{ status: "healthy", model: "gpt-4o-mini", version: "1.0.0" }`.

### GET /

Returns `{ status: "ok", service: "ai-service", version: "1.0.0" }`.

## Configuration (config.py)

```python
class Settings(BaseSettings):
    OPENAI_API_KEY: str                    # Required
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_TIMEOUT: float = 25.0           # Seconds per LLM call
    OPENAI_TEMPERATURE_PHASE_A: float = 0.3  # Deterministic
    OPENAI_TEMPERATURE_PHASE_B: float = 0.7  # Creative
    SERVICE_VERSION: str = "1.0.0"
    MAX_RETRIES: int = 1                   # Retry count for OpenAI calls (total attempts = 2)
    ENDPOINT_TIMEOUT: float = 30.0         # Overall endpoint timeout
```

Loaded from `.env` via pydantic-settings. Singleton: `settings = Settings()`.

## Schemas (schemas.py) — All Pydantic Models

### Supabase Enum Literals

| Python Type | Supabase Enum | Values |
|-------------|---------------|--------|
| `ToneType` | `bot_tone_enum` | neutral, friendly, serious, motivational, strict |
| `MoodType` | `bot_mood_enum` | normal, happy, disappointed, tired, hopeful, frustrated, proud |
| `NotificationLevelType` | `notification_level_enum` | none, light, medium, intense |
| `GoalStatusType` | `goal_status_enum` | in_progress, completed, canceled |
| `PaymentTypeType` | `payment_type_t` | credito, debito |
| `TxSourceType` | `tx_source_t` | manual, chat_intent, import, bank_api, ai_extraction |

### Shared Models

| Model | Maps To | Key Fields |
|-------|---------|------------|
| `Personality` | `personality_snapshot` | tone (ToneType), intensity (float 0-1), mood (Optional[MoodType]) |
| `UserPrefs` | `user_prefs` | notification_level, unified_balance |
| `Budget` | `spending_expectations` | period (str), amount (float), spent (Optional — calculated, not in DB) |
| `Goal` | `goals` | name, target_amount, progress_amount, status |
| `MinimalUserContext` | Aggregated | user_id, personality, prefs, active_budget, goals_summary (List[str]) |
| `ActionResult` | Tool output | ok, action, data, userMessage (slot-fill), errorCode |

### Phase A Models

| Model | Direction | Key Fields |
|-------|-----------|------------|
| `OrchestrateRequestPhaseA` | Backend→AI | phase="A", user_text, user_context, tools, **pending** (PendingSlotContext), **available_categories** (List[str]) |
| `OrchestrateResponsePhaseA` | AI→Backend | phase="A", response_type, tool_call, clarification, direct_reply |
| `PendingSlotContext` | Slot-fill state | tool (str), collected_args (Dict), missing_args (List[str]), asked_at (ISO str) |
| `ToolCall` | Inside response | name, args (Dict) |
| `ToolSchema` | Backend→AI | name, description, parameters (ToolSchemaParameters) |

### Phase B Models

| Model | Direction | Key Fields |
|-------|-----------|------------|
| `OrchestrateRequestPhaseB` | Backend→AI | phase="B", tool_name, action_result, user_context, **runtime_context** (RuntimeContext) |
| `OrchestrateResponsePhaseB` | AI→Backend | phase="B", final_message, **new_summary**, **did_nudge**, **nudge_type** |
| `RuntimeContext` | Extended context | summary, metrics, mood_hint (-1/0/+1), can_nudge, can_budget_warning, last_opening, user_style |
| `UserMetrics` | Engagement data | tx_streak_days, week_tx_count, budget_percent (0.0-1.0+) |
| `UserStyle` | Regex-detected | uses_lucas, uses_chilenismos, emoji_level (none/light/moderate), is_formal |

### Error Codes

```python
ERROR_INVALID_PHASE = "INVALID_PHASE"           # 400 — Phase not "A" or "B"
ERROR_MISSING_USER_TEXT = "MISSING_USER_TEXT"     # 400 — Phase A without user_text
ERROR_MISSING_ACTION_RESULT = "MISSING_ACTION_RESULT"  # 400 — Phase B without action_result
ERROR_LLM_ERROR = "LLM_ERROR"                   # 500 — OpenAI API error
ERROR_LLM_TIMEOUT = "LLM_TIMEOUT"               # 503 — OpenAI timeout (>25s)
```

## Tool Schemas (tool_schemas.py) — 6 Tools

These define what the AI can extract from user messages. The AI service sends these to OpenAI; the NestJS backend has corresponding handlers.

| # | Tool Name | Required Args | Optional Args | Description |
|---|-----------|---------------|---------------|-------------|
| 1 | `ask_app_info` | `userQuestion` | `suggestedTopic` | Answer questions about TallyFinance, features, how-to, limitations |
| 2 | `register_transaction` | `amount`, `category` | `posted_at`, `payment_method`, `description` | Register expense/income |
| 3 | `ask_balance` | — | — | Query user's balance |
| 4 | `ask_budget_status` | — | — | Query active budget status |
| 5 | `ask_goal_status` | — | — | Query savings goals progress |
| 6 | `greeting` | — | — | Handle simple greetings |

**Note:** `unknown` (7th handler in backend) is NOT in tool_schemas — it's a fallback handler in the ToolRegistry, never selected by AI.

### suggestedTopic values for ask_app_info
`capabilities`, `how_to`, `limitations`, `channels`, `getting_started`, `about`, `security`, `pricing`, `other`

### AI Field → Supabase Column Mapping (register_transaction)

| AI Field | Supabase Column | Notes |
|----------|-----------------|-------|
| `amount` | `transactions.amount` | Required, number in CLP |
| `category` | `categories.name` → lookup `category_id` | Backend looks up by name |
| `posted_at` | `transactions.posted_at` | ISO date, default today |
| `payment_method` | `payment_method.name` → lookup `payment_method_id` | Backend uses default if missing |
| `description` | `transactions.description` | Optional |

## Orchestrator (orchestrator.py) — Core Logic

### Class Structure

```python
class Orchestrator:
    def __init__(self, client: OpenAI, config: Settings)
    def load_prompt(self, filename: str) -> str           # Load from prompts/ directory
    def get_gus_identity(self) -> str                     # Cached gus_identity.txt
    def calculate_final_mood(...) -> str                   # Mood ladder calculation
    def _call_openai_json(messages, temperature, cid) -> dict   # JSON mode call with retry
    def _call_openai_text(messages, temperature, cid) -> str    # Text mode call with retry
    def phase_a(user_text, user_context, tools, pending, available_categories, cid) -> OrchestrateResponsePhaseA
    def phase_b(tool_name, action_result, user_context, runtime_context, cid) -> OrchestrateResponsePhaseB
    def _extract_opening(response) -> str | None           # For variability tracking
    def _summarize_action(tool_name, result) -> str         # For conversation memory
```

### OpenAI Call Pattern

Both `_call_openai_json` and `_call_openai_text` follow the same pattern:
1. Start timer
2. Log via `debug_log.openai`
3. Retry loop: `MAX_RETRIES + 1` attempts (default = 2 total)
4. `_call_openai_json`: Uses `response_format={"type": "json_object"}`, parses JSON
5. `_call_openai_text`: Returns raw text content
6. Both use `timeout=OPENAI_TIMEOUT` (25s default)
7. Log performance timing with color coding (<100ms green, <500ms yellow, >500ms red)

### Phase A — Intent Analysis

**Input:** user_text, user_context, tools, pending (slot-fill state), available_categories

**Process:**
1. Load `phase_a_system.txt` template
2. Format user context as JSON
3. Format tool schemas as JSON
4. Format pending context (if multi-turn active): tool, collected_args, missing_args
5. Format available categories list
6. Inject all into system prompt via `.format()`
7. Call OpenAI JSON mode (temp=0.3)
8. Validate `response_type` is one of: `tool_call`, `clarification`, `direct_reply`
9. If invalid response_type → fallback to `clarification`
10. Parse tool_call name + args, or extract clarification/direct_reply text
11. Return `OrchestrateResponsePhaseA`

**Template variables in phase_a_system.txt:**
- `{user_context}` — JSON of MinimalUserContext
- `{tool_schemas}` — JSON array of 6 tool definitions
- `{pending_context}` — Slot-fill state or "Sin contexto pendiente"
- `{available_categories}` — User's category names or "Sin categorías disponibles"

### Phase B — Response Generation

**Input:** tool_name, action_result, user_context, runtime_context

**Process:**
1. Load `phase_b_system.txt` template
2. Load `gus_identity.txt` (cached after first load)
3. Extract personality (tone, intensity, base_mood) or use defaults (neutral, 0.5, normal)
4. Calculate final mood via `calculate_final_mood()`
5. Extract special ask_app_info fields from action_result.data: `appKnowledge`, `aiInstruction`, `userQuestion`
6. Build error info string (if `!ok`)
7. Build variability hint from `last_opening`
8. Build user style context (lucas, chilenismos, emoji level, formal)
9. Build cooldown context (can_nudge, can_budget_warning)
10. Build conversation summary context
11. Compose full system prompt: `gus_identity + phase_b_template + conversation context + style + variability + nudge permissions`
12. Call OpenAI text mode (temp=0.7)
13. Extract opening word for variability tracking
14. Detect nudges via keyword heuristics
15. Generate updated conversation summary via `_summarize_action()`
16. Return `OrchestrateResponsePhaseB` with final_message, new_summary, did_nudge, nudge_type

**Template variables in phase_b_system.txt:**
- `{tone}`, `{intensity}`, `{mood}` — Personality
- `{tool_name}`, `{ok}`, `{data}` — Tool result
- `{user_question}`, `{app_knowledge}`, `{ai_instruction}` — ask_app_info special fields
- `{error_info}` — Error code if failed
- `{active_budget}`, `{goals_summary}` — Financial context

## Mood Calculation System

**Mood ladder** (ordered from worst to best):
```
frustrated → tired → normal → hopeful → happy → proud
   [0]        [1]     [2]       [3]      [4]     [5]
```

**Algorithm:**
1. Map base_mood from `personality_snapshot.mood` to ladder index
   - `disappointed` → maps to `tired` (legacy value handling)
   - Unknown values → default to `normal` (index 2)
2. Apply `mood_hint` from backend: `target_idx = current_idx + mood_hint` (clamped to 0-5)
3. **Override for extreme cases:**
   - `budget_percent > 0.95` → force `frustrated` (index 0)
   - `streak_days >= 7 AND budget_percent < 0.5` → force `proud` (index 5)

**Important:** Mood calculation only adjusts mood. Tone is NEVER modified by this function.

## Nudge Detection

After Phase B generates the final message, simple keyword heuristics detect if a nudge was included:

| Condition | Keywords Checked | nudge_type |
|-----------|-----------------|------------|
| `can_budget_warning AND budget_percent > 0.9` | "presupuesto", "gastado", "límite", "cuidado" | `"budget"` |
| `can_nudge AND streak_days >= 3` | "racha", "días seguidos", "constante" | `"streak"` |

The backend uses `did_nudge` and `nudge_type` to set cooldowns and prevent nudge spam.

## Conversation Summary Generation

`_summarize_action()` generates brief summaries for conversation memory (stored in Redis by backend):

| Tool | Summary Example |
|------|----------------|
| `register_transaction` | "Registró $15,000 en comida." |
| `ask_balance` | "Consultó su balance." |
| `ask_budget_status` | "Revisó estado de presupuesto." |
| `ask_goal_status` | "Consultó progreso de metas." |
| `ask_app_info` | "Preguntó sobre la app." |
| Other | "Usó {tool_name}." |
| `greeting` | (no summary generated — skipped) |
| Failed actions | (no summary — returns empty string) |

Summaries are appended: `"{previous_summary} {new_action_desc}"` and sent back as `new_summary` in the Phase B response.

## Opening Extraction (Variability)

`_extract_opening()` extracts the first word of the response to track for anti-repetition:

**Known openings:** `listo`, `anotado`, `hecho`, `ya quedó`, `perfecto`, `ok`, `buena`, `dale`

1. Check if response starts with a known opening
2. Fallback: regex match for word before comma/period/exclamation
3. Returns the opening or `None`

The backend stores this in `RuntimeContext.last_opening` and sends it back on the next request so the variability rules can prevent repetition.

## Prompt System (4 Files)

### gus_identity.txt — Character Definition
- **Name:** Gus (full name "Gustavo" — Breaking Bad easter egg, used rarely)
- **Role:** Personal finance assistant, "hired" by user
- **Personality:** Serious but kind, professional, direct, slightly sarcastic
- **Origin:** Chilean, travels the world helping people save
- **Default currency:** CLP
- **Critical rules:**
  - NEVER say he's a bot/AI/program — present as "Gus, asistente financiero"
  - Technical details are "propiedad intelectual de TallyFinance SPA"
  - Use Chilean Spanish when user does
  - Understand "lucas" = x1000 CLP

### phase_a_system.txt — Intent Analysis Prompt
- **3-circle scope system:**
  - Circle 1 (always respond): TallyFinance, Gus identity, transactions, budgets, goals
  - Circle 2 (respond with judgment): Personal finance, Chilean economy, savings tips
  - Circle 3 (redirect politely): Science, history, math, programming, politics → short humorous redirect + mention what Gus CAN do
- **Deduction rules:** "DEDUCE ANTES DE PREGUNTAR" — infer category from context before asking
  - "restaurante + filete" → Alimentación
  - "uber al trabajo" → Transporte
  - "cuenta del doctor" → Salud
  - "15 lucas en la pelu" → Personal
- **Slot-filling instructions:** Merge collected_args with new user input, never re-ask collected info
- **Category matching:** Must use EXACT category from available_categories list; return `_no_match` if nothing fits
- **Strict JSON format:** response_type must be `tool_call`, `clarification`, or `direct_reply` (never tool name)

### phase_b_system.txt — Response Generation Prompt
- Personalization rules per tone (neutral/friendly/serious/motivational/strict)
- Intensity rules (>0.7 expressive, <0.3 sober)
- Mood behavior rules (7 moods)
- CLP formatting ($15.000)
- Max 2-3 sentences
- Never mention tables, databases, backend, or internal processes
- Special ask_app_info rules: use appKnowledge as source of truth, mention comingSoon features, be honest about limitations

### variability_rules.txt — Anti-Repetition Guidelines
- Don't repeat same opening word consecutively
- Opening options: Listo, Anotado, Hecho, Ya quedó, Perfecto, Ok, Dale
- Max 1 emoji per response; don't repeat same emoji
- Mirror user's style (lucas, formal, emoji usage)
- Vary sentence structure between messages

## Debug Logger (debug_logger.py)

Unified logging system matching the NestJS backend's visual language.

### Log Methods

| Method | Emoji | Tag | Level | Purpose |
|--------|-------|-----|-------|---------|
| `recv()` | 📥 | RECV | info | Incoming request |
| `send()` | 📤 | SEND | info | Outgoing response |
| `phase_a()` | 🔄 | PHASE-A | info | Phase A processing |
| `phase_b()` | 🔄 | PHASE-B | info | Phase B processing |
| `tool()` | 🔧 | TOOL | info | Tool-related event |
| `state()` | 💾 | STATE | debug | State changes |
| `perf()` | ⚡ | PERF | info | Performance timing (color: <100ms green, <500ms yellow, >500ms red) |
| `ok()` | ✅ | OK | info | Success |
| `err()` | ❌ | ERR | error | Error |
| `warn()` | ⚠️ | WARN | warn | Warning |
| `link()` | 🔗 | LINK | info | External service call (OpenAI) |
| `match()` | 🎯 | MATCH | debug | Pattern matching |
| `ai()` | 🧠 | AI | info | AI/LLM operations |
| `prompt()` | 📝 | PROMPT | debug | Prompt construction |
| `mood()` | 😊 | MOOD | info | Mood calculation |

### Configuration

| Env Var | Default | Purpose |
|---------|---------|---------|
| `DEBUG_LOGS` | `1` | Enable/disable (`0` to disable) |
| `DEBUG_LEVEL` | `debug` | Min level: debug, info, warn, error |
| `DEBUG_TIMESTAMP` | `1` | Show timestamps |

### Singleton Loggers

```python
debug_log.orchestrator  # Used in orchestrator.py
debug_log.openai        # Used for OpenAI calls
debug_log.app           # Used in app.py
debug_log.mood          # Available for mood-related logging
```

### Utility Methods

- `child(sub_context)` — Create child logger with sub-context
- `separator(cid)` — Visual separator line (60 dashes)
- `timer(label, cid)` — Start timer, returns `done()` function that logs elapsed time

## Environment Variables

```bash
# Required
OPENAI_API_KEY=sk-proj-xxx        # OpenAI API key

# Optional (with defaults)
OPENAI_MODEL=gpt-4o-mini          # LLM model
OPENAI_TIMEOUT=25.0               # Seconds per LLM call
OPENAI_TEMPERATURE_PHASE_A=0.3    # Phase A temperature (deterministic)
OPENAI_TEMPERATURE_PHASE_B=0.7    # Phase B temperature (creative)
SERVICE_VERSION=1.0.0              # Reported in /health
MAX_RETRIES=1                      # OpenAI retry count (total attempts = MAX_RETRIES + 1)
ENDPOINT_TIMEOUT=30.0              # Overall endpoint timeout

# Debug logging
DEBUG_LOGS=1                       # Enable debug logs (0 to disable)
DEBUG_LEVEL=debug                  # Min log level: debug, info, warn, error
DEBUG_TIMESTAMP=1                  # Show timestamps in logs
```

## Integration with NestJS Backend

### Request Flow

```
Backend                              AI Service
  │                                     │
  ├─── POST /orchestrate ──────────────►│
  │    phase: "A"                       │
  │    user_text, user_context,         │──► OpenAI (JSON mode, temp=0.3)
  │    tools, pending, categories       │
  │◄── response_type: tool_call ────────│
  │    tool_call: { name, args }        │
  │                                     │
  │    [Backend executes tool handler]  │
  │                                     │
  ├─── POST /orchestrate ──────────────►│
  │    phase: "B"                       │
  │    tool_name, action_result,        │──► OpenAI (text mode, temp=0.7)
  │    user_context, runtime_context    │
  │◄── final_message ──────────────────│
  │    new_summary, did_nudge           │
  │                                     │
```

### What Backend Sends (Phase A)

- `user_text` — Raw user message
- `user_context` — MinimalUserContext (personality, prefs, budget, goals)
- `tools` — 6 tool schemas (from backend's ToolRegistry)
- `pending` — PendingSlotContext if multi-turn active (from Redis `conv:{userId}:pending`)
- `available_categories` — User's actual category names (from Supabase)

### What Backend Sends (Phase B)

- `tool_name` — Which tool was executed
- `action_result` — Tool handler output (ok, action, data, userMessage, errorCode)
- `user_context` — Same as Phase A
- `runtime_context` — RuntimeContext with summary, metrics, mood_hint, cooldowns, last_opening, user_style

### What Backend Receives Back

**From Phase A:** `response_type` + `tool_call`/`clarification`/`direct_reply`
**From Phase B:** `final_message` + `new_summary` (save to Redis) + `did_nudge`/`nudge_type` (set cooldowns)

### Correlation IDs

Backend sends `X-Correlation-Id` header. AI service uses it in all logs. If not provided, generates `uuid[:8]`.

## Personality System (Fixed)

Gus's personality is now **consistently applied to ALL responses**, not just `ask_app_info`:

- `gus_identity.txt` is loaded once (cached) and prepended to every Phase B system prompt
- Dynamic personality (tone, intensity, mood) comes from `personality_snapshot` table via `user_context`
- Mood is dynamically calculated per request via `calculate_final_mood()`
- User style is mirrored via `RuntimeContext.user_style`
- Opening rotation prevents repetitive responses

## NUNCA hacer

- **NEVER** access the database from the AI service
- **NEVER** let the AI return a tool name as `response_type` (must be `tool_call`/`clarification`/`direct_reply`)
- **NEVER** modify tone in mood calculation (only mood changes)
- **NEVER** invent categories not in `available_categories` (use `_no_match` instead)
- **NEVER** have Gus say he's a bot, AI, or program
- **NEVER** expose internal technical details (tables, endpoints, backend architecture)
