# manage_transactions — Complete Handler Reference

> **File:** `tally-combined/backend-API_TallyFinance/src/bot/tools/handlers/manage-transactions.tool-handler.ts` (594 lines)
> **Requiere contexto:** Sí (`requiresContext = true`, line 86)
> **Last updated:** 2026-02-13

---

## Table of Contents

1. [Identity & Registration](#identity--registration)
2. [Schema (sent to AI)](#schema-sent-to-ai)
3. [AI Service Schema (tool_schemas.py)](#ai-service-schema-tool_schemaspy)
4. [Phase A Prompt Rules](#phase-a-prompt-rules)
5. [Pre-execution: Guardrails](#pre-execution-guardrails)
6. [Execution Entry Point — Operation Router](#execution-entry-point--operation-router)
7. [Operation: list](#operation-list)
8. [Operation: delete](#operation-delete)
9. [Operation: edit](#operation-edit)
10. [Transaction Resolution Engine (resolveTransaction)](#transaction-resolution-engine-resolvetransaction)
11. [findBestCategoryMatch() — 3-Tier Strategy](#findbestcategorymatch--3-tier-strategy)
12. [isSimilarString() — Typo Tolerance](#issimilarstring--typo-tolerance)
13. [All Possible Return Paths (17 total)](#all-possible-return-paths-17-total)
14. [DB Tables Accessed](#db-tables-accessed)
15. [Integration with BotService](#integration-with-botservice)
16. [Slot-Fill Lifecycle: Disambiguation Flow](#slot-fill-lifecycle-disambiguation-flow)
17. [Slot-Fill Lifecycle: Edit Missing Changes](#slot-fill-lifecycle-edit-missing-changes)
18. [Slot-Fill Lifecycle: Edit Category Mismatch](#slot-fill-lifecycle-edit-category-mismatch)
19. [Stub Mode (Offline Fallback)](#stub-mode-offline-fallback)
20. [AI Summary Generation (orchestrator.py)](#ai-summary-generation-orchestratorpy)
21. [Message Flows](#message-flows)
22. [Key Design Decisions](#key-design-decisions)

---

## Identity & Registration

```typescript
// lines 20-21
export class ManageTransactionsToolHandler implements ToolHandler {
  readonly name = 'manage_transactions';
```

- Implements `ToolHandler` interface (from `tool-handler.interface.ts`)
- Registered in `ToolRegistry` constructor (tool-registry.ts line 42): `new ManageTransactionsToolHandler(supabase)`
- Constructor (line 88): receives `SupabaseClient` via dependency injection from `ToolRegistry`
- This is the **most complex handler** in the system — 594 lines, 3 operations, 4 private methods, disambiguation slot-fill, category matching, transaction resolution with hints

---

## Schema (sent to AI)

Defined at lines 23-84. Sent to AI service as part of `tools[]` in every Phase A request. This is the **largest schema** of all 7 handlers — 11 properties.

```typescript
readonly schema: ToolSchema = {
  name: 'manage_transactions',
  description:
    'Gestiona transacciones existentes del usuario: listar las últimas, editar campos (monto, categoría, descripción, fecha), o eliminar una transacción. Usa hints para identificar la transacción objetivo si no tienes el ID.',
  parameters: {
    type: 'object',
    properties: {
      operation:        { type: 'string',  description: 'Operación a realizar: "list", "edit", o "delete"' },
      transaction_id:   { type: 'string',  description: 'UUID de la transacción (si se conoce del historial de conversación)' },
      hint_amount:      { type: 'number',  description: 'Monto aproximado para identificar la transacción' },
      hint_category:    { type: 'string',  description: 'Categoría para identificar la transacción' },
      hint_description: { type: 'string',  description: 'Descripción parcial para identificar la transacción' },
      limit:            { type: 'number',  description: 'Cantidad de transacciones a listar (default 5, max 20)' },
      new_amount:       { type: 'number',  description: 'Nuevo monto para editar' },
      new_category:     { type: 'string',  description: 'Nueva categoría para editar' },
      new_description:  { type: 'string',  description: 'Nueva descripción para editar' },
      new_posted_at:    { type: 'string',  description: 'Nueva fecha para editar (ISO-8601)' },
      choice:           { type: 'number',  description: 'Número 1-based para elegir entre transacciones ambiguas' },
    },
    required: ['operation'],
  },
};
```

### Property groups

| Group | Properties | Used by operation |
|-------|-----------|-------------------|
| **Routing** | `operation` | All (required) |
| **Identification** | `transaction_id`, `hint_amount`, `hint_category`, `hint_description` | edit, delete |
| **List control** | `limit` | list |
| **Edit values** | `new_amount`, `new_category`, `new_description`, `new_posted_at` | edit |
| **Disambiguation** | `choice` | edit, delete (from slot-fill pending) |

### Full property table

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `operation` | `string` | **Yes** | `"list"`, `"edit"`, or `"delete"` |
| `transaction_id` | `string` | No | UUID if known from conversation history |
| `hint_amount` | `number` | No | Approximate amount to identify the transaction |
| `hint_category` | `string` | No | Category to narrow down the search |
| `hint_description` | `string` | No | Partial description to identify |
| `limit` | `number` | No | Number of transactions to list (default 5, max 20) |
| `new_amount` | `number` | No | New amount for edit operation |
| `new_category` | `string` | No | New category for edit operation |
| `new_description` | `string` | No | New description for edit operation |
| `new_posted_at` | `string` | No | New date (ISO-8601) for edit operation |
| `choice` | `number` | No | 1-based pick from disambiguation list |

---

## AI Service Schema (tool_schemas.py)

The AI service has its own mirror of this schema (tool_schemas.py lines 78-134). It's identical in structure to the backend schema. This is what OpenAI's model sees when deciding which tool to call.

Key: both backend and AI service schemas must stay in sync. If a property is added to one, it must be added to the other.

---

## Phase A Prompt Rules

The Phase A prompt (phase_a_system.txt) has specific rules for when to use `manage_transactions`:

### Reference resolution (lines 12-21)

```
- "bórralo" / "elimínalo" / "quítalo" → manage_transactions operation=delete, transaction_id del historial
- "cámbialo" / "corrígelo" → manage_transactions operation=edit
- "mis gastos" / "mis últimas transacciones" → manage_transactions operation=list
- "no eran 15 lucas, eran 10" → manage_transactions operation=edit, hint_amount=15000, new_amount=10000
```

### Decision rules (lines 133-141)

```
3. GESTIÓN DE TRANSACCIONES (manage_transactions):
   - "Mis últimos gastos" / "ver transacciones" → operation=list
   - "Borra el último gasto" / "elimina eso" → operation=delete
   - "Cambia el monto a 20 lucas" / "era transporte, no comida" → operation=edit
   - Para delete/edit: usa transaction_id del historial o hints (hint_amount, hint_category, hint_description)
   - Para edit: incluye campos nuevos (new_amount, new_category, new_description, new_posted_at)
   - Sin hints → refiere a la última transacción
   - NUNCA pidas confirmación para borrar
   - "no eran X, eran Y" → operation=edit, hint_amount=X, new_amount=Y
```

**Key instruction:** "NUNCA pidas confirmación para borrar" — the AI should immediately call `manage_transactions` with `operation=delete`, never ask "¿Estás seguro?".

### Context-aware deduction (lines 23-27)

```
- Si el usuario corrige ("no, eran 15 lucas"), entiende que se refiere a la ultima accion
- Si hay pending slot-fill + historial, prioriza el pending para completar
```

### How AI gets transaction_id

The AI knows recent `transaction_id`s from **Tier 1 conversation history** — the last 10 user/assistant pairs stored in Redis (`conv:{userId}:history`, 10min TTL). When a `register_transaction` succeeds, Phase B generates a response like "Anotado, $15.000 en Comida" and this gets saved to history. The AI sees these in subsequent messages and can extract the `transaction_id` from the prior `register_transaction` result in context.

In practice, the AI more commonly uses **hints** (`hint_amount`, `hint_category`) rather than `transaction_id`, because the transaction_id UUID isn't typically visible in the conversation text.

---

## Pre-execution: Guardrails

`GuardrailsService` (guardrails.service.ts lines 36-73) validates and sanitizes before `execute()`.

### Validation rules

| Field | Validation | Rejects if... |
|-------|-----------|---------------|
| `operation` | **Required.** `typeof string && in ['list', 'edit', 'delete']` | missing, invalid value |
| `transaction_id` | Optional. `undefined OR (string && /^[a-f0-9-]{36}$/i)` | not a valid UUID format |
| `hint_amount` | Optional. `undefined OR (number && > 0 && < 100,000,000)` | 0, negative, >= 100M |
| `hint_category` | Optional. `undefined OR (string && length 1-99)` | empty string, >= 100 chars |
| `hint_description` | Optional. `undefined OR (string && length < 500)` | >= 500 chars |
| `limit` | Optional. `undefined OR (number && >= 1 && <= 20)` | 0, > 20 |
| `new_amount` | Optional. `undefined OR (number && > 0 && < 100,000,000)` | 0, negative, >= 100M |
| `new_category` | Optional. `undefined OR (string && length 1-99)` | empty string, >= 100 chars |
| `new_description` | Optional. `undefined OR (string && length < 500)` | >= 500 chars |
| `choice` | Optional. `undefined OR (number && >= 1 && <= 20)` | 0, > 20 |

### Sanitization

| Field | Sanitizer | Effect |
|-------|-----------|--------|
| `operation` | `String(v).trim().toLowerCase()` | Normalized |
| `hint_category` | `v ? String(v).trim().toLowerCase() : undefined` | Trimmed + lowercased |
| `hint_description` | `v ? String(v).trim() : undefined` | Trimmed |
| `new_amount` | `v !== undefined ? Math.round(Number(v) * 100) / 100 : undefined` | Rounded to 2 decimals |
| `new_category` | `v ? String(v).trim().toLowerCase() : undefined` | Trimmed + lowercased |
| `new_description` | `v ? String(v).trim() : undefined` | Trimmed |
| `choice` | `v !== undefined ? Math.round(Number(v)) : undefined` | Rounded to integer |

**Note:** `transaction_id`, `hint_amount`, `limit`, `new_posted_at` have **no sanitizers** — they pass through as-is after validation.

### Rejection behavior

If any validation fails, BotService returns:

```
"No pude procesar tu solicitud. ¿Podrías intentar de nuevo con más detalle?"
```

The handler's `execute()` is never called.

---

## Execution Entry Point — Operation Router

**Lines 90-111.** The `execute()` method is a simple router:

```typescript
async execute(
  userId: string,
  _msg: DomainMessage,    // unused
  args: Record<string, unknown>,
): Promise<ActionResult> {
  const operation = args.operation as string;

  switch (operation) {
    case 'list':   return this.handleList(userId, args);
    case 'edit':   return this.handleEdit(userId, args);
    case 'delete': return this.handleDelete(userId, args);
    default:
      return {
        ok: false,
        action: 'manage_transactions',
        userMessage: `Operación "${operation}" no reconocida. Usa list, edit o delete.`,
      };
  }
}
```

- Casts `args.operation` to string (already sanitized by Guardrails to lowercase)
- Routes to one of 3 private methods
- Default case: returns `ok: false` with userMessage (should never happen in normal flow since Guardrails validates `operation` is one of `list`/`edit`/`delete`)
- **The entire `args` object is passed through** to each operation, so they all have access to every field including `_categories` (injected by BotService)

---

## Operation: list

**Lines 115-156.** The simplest operation — no transaction resolution needed.

### Flow

1. **Parse limit** (line 119):
   ```typescript
   const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);
   ```
   - `Number(args.limit) || 5` — defaults to 5 if undefined/NaN/0
   - `Math.max(..., 1)` — floor at 1
   - `Math.min(..., 20)` — cap at 20

2. **Query** (lines 121-126):
   ```typescript
   .from('transactions')
   .select('id, amount, posted_at, description, categories(name), payment_method(name)')
   .eq('user_id', userId)
   .order('posted_at', { ascending: false })
   .limit(limit)
   ```
   - Joins `categories` and `payment_method` tables via foreign keys
   - Ordered by `posted_at` descending (most recent first)
   - Includes `payment_method(name)` — the only operation that surfaces this

3. **DB error** → return `{ok: false, errorCode: 'DB_QUERY_FAILED', userMessage: 'Hubo un problema consultando tus transacciones.'}`

4. **Format response** (lines 138-145): Maps each transaction to a flat object:
   ```typescript
   {
     transaction_id: tx.id,
     amount: tx.amount,
     category: tx.categories?.name ?? null,
     description: tx.description ?? null,
     posted_at: tx.posted_at,
     payment_method: tx.payment_method?.name ?? null,
   }
   ```

5. **Success return** (lines 147-155):
   ```typescript
   {
     ok: true,
     action: 'manage_transactions',
     data: {
       operation: 'list',
       transactions: formatted,    // Array of transaction objects
       count: formatted.length,    // Number of results
     },
   }
   ```

### Key details

- Empty result is **not an error** — returns `ok: true` with `transactions: []` and `count: 0`. Phase B handles the "no transactions" case.
- No `userMessage` → always proceeds to Phase B for response generation.
- `payment_method` is included in list data but NOT in edit/delete data — list is the only operation that shows it.

---

## Operation: delete

**Lines 160-199.** Uses `resolveTransaction()` to find the target, then deletes it.

### Flow

1. **Resolve transaction** (line 164): `const resolved = await this.resolveTransaction(userId, args);`
   - If `resolved.earlyReturn` → return it immediately (disambiguation, not found, etc.)
   - Otherwise → `resolved.transaction` has `{id, amount, category, description, posted_at}`

2. **Delete** (lines 169-173):
   ```typescript
   .from('transactions')
   .delete()
   .eq('id', tx.id)
   .eq('user_id', userId)    // security: ensures ownership
   ```
   - Double-filter: `id` + `user_id` prevents deleting another user's transaction

3. **DB error** → return `{ok: false, errorCode: 'DB_DELETE_FAILED', userMessage: 'Hubo un problema eliminando la transacción.'}`

4. **Success return** (lines 185-198):
   ```typescript
   {
     ok: true,
     action: 'manage_transactions',
     data: {
       operation: 'delete',
       deleted: {
         transaction_id: tx.id,
         amount: tx.amount,
         category: tx.category,
         description: tx.description,
         posted_at: tx.posted_at,
       },
     },
   }
   ```

### Key details

- **No confirmation asked** — Phase A prompt explicitly says "NUNCA pidas confirmación para borrar"
- Delete is **permanent** — there's no soft delete or trash
- The `deleted` object in the response lets Phase B generate a confirmation like "Eliminado: $15.000 en Comida."
- No `userMessage` on success → proceeds to Phase B

---

## Operation: edit

**Lines 203-356.** The most complex operation — validates changes, resolves transaction, matches category, builds update payload, re-fetches result.

### Flow

1. **Destructure edit fields** (lines 207-214):
   ```typescript
   const { new_amount, new_category, new_description, new_posted_at, _categories } = args;
   ```

2. **Check for at least one change** (lines 216-238):
   ```typescript
   if (new_amount === undefined && new_category === undefined &&
       new_description === undefined && new_posted_at === undefined) {
     return {
       ok: true,
       userMessage: '¿Qué quieres cambiar? Puedes modificar el monto, categoría, descripción o fecha.',
       pending: {
         collectedArgs: {
           operation: 'edit',
           ...(args.transaction_id ? { transaction_id } : {}),
           ...(args.hint_amount ? { hint_amount } : {}),
           ...(args.hint_category ? { hint_category } : {}),
           ...(args.hint_description ? { hint_description } : {}),
         },
         missingArgs: ['new_amount', 'new_category', 'new_description', 'new_posted_at'],
       },
     };
   }
   ```
   - Returns slot-fill if no `new_*` fields provided
   - Preserves all identification args (`transaction_id`, `hint_*`) in `collectedArgs`
   - Lists ALL four `new_*` fields as missing (any one of them would satisfy the requirement)
   - **Note:** `missingArgs` lists all four, but the handler only needs ONE — Phase A understands this contextually

3. **Resolve transaction** (line 240): `resolveTransaction(userId, args)` — same as delete

4. **Build update payload** (lines 245-306): Iterates each `new_*` field:

   - **`new_amount`** (lines 249-252): `updatePayload.amount = new_amount`, pushes `'monto'` to `changes[]`

   - **`new_category`** (lines 254-296): Most complex — requires category resolution:
     1. Load categories from `_categories` (injected) or DB fallback
     2. Run `findBestCategoryMatch(String(new_category), categories)` — same 3-tier cascade as register_transaction
     3. **No match** → return slot-fill with category list:
        ```typescript
        {
          ok: true,
          userMessage: `No encontré la categoría "${new_category}". Elige una:\n${suggestions}`,
          pending: {
            collectedArgs: {
              operation: 'edit',
              transaction_id: tx.id,        // RESOLVED tx.id — not hint anymore
              ...(new_amount !== undefined ? { new_amount } : {}),
              ...(new_description !== undefined ? { new_description } : {}),
              ...(new_posted_at !== undefined ? { new_posted_at } : {}),
            },
            missingArgs: ['new_category'],
          },
        }
        ```
        **Note:** At this point `transaction_id` is set to `tx.id` (the resolved UUID), not the original hint. This means the next round skips hint-based resolution entirely.
     4. Match found → `updatePayload.category_id = matched.id`, pushes `'categoría'` to `changes[]`

   - **`new_description`** (lines 298-301): `updatePayload.description = new_description`, pushes `'descripción'`

   - **`new_posted_at`** (lines 303-306): `updatePayload.posted_at = new_posted_at`, pushes `'fecha'`

5. **Save previous state** (lines 308-314): Captures `{ amount, category, description, posted_at }` from the resolved transaction before updating — used in the response to show what changed.

6. **UPDATE** (lines 316-321):
   ```typescript
   .from('transactions')
   .update(updatePayload)
   .eq('id', tx.id)
   .eq('user_id', userId)
   ```
   - Only updates the fields in `updatePayload` — other fields untouched
   - Double-filter for ownership security

7. **DB error** → return `{ok: false, errorCode: 'DB_UPDATE_FAILED', userMessage: '...'}`

8. **Re-fetch** (lines 333-338):
   ```typescript
   .from('transactions')
   .select('id, amount, posted_at, description, categories(name)')
   .eq('id', tx.id)
   .single()
   ```
   - Fetches the transaction again to get the post-update state
   - Joins `categories(name)` to resolve the new category name if changed
   - **No error handling on re-fetch** — falls back to pre-update values via `??`

9. **Success return** (lines 340-355):
   ```typescript
   {
     ok: true,
     action: 'manage_transactions',
     data: {
       operation: 'edit',
       transaction_id: tx.id,
       previous: { amount, category, description, posted_at },
       updated: {
         amount: updated?.amount ?? tx.amount,
         category: updated?.categories?.name ?? tx.category,
         description: updated?.description ?? tx.description,
         posted_at: updated?.posted_at ?? tx.posted_at,
       },
       changes: ['monto', 'categoría', ...],    // human-readable list
     },
   }
   ```

### Key details

- The `changes` array uses **Spanish words** (`'monto'`, `'categoría'`, `'descripción'`, `'fecha'`) — these are used by Phase B and stub mode to generate the response
- `previous` + `updated` enable Phase B to say things like "Cambié el monto de $15.000 a $20.000"
- Category DB error during edit returns `ok: false` and **aborts the entire edit**, even if other fields were valid
- Re-fetch ignoring errors means the response might show stale data if the re-fetch fails, but the update itself already succeeded

---

## Transaction Resolution Engine (resolveTransaction)

**Lines 360-546.** Shared by `delete` and `edit`. This is the core complexity of the handler — a 4-strategy resolution pipeline with hint-based fuzzy matching and disambiguation slot-fill.

### Signature

```typescript
private async resolveTransaction(
  userId: string,
  args: Record<string, unknown>,
): Promise<{
  transaction?: { id: string; amount: number; category: string; description: string | null; posted_at: string };
  earlyReturn?: ActionResult;
}>
```

Returns either a resolved `transaction` or an `earlyReturn` (ActionResult to return immediately).

### Destructured fields (lines 367-382)

```typescript
const {
  transaction_id,     // string | undefined — UUID from AI or previous slot-fill
  hint_amount,        // number | undefined — approximate amount
  hint_category,      // string | undefined — category name
  hint_description,   // string | undefined — partial description
  choice,             // number | undefined — 1-based disambiguation pick
  _candidates,        // Array<any> | undefined — candidates from previous disambiguation round
} = args;
```

**`_candidates`** is an internal field — never comes from the AI. It's stored in `pending.collectedArgs` during disambiguation and passed back on the next round.

### Strategy 1: Disambiguation choice (lines 384-397)

```typescript
if (choice !== undefined && _candidates?.length) {
  const idx = choice - 1; // 1-based → 0-based
  if (idx < 0 || idx >= _candidates.length) {
    return {
      earlyReturn: {
        ok: true,
        userMessage: `Elige un número entre 1 y ${_candidates.length}.`,
      },
    };
  }
  return { transaction: _candidates[idx] };
}
```

- **Triggers when:** Both `choice` and `_candidates` exist (from a previous disambiguation round)
- Converts 1-based user input to 0-based index
- Out of bounds → returns error message (no pending — user can just try again)
- Valid → returns the selected candidate directly (no DB query needed)

### Strategy 2: Direct ID lookup (lines 399-427)

```typescript
if (transaction_id) {
  const { data: tx, error } = await this.supabase
    .from('transactions')
    .select('id, amount, posted_at, description, categories(name)')
    .eq('id', transaction_id)
    .eq('user_id', userId)      // security: ownership check
    .maybeSingle();

  if (error || !tx) {
    return { earlyReturn: { ok: true, userMessage: 'No encontré esa transacción. ¿Me das más detalles?' } };
  }

  return {
    transaction: {
      id: tx.id,
      amount: tx.amount,
      category: (tx as any).categories?.name ?? '',
      description: tx.description,
      posted_at: tx.posted_at,
    },
  };
}
```

- **Triggers when:** `transaction_id` is provided
- Uses `.maybeSingle()` — returns null instead of error if not found
- Ownership enforced: `.eq('user_id', userId)`
- Error OR not found → "No encontré esa transacción" (no distinction between error/not found)
- Normalizes the Supabase join result `(tx as any).categories?.name` into a flat object

### Strategy 3: Hint-based search (lines 429-516)

**Triggers when:** No `choice`+`_candidates`, no `transaction_id`. This is the most common path.

#### Step 3a: Fetch recent transactions (lines 430-456)

```typescript
const { data: recent, error } = await this.supabase
  .from('transactions')
  .select('id, amount, posted_at, description, categories(name)')
  .eq('user_id', userId)
  .order('posted_at', { ascending: false })
  .limit(30);
```

- Fetches the **last 30 transactions** — larger window than list (which caps at 20)
- Ordered by `posted_at` descending
- DB error → `{ok: false, errorCode: 'DB_QUERY_FAILED', userMessage: '...'}`
- No transactions → `{ok: true, userMessage: 'No tienes transacciones registradas.'}`

#### Step 3b: Normalize (lines 458-465)

```typescript
const normalized = recent.map((tx: any) => ({
  id: tx.id,
  amount: tx.amount,
  category: tx.categories?.name ?? '',
  description: tx.description ?? null,
  posted_at: tx.posted_at,
}));
```

Flattens the Supabase join into a consistent shape.

#### Step 3c: No hints → most recent (lines 467-475)

```typescript
const hasHints = hint_amount !== undefined || hint_category !== undefined || hint_description !== undefined;

if (!hasHints) {
  return { transaction: normalized[0] };
}
```

**If no hints at all → defaults to the most recent transaction.** This handles "borra el último gasto" / "elimina eso" where the user doesn't specify which one.

#### Step 3d: Filter by hints (lines 477-501)

Three sequential filters applied to candidates. Each one **narrows** the candidate list (AND logic):

1. **`hint_amount`** (lines 480-485):
   ```typescript
   const tolerance = Math.max(hint_amount * 0.05, 100);
   candidates = candidates.filter(
     (tx) => Math.abs(tx.amount - hint_amount) <= tolerance,
   );
   ```
   - Tolerance: **5% of the hint amount, minimum $100**
   - Examples: hint_amount=15000 → tolerance=750 → matches 14250-15750
   - hint_amount=500 → tolerance=100 (minimum) → matches 400-600

2. **`hint_category`** (lines 487-491):
   ```typescript
   const hintLower = hint_category.toLowerCase();
   candidates = candidates.filter(
     (tx) => tx.category.toLowerCase().includes(hintLower),
   );
   ```
   - Case-insensitive **substring** match (not exact)
   - "comida" matches "Comida y Bebida", "Comida", etc.

3. **`hint_description`** (lines 494-501):
   ```typescript
   const hintLower = hint_description.toLowerCase();
   candidates = candidates.filter(
     (tx) => tx.description && tx.description.toLowerCase().includes(hintLower),
   );
   ```
   - Case-insensitive substring
   - Transactions with null description are **excluded** (filtered out)

#### Step 3e: Evaluate results (lines 503-545)

| Candidates | Behavior |
|-----------|----------|
| 0 | `{ok: true, userMessage: 'No encontré una transacción con esas características. ¿Me das más detalles?'}` |
| 1 | Return it directly: `{ transaction: candidates[0] }` |
| 2+ | **Disambiguation slot-fill** (see below) |

**Disambiguation** (lines 518-545):

```typescript
const capped = candidates.slice(0, 5);   // max 5 shown
const formatCLP = (n: number) => `$${n.toLocaleString('es-CL')}`;
const lines = capped.map((tx, i) => {
  const date = tx.posted_at?.substring(0, 10) ?? '';
  const desc = tx.description ? ` — ${tx.description}` : '';
  return `${i + 1}. ${formatCLP(tx.amount)} en ${tx.category} (${date})${desc}`;
});

return {
  earlyReturn: {
    ok: true,
    userMessage: `Encontré ${candidates.length} transacciones:\n${lines.join('\n')}\n\n¿Cuál? (responde con el número)`,
    pending: {
      collectedArgs: {
        operation,                // preserved for next round
        _candidates: capped,      // the actual transaction objects
        ...(args.new_amount !== undefined ? { new_amount: args.new_amount } : {}),
        ...(args.new_category !== undefined ? { new_category: args.new_category } : {}),
        ...(args.new_description !== undefined ? { new_description: args.new_description } : {}),
        ...(args.new_posted_at !== undefined ? { new_posted_at: args.new_posted_at } : {}),
      },
      missingArgs: ['choice'],
    },
  },
};
```

- Caps display at **5 candidates** even if more matched
- Format: `1. $15.000 en Comida (2026-02-13) — almuerzo con amigos`
- Shows total count: `Encontré ${candidates.length} transacciones`
- `pending.collectedArgs._candidates` stores the **actual transaction objects** — not just IDs. This means the next round (Strategy 1) can return the selected candidate without any DB query.
- All `new_*` fields are preserved for edit operations
- `missingArgs: ['choice']` — user needs to respond with a number

---

## findBestCategoryMatch() — 3-Tier Strategy

**Lines 550-580.** Duplicated from `register-transaction.tool-handler.ts` (comment on line 548: "duplicated from register-transaction for OCP").

Identical implementation:

| Order | Method | Code |
|-------|--------|------|
| 0 | Early exit | `!input \|\| !categories?.length` → null |
| 0b | Sentinel | `inputLower === '_no_match'` → null |
| 1 | Exact match (case-insensitive) | `c.name?.toLowerCase() === inputLower` |
| 2 | Substring match (bidirectional) | `catLower.includes(inputLower) \|\| inputLower.includes(catLower)` |
| 3 | Typo tolerance (≤2 char diff) | `isSimilarString(inputLower, catLower, 2)` |

Only used by `handleEdit()` when `new_category` is provided.

---

## isSimilarString() — Typo Tolerance

**Lines 582-593.** Also duplicated from register-transaction.

Simple char-by-char positional comparison, NOT Levenshtein. Allows up to `maxDiff` (2) character differences at the same position. Length difference > `maxDiff` → immediate reject.

---

## All Possible Return Paths (17 total)

### Operation router (lines 90-111)

| # | Line | `ok` | `userMessage` | Scenario |
|---|------|------|---------------|----------|
| 1 | 105-109 | `false` | `Operación "${operation}" no reconocida...` | Invalid operation |

### handleList (lines 115-156)

| # | Line | `ok` | `userMessage` | Has `data` | Phase B? | Scenario |
|---|------|------|---------------|-----------|----------|----------|
| 2 | 130-135 | `false` | `Hubo un problema consultando tus transacciones.` | No | No | DB error |
| 3 | 147-155 | `true` | No | Yes: `{operation, transactions, count}` | **Yes** | Success (may be empty) |

### handleDelete (lines 160-199) + resolveTransaction

| # | Line | `ok` | `userMessage` | Has `pending` | Phase B? | Scenario |
|---|------|------|---------------|--------------|----------|----------|
| 4 | 389-394 | `true` | `Elige un número entre 1 y ${n}.` | No | No | Invalid choice |
| 5 | 410-415 | `true` | `No encontré esa transacción. ¿Me das más detalles?` | No | No | ID not found |
| 6 | 438-445 | `false` | `Hubo un problema consultando tus transacciones.` | No | No | DB error (recent) |
| 7 | 449-455 | `true` | `No tienes transacciones registradas.` | No | No | Zero transactions |
| 8 | 504-511 | `true` | `No encontré una transacción con esas características...` | No | No | Hints → 0 matches |
| 9 | 528-545 | `true` | `Encontré ${n} transacciones:\n...` | **Yes:** `missingArgs: ['choice']` | No | Hints → 2+ matches |
| 10 | 177-182 | `false` | `Hubo un problema eliminando la transacción.` | No | No | DB delete error |
| 11 | 185-198 | `true` | No | Yes: `{operation, deleted}` | **Yes** | Delete success |

### handleEdit (lines 203-356) + resolveTransaction

| # | Line | `ok` | `userMessage` | Has `pending` | Phase B? | Scenario |
|---|------|------|---------------|--------------|----------|----------|
| 12 | 223-237 | `true` | `¿Qué quieres cambiar? ...` | **Yes:** `missingArgs: ['new_amount', ...]` | No | No new_* fields |
| 4-9 | (same) | (same) | (same) | (same) | (same) | resolveTransaction returns (shared with delete) |
| 13 | 264-269 | `false` | `Hubo un problema consultando tus categorías.` | No | No | DB error (categories) |
| 14 | 277-291 | `true` | `No encontré la categoría... Elige una:` | **Yes:** `missingArgs: ['new_category']` | No | Category mismatch |
| 15 | 325-330 | `false` | `Hubo un problema actualizando la transacción.` | No | No | DB update error |
| 16 | 340-355 | `true` | No | Yes: `{operation, transaction_id, previous, updated, changes}` | **Yes** | Edit success |

### Summary

- **17 distinct return paths** (6 from resolveTransaction shared by edit+delete)
- **4 proceed to Phase B:** list success (#3), delete success (#11), edit success (#16), and any `ok: false` without `userMessage` (only #1, #6, #10, #13, #15 which all have userMessage, so in practice only #3, #11, #16 reach Phase B)
- Wait — #1 has `ok: false` + `userMessage` → no Phase B. Actually, every error path has `userMessage`. So **only the 3 success paths without userMessage proceed to Phase B**: list (#3), delete (#11), edit (#16).
- **3 slot-fill paths:** disambiguation (#9), edit no changes (#12), edit category mismatch (#14)

---

## DB Tables Accessed

| Table | Operation | Query | When |
|-------|-----------|-------|------|
| `transactions` | `SELECT` | `.select('id, amount, posted_at, description, categories(name), payment_method(name)')` + joins | list operation |
| `transactions` | `SELECT` | `.select('id, amount, posted_at, description, categories(name)')` + join | resolveTransaction (by ID, line 401-406) |
| `transactions` | `SELECT` | `.select('id, amount, posted_at, description, categories(name)')` + `.limit(30)` | resolveTransaction (hint search, line 430-435) |
| `transactions` | `DELETE` | `.delete().eq('id', tx.id).eq('user_id', userId)` | delete operation |
| `transactions` | `UPDATE` | `.update(payload).eq('id', tx.id).eq('user_id', userId)` | edit operation |
| `transactions` | `SELECT` | `.select('id, amount, posted_at, description, categories(name)')` (re-fetch) | edit operation (post-update, line 334-338) |
| `categories` | `SELECT` | `.select('id, name').eq('user_id', userId)` | edit with `new_category` (only if `_categories` not injected) |

**Total possible DB queries per operation:**
- **list:** 1 query
- **delete:** 1-2 queries (resolve + delete)
- **edit:** 1-4 queries (resolve + optional categories + update + re-fetch)

---

## Integration with BotService

### _categories injection (bot.service.ts lines 298-305)

Same as `register_transaction` — BotService injects `_categories` from context when `toolCall.name === 'manage_transactions'` and `context.categories?.length` is truthy.

### Metrics recording

**Does NOT record metrics.** BotService only calls `metricsService.recordTransaction()` for `register_transaction` (bot.service.ts line 320). Edits and deletes don't affect streak/week count.

### Pending clear (bot.service.ts line 459-463)

After the 2026-02-13 bug fix:
```typescript
if (pending && result.ok && toolCall.name === pending.tool) {
  await this.conversation.clearPending(userId);
}
```

- Clears pending only when `manage_transactions` completes successfully AND the pending was for `manage_transactions`
- A pending `manage_transactions` disambiguation won't be wiped by `ask_app_info` or any other tool succeeding

---

## Slot-Fill Lifecycle: Disambiguation Flow

The most common slot-fill for this handler. Occurs when hint-based search returns 2+ matches.

### Round 1: User asks to delete/edit

```
User: "borra el gasto de comida"
  → Phase A: manage_transactions { operation: 'delete', hint_category: 'comida' }
  → resolveTransaction: finds 3 transactions with "comida" category
  → return earlyReturn with disambiguation:
    "Encontré 3 transacciones:
     1. $15.000 en Comida (2026-02-13) — almuerzo
     2. $8.000 en Comida (2026-02-12) — café
     3. $22.000 en Comida (2026-02-11) — cena
     ¿Cuál? (responde con el número)"
  → pending saved to Redis:
    {
      tool: 'manage_transactions',
      collectedArgs: { operation: 'delete', _candidates: [...3 tx objects...] },
      missingArgs: ['choice'],
      askedAt: '2026-02-13T...'
    }
```

### Round 2: User picks a number

```
User: "2"
  → Phase A: sees pending with manage_transactions, merges → tool_call { name: 'manage_transactions', args: { operation: 'delete', _candidates: [...], choice: 2 } }
  → resolveTransaction Strategy 1: choice=2, idx=1 → _candidates[1] = {id: 'uuid', amount: 8000, category: 'Comida', ...}
  → handleDelete: DELETE from transactions WHERE id='uuid' AND user_id=...
  → success: { data: { operation: 'delete', deleted: { ... $8.000 in Comida ... } } }
  → Phase B: "Eliminado: $8.000 en Comida."
  → pending cleared (toolCall.name === pending.tool)
```

### Key: _candidates stores full objects

The `_candidates` array in `collectedArgs` contains the **full transaction objects** — `{id, amount, category, description, posted_at}`. This means:
- No DB query needed in round 2 for disambiguation resolution
- If Redis expires (10min TTL), the candidates are lost and user has to start over
- `_candidates` is an **internal field** — it's not in the schema and the AI never generates it

---

## Slot-Fill Lifecycle: Edit Missing Changes

When the AI calls `manage_transactions` with `operation=edit` but doesn't specify any `new_*` fields.

```
User: "cambia el último gasto"
  → Phase A: manage_transactions { operation: 'edit' }
  → handleEdit: no new_* fields → slot-fill
  → "¿Qué quieres cambiar? Puedes modificar el monto, categoría, descripción o fecha."
  → pending: { collectedArgs: { operation: 'edit' }, missingArgs: ['new_amount', 'new_category', 'new_description', 'new_posted_at'] }

User: "el monto a 20 lucas"
  → Phase A (with pending): manage_transactions { operation: 'edit', new_amount: 20000 }
  → handleEdit: new_amount=20000 → resolveTransaction (no hints → most recent) → UPDATE → success
```

---

## Slot-Fill Lifecycle: Edit Category Mismatch

When the user provides a `new_category` that doesn't match any of their categories.

```
User: "cambia la categoría del último gasto a gimnasio"
  → Phase A: manage_transactions { operation: 'edit', new_category: 'gimnasio' }
  → handleEdit: resolves most recent transaction (tx.id = 'abc-123')
  → findBestCategoryMatch("gimnasio", [...]) → null
  → "No encontré la categoría 'gimnasio'. Elige una:\n• Alimentación\n• Transporte\n• Salud..."
  → pending: {
      collectedArgs: { operation: 'edit', transaction_id: 'abc-123' },
      missingArgs: ['new_category']
    }

User: "Salud"
  → Phase A (with pending): manage_transactions { operation: 'edit', transaction_id: 'abc-123', new_category: 'Salud' }
  → handleEdit: resolves by ID (Strategy 2, fast) → matches "Salud" → UPDATE → success
```

**Note:** The pending saves `transaction_id: tx.id` (the resolved UUID), so the next round skips hint-based resolution entirely and goes straight to Strategy 2 (ID lookup).

---

## Stub Mode (Offline Fallback)

When AI service is unavailable, `OrchestratorClient` has stub handlers.

### stubPhaseA patterns (orchestrator.client.ts)

**Pending disambiguation** (lines 423-435):
```typescript
if (pending && pending.tool === 'manage_transactions') {
  const collectedArgs = { ...pending.collected_args };
  const numMatch = text.match(/^(\d+)$/);
  if (numMatch) {
    collectedArgs['choice'] = parseInt(numMatch[1], 10);
    return { tool_call: { name: 'manage_transactions', args: collectedArgs } };
  }
}
```
- If user responds with just a number and there's a pending `manage_transactions`, completes the disambiguation

**List pattern** (lines 597-611):
```
/mis\s*(últimos?\s+)?gastos|ver\s*(mis\s+)?transacciones|historial|qué he gastado|últimas transacciones|mostrar\s*gastos/
→ { operation: 'list' }
```

**Delete pattern** (lines 613-634):
```
/borr|elimin|quita.*gasto|bórralo|elimínalo/
→ { operation: 'delete', hint_amount? }
```
- Optionally extracts `hint_amount` from the message (regex: `/(\d+(?:[.,]\d+)?)\s*(?:lucas?|pesos?|clp)?/i`)
- Handles "lucas" multiplier

**Edit pattern** (lines 636-661):
```
/cambi|modific|correg|edit|actualiz.*(?:gasto|transacci)|no\s+eran|en\s+realidad\s+eran/
→ { operation: 'edit', new_amount? }
```
- Optionally extracts `new_amount` from the message

### stubPhaseB (orchestrator.client.ts lines 837-905)

Generates formatted responses without AI:

- **list:** Numbered list with CLP format, or "No tienes gastos registrados."
- **delete:** `"Eliminado: $15.000 en Comida."`
- **edit:** `"Listo, cambié monto de $15.000 a $20.000."` — uses `changes[]` array to build human-readable change list
- **fallback:** `"Procesado correctamente."` if data is missing

---

## AI Summary Generation (orchestrator.py)

`_summarize_action()` in the AI service generates conversation summaries based on the tool result (orchestrator.py lines 500-516):

| Operation | Summary |
|-----------|---------|
| `list` | `"Listó sus últimas {count} transacciones."` |
| `edit` | `"Editó transacción de ${amount} ({changes joined})."` |
| `delete` | `"Eliminó transacción de ${amount} en {category}."` |
| fallback | `"Gestionó transacciones ({operation})."` |

These summaries are stored in Redis (`conv:{userId}:summary`) and sent to Phase B in subsequent requests as part of `RuntimeContext.summary`.

---

## Message Flows

### List transactions

```
User: "mis últimos gastos"
  → Phase A: tool_call { name: 'manage_transactions', args: { operation: 'list' } }
  → Guardrails: operation='list' ✓
  → handleList: SELECT last 5 transactions
  → return { data: { operation: 'list', transactions: [...], count: 5 } }
  → Phase B: generates formatted transaction list
```

### List with custom limit

```
User: "muéstrame los últimos 10 gastos"
  → Phase A: tool_call { args: { operation: 'list', limit: 10 } }
  → handleList: limit=10 → SELECT last 10
```

### Delete most recent (no hints)

```
User: "borra el último gasto"
  → Phase A: tool_call { args: { operation: 'delete' } }
  → resolveTransaction: no hints → normalized[0] (most recent)
  → DELETE → success
  → Phase B: "Eliminado: $15.000 en Comida."
```

### Delete by amount hint

```
User: "elimina el gasto de 15 lucas"
  → Phase A: tool_call { args: { operation: 'delete', hint_amount: 15000 } }
  → resolveTransaction: tolerance = max(15000*0.05, 100) = 750 → matches 14250-15750
  → 1 match → DELETE → success
```

### Delete with disambiguation

```
User: "elimina el gasto de comida"
  → Phase A: tool_call { args: { operation: 'delete', hint_category: 'comida' } }
  → resolveTransaction: finds 3 matches → disambiguation
  → "Encontré 3 transacciones:\n1. $15.000 en Comida...\n2. $8.000 en Comida...\n¿Cuál?"
  → pending saved

User: "1"
  → Phase A merges → { operation: 'delete', _candidates: [...], choice: 1 }
  → Strategy 1: _candidates[0] → DELETE → success
```

### Edit amount (correction pattern)

```
User: "no eran 15 lucas, eran 10"
  → Phase A: tool_call { args: { operation: 'edit', hint_amount: 15000, new_amount: 10000 } }
  → resolveTransaction: hint_amount=15000, tolerance=750 → finds the $15.000 transaction
  → handleEdit: UPDATE amount=10000, changes=['monto']
  → Phase B: "Listo, cambié el monto de $15.000 a $10.000."
```

### Edit category

```
User: "era transporte, no comida"
  → Phase A: tool_call { args: { operation: 'edit', hint_category: 'comida', new_category: 'transporte' } }
  → resolveTransaction: hint_category='comida' → finds match
  → handleEdit: findBestCategoryMatch('transporte') → matched → UPDATE category_id, changes=['categoría']
  → Phase B: "Listo, cambié la categoría de Comida a Transporte."
```

### Edit with disambiguation then category mismatch

```
User: "cambia la categoría del gasto de comida a gym"
  → Phase A: { operation: 'edit', hint_category: 'comida', new_category: 'gym' }
  → resolveTransaction: 2 matches → disambiguation
  → pending: { operation: 'edit', _candidates: [...], new_category: 'gym' }

User: "1"
  → resolves tx → handleEdit: findBestCategoryMatch('gym') → null
  → "No encontré la categoría 'gym'. Elige una:\n• Alimentación\n..."
  → pending: { operation: 'edit', transaction_id: 'uuid', missingArgs: ['new_category'] }

User: "Salud"
  → resolves by ID → findBestCategoryMatch('salud') → matched → UPDATE → success
```

### No transactions registered

```
User: "mis gastos"
  → handleList → SELECT → empty result
  → return { data: { operation: 'list', transactions: [], count: 0 } }
  → Phase B: generates "no transactions" message
```

### User has no transactions (delete)

```
User: "borra el último gasto"
  → resolveTransaction: SELECT last 30 → empty
  → "No tienes transacciones registradas."
```

---

## Key Design Decisions

1. **Single handler for 3 operations** — list, edit, delete are grouped because they all operate on existing transactions. This keeps the tool count low (7 total) which reduces Phase A decision complexity.

2. **Hint-based resolution over ID** — Users rarely know transaction UUIDs. The hint system (amount, category, description) with fuzzy matching lets users say "borra el gasto de 15 lucas en comida" naturally.

3. **No delete confirmation** — Phase A prompt explicitly says "NUNCA pidas confirmación para borrar". The UX choice is speed over safety. Deleted transactions are gone permanently.

4. **Disambiguation caps at 5** — Even if 20 transactions match, only 5 are shown. This keeps the message readable and prevents Telegram message length limits from being hit.

5. **`_candidates` stores full objects** — The disambiguation round stores the complete transaction data in Redis via `collectedArgs._candidates`. This avoids a second DB query when the user picks a number, but trades off Redis memory.

6. **Amount tolerance: 5% or $100 minimum** — The `Math.max(hint_amount * 0.05, 100)` formula balances precision for large amounts (5% window) with flexibility for small amounts ($100 floor).

7. **Edit preserves previous state** — The `previous`/`updated` pair in the response enables Phase B to show a before/after comparison: "Cambié el monto de $15.000 a $20.000".

8. **Category matching duplicated** — `findBestCategoryMatch()` and `isSimilarString()` are copied from `register-transaction.tool-handler.ts` (line 548 comment: "duplicated from register-transaction for OCP"). Deliberate duplication to keep handlers independently testable.

9. **Re-fetch after edit** — After UPDATE, the handler does a second SELECT to get the post-update state including resolved category name via join. If the re-fetch fails, it falls back to pre-update values via `??` — the update itself already succeeded.

10. **No metrics recording** — Unlike `register_transaction`, edits and deletes don't affect streak days or week transaction count. Only new registrations count.

11. **Edit slot-fill preserves resolved ID** — When category mismatch occurs during edit, the pending saves `transaction_id: tx.id` (not the original hints). This means the next round resolves instantly via Strategy 2 (ID lookup) instead of re-running hint search.

12. **List includes payment_method** — The list operation joins `payment_method(name)` which edit/delete don't. This gives users more context when reviewing their transactions.
