# ask_app_info — Complete Handler Reference

> **File:** `tally-combined/backend-API_TallyFinance/src/bot/tools/handlers/ask-app-info.tool-handler.ts` (363 lines)
> **Requiere contexto:** No (`requiresContext = false`, line 70)
> **Last updated:** 2026-02-16

---

## Table of Contents

1. [Identity & Registration](#identity--registration)
2. [Schema (sent to AI)](#schema-sent-to-ai)
3. [Args Received at execute()](#args-received-at-execute)
4. [Pre-execution: Guardrails](#pre-execution-guardrails)
5. [Execution Flow — Single Step](#execution-flow--single-step)
6. [Knowledge Base Structure](#knowledge-base-structure)
7. [All Possible Return Paths (1 total)](#all-possible-return-paths-1-total)
8. [DB Tables Accessed](#db-tables-accessed)
9. [Integration with BotService](#integration-with-botservice)
10. [Phase A Routing Rules (3-Circle Scope)](#phase-a-routing-rules-3-circle-scope)
11. [Phase B Behavior](#phase-b-behavior)
12. [Message Flows](#message-flows)
13. [Key Design Decisions](#key-design-decisions)
14. [Bug Fixes Applied](#bug-fixes-applied)

---

## Identity & Registration

```typescript
// line 22-23
export class AskAppInfoToolHandler implements ToolHandler {
  readonly name = 'ask_app_info';
```

- Implements `ToolHandler` interface (from `tool-handler.interface.ts`)
- Registered in `ToolRegistry` constructor alongside the other 6 handlers
- **No constructor** — no dependencies injected. No `SupabaseClient`, no services.
- **`requiresContext = false`** (line 70) — BotService does NOT inject `_categories` or load user context for this handler.

---

## Schema (sent to AI)

Defined at lines 25-68. This schema is sent to the AI service as part of `tools[]` in every Phase A request.

```typescript
readonly schema: ToolSchema = {
  name: 'ask_app_info',
  description: `Responde CUALQUIER pregunta sobre TallyFinance, el bot, sus funcionalidades,
    cómo usarlo, limitaciones, o información general de la aplicación.

    USAR ESTA TOOL CUANDO EL USUARIO:
    - Pregunte qué puede hacer el bot (¿Qué haces? ¿Para qué sirves?)
    - Quiera saber cómo usar alguna función (¿Cómo registro un gasto?)
    - Pregunte sobre la app en general (¿Qué es TallyFinance?)
    - Pida ayuda o guía (Ayuda, Help, ¿Cómo empiezo?)
    - Tenga curiosidad sobre funcionalidades (¿Puedes hacer X?)
    - Pregunte sobre limitaciones (¿Por qué no puedes hacer X?)
    - Quiera saber sobre canales (¿Funciona en WhatsApp?)
    - Cualquier pregunta META sobre el bot/app

    NO usar para:
    - Registrar gastos (usar register_transaction)
    - Consultar presupuesto real (usar ask_budget_status)
    - Ver metas reales (usar ask_goal_status)
    - Saludos simples sin pregunta (usar greeting)`,
  parameters: {
    type: 'object',
    properties: {
      userQuestion: {
        type: 'string',
        description: 'La pregunta original del usuario, tal como la formuló.',
      },
      suggestedTopic: {
        type: 'string',
        description: `Tema que PARECE relacionado (es solo una pista, la IA puede ignorarlo):
          - "capabilities": funcionalidades generales
          - "how_to": cómo usar algo específico
          - "limitations": qué NO puede hacer
          - "channels": Telegram/WhatsApp
          - "getting_started": primeros pasos
          - "about": qué es TallyFinance
          - "security": seguridad y privacidad
          - "pricing": precios y planes
          - "other": cualquier otra pregunta`,
      },
    },
    required: ['userQuestion'],
  },
};
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `userQuestion` | `string` | Yes | The user's original question, as formulated |
| `suggestedTopic` | `string` | No | Hint about the topic (AI can use or ignore). 9 enum values. |

### suggestedTopic Values

| Value | When |
|-------|------|
| `capabilities` | "¿Qué puedes hacer?", "¿Para qué sirves?" |
| `how_to` | "¿Cómo registro un gasto?", "¿Cómo empiezo?" |
| `limitations` | "¿Puedes ver mi banco?", "¿Por qué no puedes...?" |
| `channels` | "¿Funciona en WhatsApp?", "¿En qué apps estás?" |
| `getting_started` | "Ayuda", "¿Cómo empiezo?", "Help" |
| `about` | "¿Qué es TallyFinance?", "¿Quién eres?" |
| `security` | "¿Es seguro?", "¿Mis datos están protegidos?" |
| `pricing` | "¿Es gratis?", "¿Cuánto cuesta?" |
| `other` | Anything else, default fallback |

---

## Args Received at execute()

**Signature** (lines 333-336):

```typescript
execute(
  _userId: string,          // unused — no DB queries
  msg: DomainMessage,       // used as fallback for userQuestion
  args: Record<string, unknown>,
): Promise<ActionResult>
```

**Fields extracted** (lines 339-341):

```typescript
const userQuestion = (args.userQuestion as string) || msg.text || 'pregunta general';
const suggestedTopic = (args.suggestedTopic as string) || 'other';
```

### Three-level fallback for userQuestion

1. `args.userQuestion` — from Phase A (AI extraction)
2. `msg.text` — raw message text (fallback if AI omits userQuestion)
3. `'pregunta general'` — hardcoded default (should never happen in practice)

### suggestedTopic default

If AI doesn't provide `suggestedTopic`, defaults to `'other'`. Guardrails sanitizer also defaults to `'other'` if falsy.

---

## Pre-execution: Guardrails

Before `execute()` is called, `GuardrailsService.validate()` runs validation and sanitization.

### Validation rules for ask_app_info

| Field | Validation | Rejects if... |
|-------|-----------|---------------|
| `userQuestion` | Optional in guardrails. `undefined OR (typeof string && length > 0 && length < 1000)` | Non-string, empty string, >= 1000 chars |
| `suggestedTopic` | Optional. `undefined OR (typeof string && length < 50)` | Non-string, >= 50 chars |

**Note:** `userQuestion` is `required` in the schema (sent to AI), but the guardrails validator treats it as optional. This is fine because:
1. Phase A almost always provides it (required in schema)
2. If missing, the handler falls back to `msg.text` (line 339)
3. If both missing, falls back to `'pregunta general'`

### Sanitization (applied after validation passes)

| Field | Sanitizer | Effect |
|-------|-----------|--------|
| `userQuestion` | `v ? String(v).trim() : undefined` | Trimmed, or removed if falsy |
| `suggestedTopic` | `v ? String(v).trim().toLowerCase() : 'other'` | Trimmed, lowercased, defaults to 'other' |

### What happens when Guardrails rejects

Same as all tools — BotService returns:
```
"No pude procesar tu solicitud. ¿Podrías intentar de nuevo con más detalle?"
```
Handler's `execute()` is **never called**.

In practice, guardrails rejection is extremely rare for ask_app_info because:
- `userQuestion` allows undefined (handler has fallback)
- `suggestedTopic` allows undefined (defaults to 'other')
- The only rejection scenario is a string > 1000 chars for userQuestion or > 50 chars for suggestedTopic

---

## Execution Flow — Single Step

The handler's execute() is the simplest of all 7 handlers. It does **zero processing** — no DB queries, no matching, no slot-filling.

```typescript
execute(_userId, msg, args): Promise<ActionResult> {
  const userQuestion = (args.userQuestion as string) || msg.text || 'pregunta general';
  const suggestedTopic = (args.suggestedTopic as string) || 'other';

  return Promise.resolve({
    ok: true,
    action: 'ask_app_info',
    data: {
      userQuestion,
      suggestedTopic,
      appKnowledge: this.appKnowledge,
      aiInstruction: `Responde la pregunta del usuario usando el conocimiento de la app. La pregunta fue: "${userQuestion}"`,
    },
  });
}
```

**Key:** The handler passes the **FULL** `appKnowledge` object (all sections) to Phase B, regardless of `suggestedTopic`. Phase B is responsible for selecting relevant information and composing the response.

---

## Knowledge Base Structure

The `appKnowledge` object (lines 78-331) contains all factual information about TallyFinance. It's a static TypeScript object — **never changes at runtime**.

### Sections

| Section | Key | Lines | Content |
|---------|-----|-------|---------|
| Identity | `identity` | 80-116 | Gus's name, personality, origin, not-a-bot rules, creator info |
| Channels | `channels` | 118-128 | Telegram/WhatsApp, linking, limitations |
| Current Features | `currentFeatures` | 130-203 | 3 features: register_transaction, budget_status, goal_status |
| Coming Soon | `comingSoon` | 205-235 | 5 planned features with ETAs |
| Limitations | `limitations` | 237-253 | General + current version limitations |
| Security | `security` | 255-264 | Privacy, encryption, bank access, data ownership |
| Getting Started | `gettingStarted` | 266-286 | 5 steps + first things to do + tips |
| FAQ | `faq` | 288-314 | 6 Q&A pairs |
| Conversation Style | `conversationStyle` | 316-331 | Do's and don'ts for users |

### Identity Section (detail)

```typescript
identity: {
  name: 'Gus',
  nameExplanation: 'Siempre me llamo Gus, así me conocen.',
  lastName: 'No tengo apellido. Suelen llamarme Gus, solo Gus.',
  easterEgg: {
    trigger: 'Si preguntan específicamente si Gus es apodo o cuál es tu nombre completo/real',
    response: 'Mi nombre es Gustavo, pero puedes llamarme Gus.',
    note: 'Usar MUY pocas veces, es un easter egg de Breaking Bad',
  },
  whoAmI: 'Soy Gus, tu asistente financiero personal...',
  personality: 'Serio pero amable. No soy excesivamente alegre...',
  expertise: 'Experto en finanzas personales, contabilidad básica...',
  origin: 'Soy chileno de origen, pero recorro el mundo...',
  currency: 'CLP (pesos chilenos)',
  notABot: 'No respondo que soy un bot o IA...',
  ifAskedIfBot: 'Ante preguntas de si soy bot/IA/real, respondo presentándome como Gus...',
  creator: 'La información sobre cómo fui creado... propiedad intelectual de TallyFinance SPA.',
  company: 'TallyFinance SPA',
}
```

### Current Features (detail)

Each feature has: `id`, `name`, `description`, `howToUse[]`, `examples[]`, `tips[]`, `limitations[]`.

| Feature | ID | Examples |
|---------|-----|---------|
| Registrar gastos e ingresos | `register_transaction` | "Gasté 15 lucas en comida", "Pagué 50.000 en el super" |
| Consultar presupuesto | `budget_status` | "¿Cómo va mi presupuesto?", "¿Cuánto me queda este mes?" |
| Ver metas de ahorro | `goal_status` | "¿Cómo van mis metas?", "¿Cuánto llevo ahorrado?" |

### Coming Soon (5 planned features)

| Feature | ETA |
|---------|-----|
| Consulta de saldos | Próximas semanas |
| Recordatorios inteligentes | Próximamente |
| Reportes y análisis | Próximamente |
| Gastos recurrentes | En planificación |
| Exportar datos | En planificación |

### Limitations

**General (permanent):**
- No acceso directo a cuentas bancarias (seguridad)
- No transferencias ni pagos
- No consejos de inversión específicos
- No info de mercados en tiempo real

**Current version (temporary):**
- No editar/eliminar gastos (app web) — *Note: this is outdated; manage_transactions now handles this*
- No crear presupuestos/metas (app web)
- No gráficos ni reportes visuales
- No memoria de conversaciones entre sesiones

---

## All Possible Return Paths (1 total)

| # | Line | `ok` | Has `userMessage` | Has `pending` | Has `data` | Triggers Phase B? | Scenario |
|---|------|------|-------------------|---------------|-----------|-------------------|----------|
| 1 | 345-361 | `true` | **No** | No | **Yes** | **Yes** | Always — returns knowledge base |

**This handler always succeeds.** There are no error paths, no slot-filling, no DB failures. It always returns `ok: true` with the full `appKnowledge` object.

### Return data structure

```typescript
{
  ok: true,
  action: 'ask_app_info',
  data: {
    userQuestion: string,     // The original question
    suggestedTopic: string,   // Topic hint (or 'other')
    appKnowledge: { ... },    // Full static knowledge base (all sections)
    aiInstruction: string,    // "Responde la pregunta del usuario..."
  },
}
```

---

## DB Tables Accessed

**None.** This handler makes zero database queries. All information is static, hardcoded in the `appKnowledge` object.

---

## Integration with BotService

### Before handler execution

1. **Context loading**: BotService loads context, but since `requiresContext = false`, the handler doesn't use it.
2. **Phase A**: AI decides intent → if `ask_app_info`, returns `tool_call: { name: 'ask_app_info', args: { userQuestion, suggestedTopic } }`.
3. **Guardrails**: Validates and sanitizes args (very permissive for this tool).
4. **Category injection**: **Skipped** — BotService only injects `_categories` for `register_transaction` and `manage_transactions`.

### After handler execution

5. **Metrics recording**: **Skipped** — BotService only records metrics for `register_transaction`.
6. **Slot-fill handling**: **Skipped** — handler never returns `userMessage` or `pending`.
7. **Phase B**: Always reached. Phase B receives the full `data` object including `appKnowledge`.
8. **Pending clear**: If a pending slot-fill exists from a different tool (e.g., `register_transaction`), it is **NOT cleared** (because `toolCall.name !== pending.tool`). This is the bug fix behavior from 2026-02-13.

### Pending state interaction

Since `ask_app_info` never returns `pending` and never sets `userMessage`, it always proceeds to Phase B. Critically, it does **not** interfere with existing pending state from other tools:

```
User: "compré una bebida"       → register_transaction → pending saved (missing amount)
User: "¿qué puedes hacer?"     → ask_app_info → Phase B answers → pending NOT cleared ✓
User: "2000"                    → register_transaction → completes with pending context
```

---

## Phase A Routing Rules (3-Circle Scope)

The Phase A prompt (`phase_a_system.txt`) defines when to use `ask_app_info` vs other tools:

### Circle 1 — Core (always ask_app_info)

```
- Preguntas sobre TallyFinance, Gus, funcionalidades del bot
- Cómo usar el bot, ayuda, limitaciones
- CAPACIDADES Y LIMITACIONES:
  * "¿Puedo registrar en dólares?" → ask_app_info
  * "¿Aceptan tarjeta de crédito?" → ask_app_info
  * "¿Puedo exportar mis datos?" → ask_app_info
  * "¿Funciona con WhatsApp?" → ask_app_info
- IDENTIDAD DEL BOT:
  * "¿Cómo te llamas?" → ask_app_info
  * "¿Quién eres?" → ask_app_info
  * "¿Eres un bot/IA?" → ask_app_info
  * "¿De dónde eres?" → ask_app_info
```

### Circle 2 — Related finance (use ask_app_info with judgment)

```
- Finanzas personales, ahorro, deudas, presupuestos
- Economía Chile (inflación, UF, IPC, dólar)
- Tips financieros básicos, educación financiera
- Conceptos de bancos, tarjetas, cuentas
→ usa ask_app_info si crees que puedes aportar algo útil
```

### Circle 3 — Out of domain (use direct_reply, NOT ask_app_info)

```
- Ciencias, historia, matemáticas puras
- Programación, tecnología no financiera
- Política, religión, temas controversiales
→ usa direct_reply con mensaje corto, con personalidad y humor sutil
```

**Key routing distinction:** Circle 2 → `ask_app_info`. Circle 3 → `direct_reply`.

### Routing conflicts with other tools

| User message | Correct tool | NOT ask_app_info because... |
|-------------|-------------|----------------------------|
| "gasté 5000 en comida" | `register_transaction` | Action, not question |
| "cuánto llevo gastado?" | `ask_balance` | Real data query |
| "cómo va mi presupuesto?" | `ask_budget_status` | Real data query |
| "cómo van mis metas?" | `ask_goal_status` | Real data query |
| "hola" | `greeting` (direct_reply) | Simple greeting, no question |

---

## Phase B Behavior

Phase B receives the full `ActionResult.data` object and generates a response using Gus's personality (from `gus_identity.txt`).

### What Phase B has access to

```typescript
{
  userQuestion: "¿Qué puedes hacer?",
  suggestedTopic: "capabilities",
  appKnowledge: { /* all 9 sections */ },
  aiInstruction: "Responde la pregunta del usuario..."
}
```

### Phase B responsibilities

1. **Select relevant knowledge** — use `suggestedTopic` as a hint but can pull from any section
2. **Answer in Gus's personality** — serio pero amable, professional, Chilean
3. **Never reveal being a bot/AI** — if asked, present as Gus, asistente financiero
4. **Use Easter egg sparingly** — "Gustavo" only when specifically asked about full/real name
5. **Redirect Circle 3 topics** — Phase A should have caught this, but if not, redirect amably

### Gus Identity Rules (enforced by Phase B)

| Rule | Behavior |
|------|----------|
| Name | Always "Gus". Never "bot", "IA", "programa" |
| Full name | "Gustavo" only when directly asked (Easter egg) |
| Creator | "Propiedad intelectual de TallyFinance SPA" — no technical details |
| Personality | Serious but kind. Not overly cheerful. Professional and direct. |
| Origin | Chilean. Understands CLP, "lucas", chilenismos. |

---

## Message Flows

### Happy path — direct question about capabilities

```
User: "¿Qué puedes hacer?"
  → Phase A: tool_call { name: "ask_app_info", args: { userQuestion: "¿Qué puedes hacer?", suggestedTopic: "capabilities" } }
  → Guardrails: passes (string, < 1000 chars)
  → Handler: returns { ok: true, data: { userQuestion, suggestedTopic, appKnowledge, aiInstruction } }
  → Phase B: generates response listing features in Gus's personality
  → Reply: "Puedo ayudarte con 3 cosas principales: registrar tus gastos..."
```

### Identity question

```
User: "¿Cómo te llamas?"
  → Phase A: tool_call { name: "ask_app_info", args: { userQuestion: "¿Cómo te llamas?", suggestedTopic: "about" } }
  → Handler: returns with appKnowledge.identity
  → Phase B: uses identity section → "Soy Gus, tu asistente financiero personal..."
```

### Easter egg trigger

```
User: "¿Gus es tu nombre real o un apodo?"
  → Phase A: ask_app_info
  → Handler: returns with appKnowledge.identity.easterEgg
  → Phase B: may use easterEgg.response → "Mi nombre es Gustavo, pero puedes llamarme Gus."
```

### "Are you a bot?" handling

```
User: "¿Eres un bot?"
  → Phase A: ask_app_info (Circle 1, identity question)
  → Handler: returns with appKnowledge.identity.notABot
  → Phase B: presents as Gus without confirming or denying being a bot
  → Reply: "Soy Gus, asistente financiero de TallyFinance. ¿En qué te puedo ayudar?"
```

### Circle 2 — related finance question

```
User: "¿Qué es la UF?"
  → Phase A: ask_app_info (Circle 2, related finance)
  → Handler: returns knowledge base (no UF section, but Phase B uses LLM knowledge)
  → Phase B: answers with general finance knowledge, Gus personality
  → Reply: "La UF es una unidad de medida que se reajusta según la inflación..."
```

### Circle 3 — out of domain (should NOT reach handler)

```
User: "¿Cuál es la capital de Francia?"
  → Phase A: direct_reply (Circle 3, out of domain)
  → NO handler called. Bot returns direct_reply.
  → Reply: "Mi fuerte es la plata, no la geografía. ¿Te ayudo con algún gasto?"
```

### During pending slot-fill

```
User: "compré una bebida"
  → register_transaction → pending saved (missing amount)
  → Reply: "¿Cuánto fue?"

User: "¿puedo registrar en dólares?"
  → Phase A: ask_app_info (correctly identified as meta-question)
  → Handler: returns knowledge base
  → Phase B: answers about CLP limitation
  → Pending NOT cleared (toolCall.name='ask_app_info' ≠ pending.tool='register_transaction')
  → Reply: "Por ahora solo trabajo con pesos chilenos (CLP)..."

User: "2000"
  → Phase A sees pending context → register_transaction {amount: 2000, category from pending}
  → Completes transaction ✓
```

---

## Key Design Decisions

1. **Handler is stateless** — no constructor, no dependencies, no DB. All knowledge is a static TypeScript object compiled into the build.

2. **Full knowledge base always sent** — the handler does not filter by `suggestedTopic`. Phase B receives ALL sections and picks what's relevant. This allows creative, cross-topic answers.

3. **`requiresContext = false`** — unlike `register_transaction` or `ask_balance`, this handler doesn't need user categories, budget, or profile data. It only provides generic app info.

4. **Personality separation** — the handler provides **factual** knowledge only. Gus's **personality** (tone, style, humor) comes from `gus_identity.txt` in the AI service. This separation prevents the handler from needing AI service access.

5. **suggestedTopic is a hint** — the AI can ignore it. Phase B has the full knowledge base and can combine information from multiple sections. For example, a question about "¿cómo registro un gasto desde WhatsApp?" touches both `channels` and `currentFeatures`.

6. **Circle 3 bypass** — out-of-domain questions (science, history, politics) are handled by Phase A as `direct_reply`, never reaching this handler. This keeps the handler focused on app-related questions.

7. **Identity protection** — the knowledge base has explicit rules for Gus never confirming he's a bot/AI, and creator info being "propiedad intelectual". These are factual constraints Phase B must respect.

8. **Stale limitations** — the `currentVersion` limitations mention "no editar/eliminar gastos" but `manage_transactions` now handles this. The knowledge base needs updating but doesn't cause errors (Phase B may give slightly outdated info).

---

## Bug Fixes Applied

### Identity routing fix (Phase A prompt)

**Problem:** Phase A didn't recognize identity questions ("¿Cómo te llamas?", "¿Quién eres?") as `ask_app_info`. It treated them as Circle 3 (out of domain) and returned `direct_reply`.

**Fix:** Added explicit Circle 1 identity section in `phase_a_system.txt` with example mappings:
```
- IDENTIDAD DEL BOT (IMPORTANTE - usar ask_app_info):
  * "¿Cómo te llamas?" → ask_app_info
  * "¿Quién eres?" → ask_app_info
  * "¿Eres un bot/IA?" → ask_app_info
```

**Files modified:**
- `ai-service_TallyFinane/prompts/phase_a_system.txt`
- `backend-API_TallyFinance/src/bot/tools/handlers/ask-app-info.tool-handler.ts` (added identity section)
- `ai-service_TallyFinane/prompts/gus_identity.txt` (updated personality rules)
