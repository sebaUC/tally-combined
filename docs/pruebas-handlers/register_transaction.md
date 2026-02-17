# register_transaction — Complete Handler Reference

> **File:** `tally-combined/backend-API_TallyFinance/src/bot/tools/handlers/register-transaction.tool-handler.ts` (299 lines)
> **Requiere contexto:** Sí (`requiresContext = true`, line 49)
> **Last updated:** 2026-02-13

---

## Table of Contents

1. [Identity & Registration](#identity--registration)
2. [Schema (sent to AI)](#schema-sent-to-ai)
3. [Args Received at execute()](#args-received-at-execute)
4. [Pre-execution: Guardrails](#pre-execution-guardrails)
5. [Execution Flow — 5 Steps](#execution-flow--5-steps)
6. [findBestCategoryMatch() — 3-Tier Strategy](#findbestcategorymatch--3-tier-strategy)
7. [isSimilarString() — Typo Tolerance](#issimilarstring--typo-tolerance)
8. [All Possible Return Paths (9 total)](#all-possible-return-paths-9-total)
9. [DB Tables Accessed](#db-tables-accessed)
10. [Integration with BotService](#integration-with-botservice)
11. [Slot-Fill Lifecycle (end to end)](#slot-fill-lifecycle-end-to-end)
12. [Message Flows](#message-flows)
13. [Key Design Decisions](#key-design-decisions)
14. [Phase A Prompt Rules (amount guardrail)](#phase-a-prompt-rules-amount-guardrail)
15. [Bug Fixes Applied](#bug-fixes-applied)

---

## Identity & Registration

```typescript
// line 17-18
export class RegisterTransactionToolHandler implements ToolHandler {
  readonly name = 'register_transaction';
```

- Implements `ToolHandler` interface (from `tool-handler.interface.ts`)
- Registered in `ToolRegistry` constructor alongside the other 6 handlers
- Constructor (line 51): receives `SupabaseClient` via dependency injection from `ToolRegistry`

---

## Schema (sent to AI)

Defined at lines 20-47. This schema is sent to the AI service as part of `tools[]` in every Phase A request. It tells the AI what fields it can extract from user messages.

```typescript
readonly schema: ToolSchema = {
  name: 'register_transaction',
  description: 'Registra un gasto o ingreso del usuario en su cuenta',
  parameters: {
    type: 'object',
    properties: {
      amount: {
        type: 'number',
        description: 'Monto de la transacción en CLP (pesos chilenos)',
      },
      category: {
        type: 'string',
        description: 'Nombre de la categoría (ej: comida, transporte, entretenimiento)',
      },
      posted_at: {
        type: 'string',
        description: 'Fecha en formato ISO-8601 (YYYY-MM-DD o ISO completo). Si no se especifica, se usa la fecha actual',
      },
      description: {
        type: 'string',
        description: 'Descripción opcional del gasto',
      },
    },
    required: ['amount', 'category'],
  },
};
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `amount` | `number` | Yes | Monto en CLP (pesos chilenos) |
| `category` | `string` | Yes | Nombre de la categoría |
| `posted_at` | `string` | No | Fecha ISO-8601, defaults to today if not specified |
| `description` | `string` | No | Descripción opcional del gasto |

---

## Args Received at execute()

**Signature** (lines 53-57):

```typescript
async execute(
  userId: string,
  _msg: DomainMessage,    // message object — unused by this handler
  args: Record<string, unknown>,
): Promise<ActionResult>
```

**Destructured fields** (lines 58-74):

```typescript
const {
  amount,              // number | undefined — from AI Phase A
  category,            // string | undefined — from AI Phase A
  date,                // string | undefined — legacy alias for posted_at
  posted_at,           // string | undefined — from AI Phase A
  description,         // string | undefined — from AI Phase A
  payment_method_id,   // string | undefined — not in schema, accepted if present
  _categories,         // Array<{id, name}> | undefined — injected by BotService
} = args;
```

### Three sources for args

1. **From Phase A (AI output):** `amount`, `category`, `posted_at`, `description` — the AI extracts these from the user's natural language message. When slot-filling is active, Phase A merges `pending.collected_args` with the new user input before returning the tool_call.

2. **Injected by BotService** (bot.service.ts lines 298-305): `_categories` — `Array<{id, name}>` from `context.categories`. Injected at runtime to avoid a redundant DB query. Only injected when `context.categories?.length` is truthy and `toolCall.name === 'register_transaction'`.

3. **Legacy/undocumented fields:**
   - `date` (line 61) — accepted as fallback for `posted_at` at line 111. Not in the schema, but tolerated if AI or stub mode sends it.
   - `payment_method_id` (line 64) — never sent by AI (not in schema), but the code accepts it if somehow present. Could come from future integrations or tests.

---

## Pre-execution: Guardrails

Before `execute()` is called, `GuardrailsService.validate()` (guardrails.service.ts lines 21-35) runs validation and sanitization on the AI's tool_call output.

### Validation rules for register_transaction

| Field | Validation | Rejects if... |
|-------|-----------|---------------|
| `amount` | **Required.** `typeof number && > 0 && < 100,000,000` | missing, null, 0, negative, >= 100M |
| `category` | **Required.** `typeof string && length > 0 && length < 100` | missing, null, empty string, >= 100 chars |
| `description` | Optional. `undefined OR (typeof string && length < 500)` | string >= 500 chars |

### Sanitization (applied after validation passes)

| Field | Sanitizer | Effect |
|-------|-----------|--------|
| `amount` | `Math.round(v * 100) / 100` | Rounds to 2 decimal places |
| `category` | `String(v).trim().toLowerCase()` | Trimmed and lowercased |
| `description` | `v ? String(v).trim() : undefined` | Trimmed, or removed if falsy |

### What happens when Guardrails rejects

If any validation fails, BotService (bot.service.ts lines 274-291) returns a generic message to the user:

```
"No pude procesar tu solicitud. ¿Podrías intentar de nuevo con más detalle?"
```

The handler's `execute()` is **never called** in this case.

### Important edge cases

- **AI sends `amount: 0`** → Guardrails rejects (`0 > 0` is false). Handler slot-fill at line 77 never reached.
- **AI sends `amount: null`** → Guardrails rejects (required field missing).
- **AI sends no `amount` at all** → Guardrails rejects (required field missing).
- **Handler's own amount check (line 77)** is a second safety net. It only triggers if Guardrails is somehow bypassed — which CAN happen in **stub mode** (`OrchestratorClient.stubPhaseA()`) where the stub builds a tool_call that may go through a different validation path.

---

## Execution Flow — 5 Steps

### Step 1: Slot-fill check for missing amount (lines 76-91)

```typescript
if (amount === undefined || amount === null) {
  return {
    ok: true,
    action: 'register_transaction',
    userMessage: '¿Cuánto fue el gasto exactamente?',
    pending: {
      collectedArgs: {
        ...(category ? { category } : {}),
        ...(description ? { description } : {}),
        ...(posted_at ? { posted_at } : {}),
      },
      missingArgs: ['amount'],
    },
  };
}
```

- Returns `ok: true` — slot-filling is expected behavior, not an error
- `collectedArgs` uses conditional spread: only includes fields that are truthy
- `missingArgs: ['amount']` tells the system what's still needed
- **After this return:** BotService saves pending to Redis, sends `userMessage` to user, skips Phase B

### Step 2: Slot-fill check for missing category (lines 93-108)

```typescript
if (!category) {
  return {
    ok: true,
    action: 'register_transaction',
    userMessage: '¿En qué categoría lo registro? (ej: comida, transporte, salud…)',
    pending: {
      collectedArgs: {
        amount,
        ...(description ? { description } : {}),
        ...(posted_at ? { posted_at } : {}),
      },
      missingArgs: ['category'],
    },
  };
}
```

- Uses falsy check (`!category`), not `=== undefined`. So empty string `""` also triggers this.
- Guardrails already ensures category length > 0, so this is belt-and-suspenders.
- Preserves `amount` in `collectedArgs` (always truthy at this point since Step 1 passed).

### Step 3: Date normalization + Category loading + Category matching (lines 110-168)

**Date normalization** (line 111):

```typescript
const postedAt = posted_at ?? date ?? new Date().toISOString();
```

Three-level fallback: `posted_at` → `date` (legacy) → current datetime.

**Category loading** (lines 113-136):

1. If `_categories` injected by BotService → use directly (no DB query, line 114)
2. Otherwise → query Supabase: `SELECT id, name FROM categories WHERE user_id = userId`
3. DB error → return `{ok: false, errorCode: 'DB_QUERY_FAILED', userMessage: 'Hubo un problema consultando tus categorías...'}`
4. Empty result → return `{ok: true, userMessage: 'Aún no tienes categorías configuradas. Primero crea algunas desde la app web.'}`

**Category matching** (line 148):

```typescript
const matched = this.findBestCategoryMatch(String(category), categories);
```

Note: `String()` cast ensures even if AI sent a number it becomes a string.

**No match** (lines 150-168):

```typescript
if (!matched) {
  const suggestions = categories.map((c) => `• ${c.name}`).join('\n');
  return {
    ok: true,
    action: 'register_transaction',
    userMessage: `No encontré la categoría "${category}". Elige una de tus categorías:\n${suggestions}`,
    pending: {
      collectedArgs: {
        amount,                                    // PRESERVED — critical
        ...(description ? { description } : {}),
        ...(posted_at ? { posted_at } : {}),
      },
      missingArgs: ['category'],
    },
  };
}
```

- Shows full category list as bullet points
- **Preserves `amount`** in `collectedArgs` (the "IMPORTANT" comment on line 158) so user doesn't re-say it
- `missingArgs: ['category']` — user needs to pick a valid category

### Step 4: Payment method resolution (lines 170-204)

```typescript
let finalPaymentMethodId = payment_method_id;
if (!finalPaymentMethodId) {
  const { data: defaultPaymentMethod, error: pmError } = await this.supabase
    .from('payment_method')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  // ...
  finalPaymentMethodId = defaultPaymentMethod.id;
}
```

1. If `payment_method_id` in args → use directly (line 171). In practice never happens from AI since it's not in the schema.
2. Query `payment_method` table: `SELECT id WHERE user_id LIMIT 1` using `.maybeSingle()` (line 178)
3. DB error → return `{ok: false, errorCode: 'DB_QUERY_FAILED', userMessage: '...'}`
4. No payment method found → return `{ok: true, userMessage: 'Aún no tienes métodos de pago configurados...'}`
5. Success → use `defaultPaymentMethod.id`

**Note:** Always picks the **first** payment method. No ordering specified in the query, so order is DB-dependent. There's no way for the user to choose a specific payment method via chat — the schema doesn't expose `payment_method` as a field.

### Step 5: INSERT transaction (lines 206-243)

```typescript
const parsedAmount = Number(amount);
const { data: inserted, error } = await this.supabase
  .from('transactions')
  .insert({
    user_id: userId,
    amount: parsedAmount,
    category_id: matched.id,
    posted_at: postedAt,
    description: description ?? null,
    payment_method_id: finalPaymentMethodId,
    source: 'chat_intent',
    status: 'posted',
  })
  .select('id')
  .single();
```

**Insert payload:**

| Column | Value | Source |
|--------|-------|--------|
| `user_id` | userId | From BotService (resolved from channel_accounts) |
| `amount` | `Number(amount)` | Explicit `Number()` cast at line 207 |
| `category_id` | `matched.id` | UUID from category matching (Step 3) |
| `posted_at` | postedAt | ISO string from date normalization (Step 3) |
| `description` | `description ?? null` | From AI or null |
| `payment_method_id` | finalPaymentMethodId | From Step 4 |
| `source` | `'chat_intent'` | Hardcoded — marks as bot-originated |
| `status` | `'posted'` | Hardcoded — immediately active |

**`.select('id').single()`** — Returns the inserted row's UUID.

**DB error** → return `{ok: false, errorCode: 'DB_INSERT_FAILED'}` — **no `userMessage`** here. BotService proceeds to Phase B which generates a failure response.

**Success** → return:

```typescript
{
  ok: true,
  action: 'register_transaction',
  data: {
    transaction_id: inserted?.id,      // UUID from Supabase
    amount: parsedAmount,               // number (rounded by Guardrails to 2 decimals)
    category: matched.name,             // original category name (NOT lowercased — from DB)
    posted_at: postedAt,                // ISO string
    description: description ?? null,
    payment_method_id: finalPaymentMethodId,
  },
}
```

**After success return:** BotService does three things:
1. Records metrics (bot.service.ts line 320-323): `metricsService.recordTransaction(userId)` — updates streak days, week transaction count
2. Proceeds to Phase B — Phase B gets the `data` object and generates a personalized confirmation (e.g., "Anotado, $15.000 en Alimentación")
3. Clears pending (bot.service.ts line 459-463): only if `pending` existed AND `toolCall.name === pending.tool` (the bug fix applied 2026-02-13)

---

## findBestCategoryMatch() — 3-Tier Strategy

**Lines 251-282.** Called at line 148.

```typescript
private findBestCategoryMatch(
  input: string,
  categories: Array<{ id: string; name: string }>,
): { id: string; name: string } | null
```

**Input:** `input` (string from AI, already lowercased by Guardrails sanitizer), `categories` (array of `{id, name}` from DB or context injection)

**Returns:** `{id, name}` of best match, or `null` if no match.

### Matching cascade

| Order | Method | Code | Example |
|-------|--------|------|---------|
| 0 | **Early exit** | `!input \|\| !categories?.length` → `null` | Empty input or no categories |
| 0b | **Sentinel** | `inputLower === '_no_match'` → `null` | AI explicitly signals no category fits |
| 1 | **Exact match** (case-insensitive) | `c.name?.toLowerCase() === inputLower` | `"alimentación"` matches `"Alimentación"` |
| 2 | **Substring match** (bidirectional) | `catLower.includes(inputLower) \|\| inputLower.includes(catLower)` | `"comida"` matches `"Comida y Bebida"`, or `"comida y bebida"` matches `"Comida"` |
| 3 | **Typo tolerance** (≤2 char diff) | `isSimilarString(inputLower, catLower, 2)` | `"transpote"` matches `"transporte"` (1 char substitution) |

**Note on `_no_match` sentinel:** The Phase A prompt (phase_a_system.txt line 106) instructs the AI: "Si el usuario nombra algo que NO encaja razonablemente en NINGUNA categoría disponible, devuelve `_no_match` como category." The handler then returns `null` → shows category list to user.

**Note on matching order:** Uses `Array.find()` — returns the **first** match in the categories array. If multiple categories match at the same tier, the one that appears first in the user's category list wins.

---

## isSimilarString() — Typo Tolerance

**Lines 287-298.** Called by `findBestCategoryMatch()` as tier 3.

```typescript
private isSimilarString(a: string, b: string, maxDiff: number): boolean {
  if (Math.abs(a.length - b.length) > maxDiff) return false;

  let diff = 0;
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) diff++;
    if (diff > maxDiff) return false;  // early exit
  }
  diff += Math.abs(a.length - b.length);
  return diff <= maxDiff;
}
```

**Algorithm:** Simple char-by-char positional comparison. NOT Levenshtein distance.

- If length difference > `maxDiff` → reject immediately
- Iterate the shorter string, count positions where `a[i] !== b[i]`
- Add length difference to diff count
- Return `diff <= maxDiff`

**Strengths:** Catches single/double character substitutions at the same position. Fast — O(n) with early exit.

**Weakness:** Insertions/deletions shift all subsequent characters, causing cascading mismatches. Example: `"transporte"` (10 chars) vs `"tansporte"` (9 chars, missing 'r') — every char after position 1 is shifted, so diff quickly exceeds 2. The `maxDiff` of 2 compensates for some cases but not all.

---

## All Possible Return Paths (9 total)

| # | Line | `ok` | Has `userMessage` | Has `pending` | Has `data` | Triggers Phase B? | Scenario |
|---|------|------|-------------------|---------------|-----------|-------------------|----------|
| 1 | 78-90 | `true` | `"¿Cuánto fue el gasto exactamente?"` | `missingArgs: ['amount']` | No | **No** | Amount missing |
| 2 | 94-107 | `true` | `"¿En qué categoría lo registro?..."` | `missingArgs: ['category']` | No | **No** | Category missing |
| 3 | 126-132 | `false` | `"Hubo un problema consultando tus categorías..."` | No | No | **No** | DB error querying categories |
| 4 | 139-144 | `true` | `"Aún no tienes categorías configuradas..."` | No | No | **No** | User has zero categories |
| 5 | 154-167 | `true` | `"No encontré la categoría... Elige una:"` | `missingArgs: ['category']` | No | **No** | Category match failed |
| 6 | 185-191 | `false` | `"Hubo un problema consultando tus métodos de pago..."` | No | No | **No** | DB error querying payment methods |
| 7 | 195-200 | `true` | `"Aún no tienes métodos de pago configurados..."` | No | No | **No** | User has zero payment methods |
| 8 | 225-229 | `false` | **No** | No | No | **Yes** (error) | DB insert failed |
| 9 | 232-243 | `true` | **No** | No | **Yes** | **Yes** (success) | Transaction registered |

**Key pattern:** Any return with `userMessage` → BotService returns the message directly to the user, **skips Phase B entirely** (bot.service.ts lines 326-361). Only returns #8 and #9 (no `userMessage`) proceed to Phase B for personalized response generation.

**Return #8 specifics:** No `userMessage` means BotService doesn't return early. It proceeds to Phase B with `result.ok = false`. Phase B then generates an in-character error response.

**Return #9 specifics:** Happy path. Phase B receives the `data` object and generates a confirmation like "Anotado, $15.000 en Alimentación".

---

## DB Tables Accessed

| Table | Operation | Query | When |
|-------|-----------|-------|------|
| `categories` | `SELECT id, name` | `.eq('user_id', userId)` | Only if `_categories` not injected (fallback) |
| `payment_method` | `SELECT id` | `.eq('user_id', userId).limit(1).maybeSingle()` | Always (Step 4) |
| `transactions` | `INSERT` | full row with `.select('id').single()` | On successful registration (Step 5) |

**Note:** The `categories` query is usually skipped because BotService injects `_categories` from the already-loaded user context (bot.service.ts lines 298-305). The DB query only runs as a fallback.

---

## Integration with BotService

### Before handler execution

1. **Context loading** (bot.service.ts line 175-183): BotService loads user context, pending state, metrics, cooldowns, history in parallel via `Promise.all()`.

2. **Phase A** (bot.service.ts lines 214-222): AI decides intent. If `register_transaction`, returns `tool_call: { name: 'register_transaction', args: {...} }`.

3. **Guardrails** (bot.service.ts lines 274-291): Validates and sanitizes args. Rejects if validation fails.

4. **Category injection** (bot.service.ts lines 298-305):
   ```typescript
   if (
     (toolCall.name === 'register_transaction' ||
       toolCall.name === 'manage_transactions') &&
     context.categories?.length
   ) {
     sanitizedArgs._categories = context.categories;
   }
   ```

5. **Handler execution** (bot.service.ts line 307): `handler.execute(userId, m, sanitizedArgs)`

### After handler execution

6. **Metrics recording** (bot.service.ts lines 320-323): Only if `toolCall.name === 'register_transaction' && result.ok`:
   ```typescript
   await this.metricsService.recordTransaction(userId);
   ```
   Updates `conv:{userId}:metrics` in Redis — streak days, week transaction count.

7. **Slot-fill handling** (bot.service.ts lines 326-361): If `result.userMessage` exists:
   - If `result.pending` exists → saves to Redis: `conv:{userId}:pending` (10min TTL) as `PendingSlot { tool, collectedArgs, missingArgs, askedAt }`
   - Returns `userMessage` to user. **Phase B is skipped entirely.**

8. **Phase B** (bot.service.ts lines 394-439): Only reached if no `userMessage`. Phase B receives `result` and generates personalized response.

9. **Pending clear** (bot.service.ts lines 459-463):
   ```typescript
   if (pending && result.ok && toolCall.name === pending.tool) {
     await this.conversation.clearPending(userId);
   }
   ```
   Only clears pending when the **same tool** that was pending completes successfully. (Bug fix applied 2026-02-13 — previously cleared on ANY successful tool.)

---

## Slot-Fill Lifecycle (end to end)

### Redis storage

- **Key:** `conv:{userId}:pending`
- **TTL:** 10 minutes (auto-expires if user abandons)
- **Format:** JSON `PendingSlot`:
  ```typescript
  {
    tool: 'register_transaction',
    collectedArgs: { category: 'alimentación' },
    missingArgs: ['amount'],
    askedAt: '2026-02-13T15:30:00.000Z'
  }
  ```

### How Phase A uses pending context

BotService converts pending to `PendingSlotContext` via `toPendingSlotContext()` (orchestrator.contracts.ts) and sends it as part of the Phase A request. The Phase A prompt (phase_a_system.txt lines 88-97) instructs the AI:

```
Si hay contexto pendiente:
1. MEZCLA los args ya recolectados con lo nuevo que dice el usuario
2. Si el usuario dice solo una categoría → completa con el amount ya guardado
3. Si el usuario dice solo un monto → completa con la categoría ya guardada
4. NO vuelvas a pedir información que YA TIENES en collected_args
```

### Pending survival across unrelated messages

After the bug fix (2026-02-13), pending state **survives** if the user asks an unrelated question mid-flow:

```
User: "compré una bebida"
  → register_transaction, amount missing → pending saved: {tool: 'register_transaction', collected: {category: 'Alimentación'}, missing: ['amount']}
  → Bot: "¿Cuánto fue?"

User: "puedo registrar en dólares?"
  → Phase A picks ask_app_info (not register_transaction)
  → ask_app_info executes → result.ok = true
  → bot.service.ts line 460: pending.tool='register_transaction' !== toolCall.name='ask_app_info' → pending NOT cleared ✓

User: "2000"
  → Phase A sees pending context → merges → register_transaction {amount: 2000, category: 'Alimentación'}
  → Handler inserts → success
  → bot.service.ts line 460: pending.tool='register_transaction' === toolCall.name='register_transaction' → pending cleared ✓
```

---

## Message Flows

### Happy path (single message)

```
User: "gasté 15 lucas en comida"
  → Phase A: tool_call { name: "register_transaction", args: { amount: 15000, category: "comida" } }
  → Guardrails: validates (15000 > 0 ✓, "comida" length > 0 ✓), sanitizes (amount rounded, category lowercased+trimmed)
  → Handler Step 3: exact match "comida" → matched category {id: "uuid", name: "Comida"}
  → Handler Step 4: get default payment method
  → Handler Step 5: INSERT into transactions
  → BotService: recordTransaction() metrics
  → Phase B: generates "Anotado, $15.000 en Comida 🍔"
  → BotService: clears pending if existed
```

### Missing amount (slot-fill, 2 messages)

```
User: "compré una bebida"
  → Phase A: amount not explicit → clarification "¿Cuánto fue?"
     (Phase A prompt now requires explicit number — won't guess)
  → No handler called. Bot returns clarification directly.

User: "2000"
  → Phase A: no pending context for this path → might need category too
```

OR (if Phase A returns tool_call without amount):

```
User: "registra un gasto en comida"
  → Phase A: tool_call { args: { category: "comida" } }
  → Guardrails: REJECTS (amount is required, missing)
  → Bot: "No pude procesar tu solicitud. ¿Podrías intentar de nuevo con más detalle?"
```

### Missing amount via slot-fill (if amount arrives as undefined in handler)

```
User: [stub mode or edge case where amount is undefined]
  → Handler Step 1: amount === undefined
  → return { userMessage: "¿Cuánto fue el gasto exactamente?", pending: { collectedArgs: {category: "comida"}, missingArgs: ['amount'] } }
  → Saved to Redis conv:{userId}:pending (10min TTL)

User: "15 lucas"
  → Phase A (with pending context): tool_call { args: { amount: 15000, category: "comida" } }
  → Handler: all args present → INSERT → success
```

### Category not found (slot-fill)

```
User: "gasté 5000 en gimnasio"
  → Phase A: tool_call { args: { amount: 5000, category: "gimnasio" } }
  → Guardrails: passes
  → Handler Step 3: findBestCategoryMatch("gimnasio", [...]) → null (no match)
  → return {
      userMessage: "No encontré la categoría \"gimnasio\". Elige una de tus categorías:\n• Alimentación\n• Transporte\n• Salud...",
      pending: { collectedArgs: { amount: 5000 }, missingArgs: ['category'] }
    }

User: "Alimentación"
  → Phase A (with pending): tool_call { args: { amount: 5000, category: "Alimentación" } }
  → Handler: exact match → INSERT → success
```

### No categories configured

```
User: "gasté 10000 en comida"
  → Handler Step 3: categories array empty
  → return { ok: true, userMessage: "Aún no tienes categorías configuradas. Primero crea algunas desde la app web." }
  → No pending saved (no pending field in return). Conversation ends.
```

### No payment method configured

```
User: "gasté 10000 en comida"
  → Handler Steps 1-3: pass (amount, category, categories all good)
  → Handler Step 4: query payment_method → null
  → return { ok: true, userMessage: "Aún no tienes métodos de pago configurados. Primero configura uno desde la app web." }
  → No pending saved. Conversation ends.
```

### DB insert failure

```
User: "gasté 10000 en comida"
  → Handler Steps 1-4: all pass
  → Handler Step 5: INSERT fails (DB error)
  → return { ok: false, action: 'register_transaction', errorCode: 'DB_INSERT_FAILED' }
  → No userMessage → proceeds to Phase B
  → Phase B generates error response in Gus's personality
```

### _no_match sentinel

```
User: "gasté 5000 en algo que no encaja en nada"
  → Phase A: tool_call { args: { amount: 5000, category: "_no_match" } }
  → Handler Step 3: findBestCategoryMatch("_no_match", [...]) → null (sentinel detected)
  → Shows category list with pending preserving amount
```

---

## Key Design Decisions

1. **Handler never calls AI** — only DB operations and local logic. AI orchestration happens in BotService.

2. **Slot-filling is stateful** — `pending` state persists across messages via Redis (`conv:{userId}:pending`, 10min TTL). Auto-expires if user abandons.

3. **Category matching trusts the LLM first** — the Phase A prompt instructs the AI to match against `available_categories`. The handler's `findBestCategoryMatch()` (substring + typo tolerance) is a lightweight safety net.

4. **`_categories` injection** — BotService passes categories from the already-loaded user context to avoid a redundant DB query. The handler still has a fallback DB query.

5. **All slot-fill returns use `ok: true`** — slot-filling is not an error state. This matters because BotService checks `result.ok` for metrics recording (only records if `ok: true && toolCall.name === 'register_transaction'`).

6. **`payment_method_id` is not user-choosable** — the handler always uses the first payment method. Multi-account selection is not yet supported via chat.

7. **`source: 'chat_intent'`** — hardcoded to distinguish bot-created transactions from manual ones, imports, bank API, or AI extraction.

8. **`status: 'posted'`** — hardcoded to immediately active. No draft/pending status for chat transactions.

9. **Guardrails is the primary gate** — the handler's own amount/category checks are a second safety net for edge cases (stub mode, future integrations).

---

## Phase A Prompt Rules (amount guardrail)

**File:** `tally-combined/ai-service_TallyFinane/prompts/phase_a_system.txt` (lines 115-125)

The Phase A prompt has explicit rules for how the AI should handle `register_transaction` args:

```
1. TRANSACCIONES (register_transaction):
   - Detecta gastos/ingresos en lenguaje natural
   - DEDUCE la categoría del contexto (restaurante → Alimentación, uber → Transporte)
   - MONTO: Solo extrae de un número EXPLÍCITO en el mensaje actual del usuario
     * "compré una bebida" → NO hay número → pide amount con clarification
     * "compré una bebida de 2000" → amount: 2000
     * "15 lucas en comida" → amount: 15000, category: Alimentación
   - NUNCA inventes un monto basándote en transacciones anteriores o sentido común
   - Si no hay número explícito, SIEMPRE pide clarification para amount
   - "lucas" = x1000 (ej: "10 lucas" = 10000)
   - Solo pide clarification para categoría si NO puedes deducir de NINGUNA forma
```

**Key:** "DEDUCE" only applies to **category** (infer from context). Amount requires an **explicit number** in the user's message. The AI must NEVER guess/invent an amount.

---

## Bug Fixes Applied

### 2026-02-13: Hallucinated amounts (Phase A prompt)

**Problem:** Phase A prompt said "DEDUCE el monto de números mencionados" which the AI interpreted as permission to guess amounts from conversation history or common sense. User says "compré una bebida" → AI invents `amount: 1000`.

**Fix:** Replaced the TRANSACCIONES rule in `phase_a_system.txt`. Amount now requires explicit number: `"MONTO: Solo extrae de un número EXPLÍCITO en el mensaje actual del usuario"` + `"NUNCA inventes un monto"`.

### 2026-02-13: Slot-fill context loss (bot.service.ts)

**Problem:** In `bot.service.ts` line 460, `if (pending && result.ok)` cleared pending after ANY successful tool, not just the pending tool. If user had pending `register_transaction` and asked an unrelated question (→ `ask_app_info`), the pending was wiped.

**Fix:** Changed to `if (pending && result.ok && toolCall.name === pending.tool)`. Now only the matching tool clears its own pending state.
