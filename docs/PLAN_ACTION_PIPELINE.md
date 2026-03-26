# Plan: Action Pipeline — Rediseño del flujo de conversación

_Creado: 2026-03-17_

## Contexto

El sistema actual procesa **1 acción por mensaje**. Si el usuario pide múltiples cosas ("gasté 5190 en comida y 2100 en lime"), solo se ejecuta la primera. Además, cuando Phase A usa `clarification` en vez de `tool_call`, los datos extraídos se pierden (no se guarda pending). Phase B a veces genera respuestas que no reflejan lo que realmente se ejecutó.

La competencia (WhatsApp bots financieros) procesa N transacciones de 1 mensaje, envía confirmaciones separadas con detalle rico, y ofrece botones de acción por transacción.

## Objetivos

1. Phase A extrae TODA la información posible de un mensaje (N acciones, **máximo 3**)
2. El backend ejecuta cada acción ordenadamente en un bloque
3. Cada acción tiene su propia confirmación como mensaje separado
4. Botón de "Deshacer" por acción (cross-platform)
5. Si falta info, se junta todo primero y se ejecuta cuando esté completo
6. Phase B se mantiene encapsulado — solo genera el cierre con personalidad
7. Sistema de abandono lógico (no infinite loops)
8. **Límite de 3 acciones por bloque** — si se detecta una 4ta, responder "Solo puedo procesar 3 acciones a la vez"

---

## Arquitectura

```
User message
    ↓
┌─────────────────────────────────┐
│         PHASE A (Gemini)         │
│  Extrae N actions del mensaje    │
│  Clasifica: ready / needs_info   │
│  Detecta dependencias            │
│  Devuelve: { actions: [...] }    │
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│     ACTION PLANNER (backend)     │
│  Recibe lista de items           │
│  Ordena por dependencias         │
│  Ejecuta ready secuencialmente   │
│  Guarda needs_info como pending  │
│  Controla abandono (attempts)    │
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│    RESPONSE BUILDER (backend)    │
│  Por cada item ejecutado:        │
│   → Template de confirmación     │
│   → Botón "Deshacer" (optional)  │
│  Items pendientes:               │
│   → Pregunta estructurada        │
│  Cierre:                         │
│   → Phase B (personalidad)       │
│  Retorna: BotReply[]             │
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│   ADAPTERS (Telegram/WhatsApp)   │
│  Envía cada BotReply como        │
│  mensaje separado                │
│  Renderiza botones según canal   │
└──────────────┬──────────────────┘
               ↓
┌─────────────────────────────────┐
│    CALLBACK HANDLER (backend)    │
│  Recibe button presses           │
│  Parsea action + id              │
│  Ejecuta handler correspondiente │
│  Edita/responde mensaje          │
└─────────────────────────────────┘
```

---

## El concepto: Bloques de trabajo

Un **bloque** es una sesión de trabajo que se abre cuando el usuario pide cosas y **no se cierra hasta que todas se resolvieron** (ejecutadas o abandonadas).

### Ejemplo visual

```
User: "gasté 5190 en comida y 2100 en lime, puedes ver mi balance?"

Phase A extrae 3 items:
  ┌─────────────────────────────────────────────────────────┐
  │ BLOQUE #1                                               │
  │                                                         │
  │ [1] register_transaction $5.190 Alimentación  ✅ ready   │
  │ [2] register_transaction $2.100 Lime          ❓ needs:  │
  │     category                                            │
  │ [3] ask_balance                               ✅ ready   │
  └─────────────────────────────────────────────────────────┘

Pipeline:
  → Ejecuta [1] → "✅ $5.190 en Alimentación"
  → Ejecuta [3] → "💰 Balance: $485.000"
  → Pregunta [2] → "$2.100 en Lime — ¿categoría?"
  → BLOQUE ABIERTO (1 item pendiente)

User: "transporte"
  → Completa [2] → ejecuta → "✅ $2.100 en Transporte"
  → BLOQUE CERRADO → Phase B: "¿Algo más?"
```

### Tipos de items en un bloque

```
┌────────┬──────────────────────────────────────┬────────────────────────────────────┐
│  Tipo  │              Ejemplos                │          Comportamiento            │
├────────┼──────────────────────────────────────┼────────────────────────────────────┤
│ action │ register_transaction,                │ Necesita ejecución, puede tener    │
│        │ manage_categories,                   │ pending. Es el core del bloque.    │
│        │ manage_transactions                  │                                    │
├────────┼──────────────────────────────────────┼────────────────────────────────────┤
│ query  │ ask_balance, ask_budget_status,      │ Ejecuta inmediatamente, no         │
│        │ ask_goal_status                      │ bloquea. Respuesta informativa.    │
├────────┼──────────────────────────────────────┼────────────────────────────────────┤
│ quick  │ greeting, ask_app_info,              │ Respuesta rápida, no entra al      │
│        │ "puedes?" (retórico)                 │ bloque. Se resuelve inline.        │
├────────┼──────────────────────────────────────┼────────────────────────────────────┤
│ direct │ fuera de dominio, chistes,           │ Phase A responde directo sin       │
│        │ temas no financieros                 │ abrir bloque.                      │
└────────┴──────────────────────────────────────┴────────────────────────────────────┘
```

### Ciclo de vida del bloque

```
         ┌──────────┐
         │  ABRIR   │ ← User envía mensaje con 1+ intents
         └────┬─────┘
              ↓
         ┌──────────┐
    ┌───→│ PROCESAR  │ ← Ejecutar ready, preguntar needs_info
    │    └────┬─────┘
    │         ↓
    │    ¿Todo resuelto?
    │    ├─ SÍ → CERRAR → Phase B → "¿Algo más?"
    │    │
    │    └─ NO → hay items needs_info
    │         ↓
    │    ┌──────────┐
    │    │ ESPERANDO │ ← User responde
    │    └────┬─────┘
    │         ↓
    │    Phase A actualiza items con nueva info
    │         ↓
    │    ¿Item preguntado 2+ veces sin respuesta?
    │    ├─ SÍ → ABANDONAR item → nota breve
    │    └─ NO → volver a PROCESAR
    └─────────┘
```

### Reglas de abandono (no infinite loop)

```
┌───────────────────────────────────────┬─────────────────────────────────────────────┐
│              Condición                │                   Acción                    │
├───────────────────────────────────────┼─────────────────────────────────────────────┤
│ Item preguntado 2 veces sin respuesta │ Auto-abandonar: "Dejé pendiente lo de      │
│                                       │ $2.100 en Lime"                             │
├───────────────────────────────────────┼─────────────────────────────────────────────┤
│ Usuario dice "cancela" / "olvídalo"   │ Abandonar item específico o todo el bloque  │
│ / "no"                                │                                             │
├───────────────────────────────────────┼─────────────────────────────────────────────┤
│ Usuario cambia de tema completamente  │ Abandonar bloque actual, abrir nuevo        │
├───────────────────────────────────────┼─────────────────────────────────────────────┤
│ Timeout 10 minutos (TTL Redis)        │ Abandonar todo silenciosamente              │
├───────────────────────────────────────┼─────────────────────────────────────────────┤
│ Usuario dice "sí" / "dale" / "todo    │ Ejecutar todo lo que esté ready             │
│ bien"                                 │                                             │
└───────────────────────────────────────┴─────────────────────────────────────────────┘
```

### Ejemplo completo: flujo con abandono parcial

```
User: "gasté 5 lucas en comida, 2100 en lime y 800 en algo"

BLOQUE:
  [1] $5.000 Alimentación     ✅ ready
  [2] $2.100 Lime             ❓ needs: category
  [3] $800 ???                ❓ needs: category

Respuesta turno 1:
  "✅ $5.000 en Alimentación"
  "Tengo 2 gastos más:
   • $2.100 en Lime — ¿categoría?
   • $800 — ¿categoría?"

User: "lime es transporte"
  → Completa [2]
  → [3] aún pendiente (attempts: 1)

Respuesta turno 2:
  "✅ $2.100 en Transporte"
  "¿Y los $800, en qué categoría?"

User: "olvídalo"
  → Abandona [3]

Respuesta turno 3:
  "Listo, dejé los $800 sin registrar. ¿Algo más?"
  → BLOQUE CERRADO
```

### Ejemplo: pregunta retórica ("puedes?")

```
User: "registra 5 lucas en comida, puedes?"

Phase A:
  items: [
    {tool: "register_transaction", args: {amount: 5000, category: "Alimentación"}, status: "ready"}
  ]
  // "puedes?" es retórico — Phase A lo ignora, la ejecución misma es la respuesta

→ Ejecuta → "✅ $5.000 en Alimentación"
→ BLOQUE CERRADO (1 item, ya resuelto)
```

### Ejemplo: consulta + acción en un mensaje

```
User: "cuánto llevo gastado? y agrega 3 lucas en uber"

Phase A:
  items: [
    {tool: "ask_balance", type: "query", status: "ready"},
    {tool: "register_transaction", args: {amount: 3000, category: "Transporte"}, status: "ready"}
  ]

→ Ejecuta ask_balance → "💰 Balance: $485.000, gastos del mes: $120.000"
→ Ejecuta register_transaction → "✅ $3.000 en Transporte"
→ BLOQUE CERRADO → Phase B: "¿Algo más?"
```

### Ejemplo: crear categoría + registrar (dependencia entre items)

```
User: "crea categoría ocio y agrega 5 lucas ahí"

Phase A:
  items: [
    {id:1, tool: "manage_categories", args: {operation: "create", name: "Ocio"},
     status: "ready", order: 1},
    {id:2, tool: "register_transaction", args: {amount: 5000, category: "Ocio"},
     status: "depends_on", dependsOn: 1, order: 2}
  ]

Pipeline detecta dependencia:
  → Ejecuta [1] primero → "✅ Categoría Ocio creada"
  → Ahora [2] pasa a ready → ejecuta → "✅ $5.000 en Ocio"
  → BLOQUE CERRADO
```

### Dónde vive cada cosa (responsabilidades)

```
┌─────────────────────────────────────────┐
│           PHASE A (Gemini)               │
│  • Extrae TODOS los items del mensaje    │
│  • Clasifica: ready / needs_info         │
│  • Detecta dependencias entre items      │
│  • Máxima extracción de datos posible    │
│  • Devuelve: { actions: [...] }          │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│        ACTION PLANNER (backend)          │
│  • Recibe lista de items                 │
│  • Ordena por dependencias               │
│  • Ejecuta ready secuencialmente         │
│  • Guarda needs_info como pending        │
│  • Genera confirmaciones (TEMPLATE)      │
│  • Controla abandono (attempts, timeout) │
│  • Retorna BotReply[] de mensajes        │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│       PHASE B (OpenAI) — SIN CAMBIOS     │
│  • Recibe resumen de lo ejecutado        │
│  • Genera SOLO el cierre con personalidad│
│  • 1 mensaje: "¿Algo más?" con tono     │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│     ADAPTERS (Telegram/WhatsApp)         │
│  • Recibe BotReply[] de mensajes         │
│  • Envía cada uno como mensaje separado  │
│  • Renderiza botones según plataforma    │
│  • Formato rico (bold, monospace, emoji) │
└─────────────────────────────────────────┘
```

### Confirmaciones son templates deterministas, no IA

```typescript
const CONFIRMATION_TEMPLATES = {
  register_transaction: (data) =>
    `✅ *$${formatCLP(data.amount)}* — ${data.name || 'Gasto'}\n` +
    `${data.categoryIcon || ''} ${data.category || 'Sin categoría'} · ${formatDate(data.posted_at)}`,

  manage_categories_create: (data) =>
    `✅ Categoría *${data.name}* creada`,

  ask_balance: (data) =>
    `💰 Balance: *$${formatCLP(data.totalBalance)}*\n` +
    `Gastos del mes: $${formatCLP(data.totalSpent)}`,
}
```

Rápido, determinista, sin costo de API, sin riesgo de que la IA diga algo incorrecto.
Phase B **solo genera el cierre**: "¿Algo más?" adaptado al tono del usuario.

### Debug por bloque

Cada acción del bloque se loguea individualmente:

```
[block:open] cid=abc123 | 3 items extracted
[item:1] register_transaction {5000, Alimentación} → status: ready
[item:2] register_transaction {2100, Lime} → status: needs_info (category)
[item:3] ask_balance → status: ready

[item:1] EXECUTING → ✅ OK (tx_id: abc-123, 363ms)
[item:3] EXECUTING → ✅ OK (balance: 485000, 210ms)
[item:2] WAITING → attempt 1, asking for category

[block:status] 2/3 executed, 1/3 pending

--- next turn ---

[block:resume] cid=def456 | resuming block with 1 pending
[item:2] USER RESPONDED "transporte" → status: ready
[item:2] EXECUTING → ✅ OK (tx_id: def-456, 340ms)

[block:closed] 3/3 resolved | total time: 2 turns
[phase-b] generating follow-up → "¿Algo más?"
```

### Tabla de cambios para el sistema de bloques

```
┌──────────────────────┬─────────────────────────┬───────────────────────────────────┐
│      Componente      │      Estado actual       │        Cambio necesario           │
├──────────────────────┼─────────────────────────┼───────────────────────────────────┤
│ Phase A prompt       │ 1 tool_call              │ N actions con status y            │
│                      │                          │ dependencias                      │
├──────────────────────┼─────────────────────────┼───────────────────────────────────┤
│ Phase A schema       │ tool_call: {name, args}  │ actions: [{tool, args, status,    │
│                      │                          │ missing}]                         │
├──────────────────────┼─────────────────────────┼───────────────────────────────────┤
│ bot.service.ts       │ 1 handler → 1 response   │ Action Planner loop → BotReply[]  │
├──────────────────────┼─────────────────────────┼───────────────────────────────────┤
│ conversation.service │ pending = 1 action       │ pending = ActionBlock con N items │
├──────────────────────┼─────────────────────────┼───────────────────────────────────┤
│ bot.controller       │ sendReply(msg, reply)    │ for (reply of replies)            │
│                      │                          │ sendReply(msg, reply)             │
├──────────────────────┼─────────────────────────┼───────────────────────────────────┤
│ Confirmaciones       │ Phase B genera todo      │ Templates deterministas en        │
│                      │                          │ backend                           │
├──────────────────────┼─────────────────────────┼───────────────────────────────────┤
│ Phase B              │ Genera respuesta         │ Solo genera cierre con            │
│                      │ completa                 │ personalidad                      │
├──────────────────────┼─────────────────────────┼───────────────────────────────────┤
│ Adapters             │ 1 mensaje                │ N mensajes (se llaman N veces)    │
└──────────────────────┴─────────────────────────┴───────────────────────────────────┘
```

---

## Modelo de datos

### BotReply (lo que retorna el pipeline)

```typescript
interface BotReply {
  text: string;
  buttons?: BotButton[];
  parseMode?: 'MarkdownV2' | 'HTML';
}

interface BotButton {
  text: string;           // "↩️ Deshacer"
  callbackData: string;   // "undo:tx:abc-123"
  expiresIn?: number;     // 60 (seconds) — solo Telegram puede hacer timeout
}
```

### ActionItem (lo que Phase A devuelve)

```typescript
interface ActionItem {
  id: number;
  tool: string;
  args: Record<string, any>;
  status: 'ready' | 'needs_info' | 'depends_on';
  missing?: string[];
  question?: string;
  dependsOn?: number;     // id de otra acción que debe ejecutarse primero
}
```

### ActionBlock (estado persistido en Redis)

```typescript
interface ActionBlock {
  items: ActionItem[];
  createdAt: string;
  maxAttempts: number;    // 2 — después se abandona el item
}
```

---

## Phase A — Nuevo formato de respuesta

### Output actual
```json
{
  "response_type": "tool_call",
  "tool_call": { "name": "register_transaction", "args": { "amount": 5190, "category": "Alimentación" } }
}
```

### Output nuevo
```json
{
  "response_type": "actions",
  "actions": [
    {
      "id": 1,
      "tool": "register_transaction",
      "args": { "amount": 5190, "category": "Alimentación", "name": "Comida", "type": "expense" },
      "status": "ready"
    },
    {
      "id": 2,
      "tool": "register_transaction",
      "args": { "amount": 2100, "name": "Lime", "type": "expense" },
      "status": "needs_info",
      "missing": ["category"],
      "question": "¿$2.100 en Lime, en qué categoría?"
    }
  ]
}
```

### Backward compatible

- `response_type: "direct_reply"` y `"clarification"` se mantienen para saludos y fuera de dominio
- `response_type: "tool_call"` sigue funcionando para 1 acción simple (legacy)
- `response_type: "actions"` es el nuevo formato para N acciones

---

## Tipos de items

| Tipo | Ejemplos | Comportamiento |
|------|----------|---------------|
| **action** | register_transaction, manage_categories | Necesita ejecución, puede tener pending |
| **query** | ask_balance, ask_budget_status, ask_goal_status | Ejecuta inmediatamente, no bloquea |
| **quick** | greeting, ask_app_info | Respuesta rápida, no entra al bloque |
| **direct** | fuera de dominio | Phase A responde directo |

---

## Ciclo de vida del bloque

```
         ┌──────────┐
         │  ABRIR   │ ← User envía mensaje con 1+ intents
         └────┬─────┘
              ↓
         ┌──────────┐
    ┌───→│ PROCESAR  │ ← Ejecutar ready, preguntar needs_info
    │    └────┬─────┘
    │         ↓
    │    ¿Todo resuelto?
    │    ├─ SÍ → CERRAR → Phase B → "¿Algo más?"
    │    │
    │    └─ NO → hay items needs_info
    │         ↓
    │    ┌──────────┐
    │    │ ESPERANDO │ ← User responde
    │    └────┬─────┘
    │         ↓
    │    Phase A actualiza items con nueva info
    │         ↓
    │    ¿Item preguntado 2+ veces sin respuesta?
    │    ├─ SÍ → ABANDONAR item
    │    └─ NO → volver a PROCESAR
    └─────────┘
```

### Reglas de abandono

| Condición | Acción |
|-----------|--------|
| Item preguntado 2 veces sin respuesta | Auto-abandonar con nota |
| Usuario dice "cancela" / "olvídalo" / "no" | Abandonar item o bloque |
| Usuario cambia de tema completamente | Abandonar bloque, abrir nuevo |
| Timeout 10 minutos (TTL Redis) | Abandonar silenciosamente |

---

## Ejemplos de flujo

### Ejemplo 1: Todo listo
```
User: "5 lucas en comida y 10 en uber"

Phase A:
  actions: [
    {id:1, tool: register_transaction, args: {amount:5000, category:"Alimentación"}, status: ready},
    {id:2, tool: register_transaction, args: {amount:10000, category:"Transporte"}, status: ready}
  ]

Pipeline: ejecuta ambas

Mensajes:
  1. "✅ *$5.000* — Comida\n🍽️ Alimentación · 17/03"  [↩️ Deshacer]
  2. "✅ *$10.000* — Uber\n🚗 Transporte · 17/03"  [↩️ Deshacer]
  3. "¿Algo más?" (Phase B con tono)
```

### Ejemplo 2: Uno necesita info
```
User: "gasté 5190 en comida y 2100 en lime"

Phase A:
  actions: [
    {id:1, args: {amount:5190, category:"Alimentación"}, status: ready},
    {id:2, args: {amount:2100, name:"Lime"}, status: needs_info, missing:["category"]}
  ]

Pipeline: ejecuta [1], pregunta por [2]

Mensajes:
  1. "✅ *$5.190* — Comida\n🍽️ Alimentación · 17/03"  [↩️ Deshacer]
  2. "$2.100 en Lime — ¿en qué categoría?"

User: "transporte"

Pipeline: completa [2], ejecuta

Mensajes:
  1. "✅ *$2.100* — Lime\n🚗 Transporte · 17/03"  [↩️ Deshacer]
  2. "¿Algo más?" (Phase B)
```

### Ejemplo 3: Crear categoría + registrar (dependencia)
```
User: "crea categoría ocio y agrega 5 lucas ahí"

Phase A:
  actions: [
    {id:1, tool: manage_categories, args: {operation:"create", name:"Ocio"}, status: ready},
    {id:2, tool: register_transaction, args: {amount:5000, category:"Ocio"}, status: depends_on, dependsOn: 1}
  ]

Pipeline: ejecuta [1] → [2] se desbloquea → ejecuta [2]

Mensajes:
  1. "✅ Categoría *Ocio* creada"
  2. "✅ *$5.000* — Gasto\n🎉 Ocio · 17/03"  [↩️ Deshacer]
  3. "¿Algo más?" (Phase B)
```

### Ejemplo 4: Consulta + acción
```
User: "cuánto llevo gastado? y agrega 3 lucas en uber"

Phase A:
  actions: [
    {id:1, tool: ask_balance, status: ready},
    {id:2, tool: register_transaction, args: {amount:3000, category:"Transporte"}, status: ready}
  ]

Pipeline: ejecuta ambas

Mensajes:
  1. "💰 Balance: *$485.000* · Gastos del mes: $120.000"
  2. "✅ *$3.000* — Uber\n🚗 Transporte · 17/03"  [↩️ Deshacer]
  3. "¿Algo más?" (Phase B)
```

### Ejemplo 5: Usuario cancela una
```
User: "5 lucas en comida y algo en lime"

Phase A:
  actions: [
    {id:1, args: {amount:5000, category:"Alimentación"}, status: ready},
    {id:2, args: {name:"Lime"}, status: needs_info, missing:["amount","category"]}
  ]

Mensajes turno 1:
  1. "✅ *$5.000* — Comida\n🍽️ Alimentación · 17/03"  [↩️ Deshacer]
  2. "Lime — ¿cuánto y en qué categoría?"

User: "olvídalo"

Pipeline: abandona [2]

Mensajes:
  1. "Listo, dejé lo de Lime sin registrar. ¿Algo más?"
```

### Ejemplo 6: Pregunta retórica + acción
```
User: "registra 5 lucas en comida, puedes?"

Phase A: (interpreta "puedes?" como retórico, no como ask_app_info)
  actions: [
    {id:1, tool: register_transaction, args: {amount:5000, category:"Alimentación"}, status: ready}
  ]

Pipeline: ejecuta

Mensajes:
  1. "✅ *$5.000* — Comida\n🍽️ Alimentación · 17/03"  [↩️ Deshacer]
  2. "¿Algo más?" (Phase B)
```

---

## Confirmaciones: Templates, no IA

Las confirmaciones de acciones son **templates deterministas** en el backend:

```typescript
const CONFIRMATION_TEMPLATES = {
  register_transaction: (data) =>
    `✅ *$${formatCLP(data.amount)}* — ${data.name || 'Gasto'}\n` +
    `${data.categoryIcon || ''} ${data.category || 'Sin categoría'} · ${formatDate(data.posted_at)}`,

  register_transaction_income: (data) =>
    `✅ *$${formatCLP(data.amount)}* — ${data.name || 'Ingreso'}\n` +
    `💰 Ingreso · ${formatDate(data.posted_at)}`,

  manage_categories_create: (data) =>
    `✅ Categoría *${data.name}* creada`,

  manage_categories_rename: (data) =>
    `✅ *${data.old_name}* → *${data.new_name}*`,

  manage_categories_delete: (data) =>
    `🗑️ Categoría *${data.name}* eliminada` +
    (data.transactionsAffected > 0 ? ` (${data.transactionsAffected} transacciones desvinculadas)` : ''),

  ask_balance: (data) =>
    `💰 Balance: *$${formatCLP(data.totalBalance)}*\n` +
    `Gastos del mes: $${formatCLP(data.totalSpent)}` +
    (data.totalIncome > 0 ? ` · Ingresos: $${formatCLP(data.totalIncome)}` : ''),

  ask_budget_status: (data) =>
    `📊 Presupuesto ${data.period}: *$${formatCLP(data.amount)}*\n` +
    `Restante: $${formatCLP(data.remaining)}`,

  ask_goal_status: (data) =>
    data.goals.map(g =>
      `🎯 *${g.name}*: ${g.percentage}% ($${formatCLP(g.progress_amount)} de $${formatCLP(g.target_amount)})`
    ).join('\n'),

  manage_transactions_list: (data) =>
    data.transactions.map((tx, i) =>
      `${i+1}. *$${formatCLP(tx.amount)}* — ${tx.name || tx.category} · ${formatDate(tx.posted_at)}`
    ).join('\n'),

  manage_transactions_edit: (data) =>
    `✏️ Editado: ${data.changes.join(', ')}`,

  manage_transactions_delete: (data) =>
    `🗑️ Eliminé *$${formatCLP(data.deleted.amount)}* en ${data.deleted.category}`,
}
```

**Ventajas**: rápido, determinista, sin costo de API, sin riesgo de que la IA diga algo incorrecto.

Phase B **solo genera el cierre**: "¿Algo más?" adaptado al tono del usuario.

---

## Botón "Deshacer" — Cross-platform

### Estructura del botón

```typescript
interface BotButton {
  text: string;           // "↩️ Deshacer"
  callbackData: string;   // "undo:tx:abc-123"
  expiresIn?: number;     // 60 (seconds)
}
```

### Comportamiento por plataforma

| Plataforma | Renderizado | Timeout |
|------------|-------------|---------|
| Telegram | Inline keyboard debajo del mensaje | Sí — bot remueve botón después de 60s con `editMessageReplyMarkup` |
| WhatsApp | Interactive button (máx 3 por mensaje) | No — queda permanente, pero callback se invalida después de 60s en backend |
| Test/fallback | Sin botón — texto puro | N/A |

### Botones por tipo de acción

| Acción ejecutada | Botón |
|-----------------|-------|
| register_transaction (gasto/ingreso) | `[ ↩️ Deshacer ]` |
| manage_transactions edit | `[ ↩️ Revertir ]` |
| manage_transactions delete | `[ ↩️ Restaurar ]` |
| manage_categories create | `[ ↩️ Eliminar ]` |
| manage_categories delete | `[ ↩️ Restaurar ]` |
| manage_categories rename | `[ ↩️ Revertir ]` |
| Consultas (balance, budget, goals) | (sin botón) |
| Saludos y app_info | (sin botón) |

### Callback flow

```
User presiona [↩️ Deshacer] en tx abc-123
    ↓
Webhook recibe callback: "undo:tx:abc-123"
    ↓
CallbackHandler:
  → Verifica que no expiró (< 60s desde creación)
  → Ejecuta: delete transaction abc-123 + revert balance
  → Resultado OK
    ↓
Telegram: edita mensaje original:
  "↩️ ~$5.190 en Alimentación~ — Deshecho"
  (tachado + sin botones)

WhatsApp: envía nuevo mensaje:
  "↩️ Deshice el gasto de $5.190 en Alimentación"
```

---

## Handlers — Acciones completas por handler

| Handler | Operación | Post-acciones | Botón |
|---------|-----------|---------------|-------|
| **register_transaction** | Registrar gasto | Deshacer, Editar (por texto) | `↩️ Deshacer` |
| **register_transaction** | Registrar ingreso | Deshacer, Editar (por texto) | `↩️ Deshacer` |
| **manage_transactions** | list | Editar/Eliminar uno (por texto) | (sin botón) |
| **manage_transactions** | edit | Revertir | `↩️ Revertir` |
| **manage_transactions** | delete | Restaurar | `↩️ Restaurar` |
| **manage_categories** | list | Crear/Renombrar/Eliminar (por texto) | (sin botón) |
| **manage_categories** | create | Eliminar la categoría | `↩️ Eliminar` |
| **manage_categories** | create_and_register | Deshacer ambos | `↩️ Deshacer` |
| **manage_categories** | rename | Revertir nombre | `↩️ Revertir` |
| **manage_categories** | delete | Restaurar (si posible) | `↩️ Restaurar` |
| **ask_balance** | Consulta | — | (sin botón) |
| **ask_budget_status** | Consulta | — | (sin botón) |
| **ask_goal_status** | Consulta | — | (sin botón) |
| **ask_app_info** | Info estática | — | (sin botón) |
| **greeting** | Saludo | — | (sin botón) |

### Handlers que faltan (detectados)

| Handler faltante | Necesidad | Prioridad |
|-----------------|-----------|-----------|
| Crear meta (goal) | José Tomás intentó crear meta vía bot → falló | Alta |
| Abonar a meta | Sumar progreso a una meta existente | Media |
| Modificar presupuesto | Cambiar monto/período del budget | Media |
| Exportar datos | CSV/PDF de transacciones | Baja |

---

## Debug mejorado

Cada acción del bloque se loguea individualmente:

```
[block:open] cid=abc123 | 3 items extracted
[item:1] register_transaction {5000, Alimentación} → status: ready
[item:2] register_transaction {2100, Lime} → status: needs_info (category)
[item:3] ask_balance → status: ready

[item:1] EXECUTING → ✅ OK (tx_id: abc-123, 363ms)
[item:3] EXECUTING → ✅ OK (balance: 485000, 210ms)
[item:2] WAITING → attempt 1, asking for category

[block:status] 2/3 executed, 1/3 pending

--- next turn ---

[block:resume] cid=def456 | resuming block with 1 pending
[item:2] USER RESPONDED "transporte" → status: ready
[item:2] EXECUTING → ✅ OK (tx_id: def-456, 340ms)

[block:closed] 3/3 resolved | total time: 2 turns
[phase-b] generating follow-up → "¿Algo más?"
```

---

## Archivos a crear/modificar

### Nuevos

| Archivo | Propósito |
|---------|-----------|
| `action-planner.service.ts` | Orquesta ejecución de N actions, maneja dependencias y pending |
| `response-builder.service.ts` | Genera confirmaciones template + botones |
| `callback-handler.service.ts` | Procesa button callbacks (Deshacer/Revertir) |

### Modificar

| Archivo | Cambio |
|---------|--------|
| `phase_a_system.txt` | Nuevo formato `actions[]`, reglas de extracción máxima |
| `schemas.py` (AI service) | `ActionItem` model, response_type "actions" |
| `orchestrator.py` (AI service) | Parsear actions response |
| `orchestrator.contracts.ts` | `ActionItem[]`, `BotReply` types |
| `bot.service.ts` | Integrar Action Planner, retornar `BotReply[]` |
| `bot.controller.ts` | Loop de `sendReply`, endpoint para callbacks |
| `conversation.service.ts` | Pending guarda `ActionBlock` con N items |
| `telegram.adapter.ts` | `sendReplyWithButtons()`, callback handling, button timeout |
| `whatsapp.adapter.ts` | `sendInteractiveReply()` |

### Sin cambios

| Archivo | Por qué no cambia |
|---------|------------------|
| Phase B (orchestrator.py phase_b) | Solo genera cierre con personalidad |
| phase_b_system.txt | Recibe resumen, genera "¿Algo más?" |
| Handlers individuales | Siguen recibiendo args y devolviendo ActionResult |
| Guardrails | Sigue validando cada action individualmente |

---

## Límites y reglas del bloque

### Máximo 3 acciones por bloque

Si Phase A detecta más de 3 intents, procesa las primeras 3 y notifica:

```
User: "gasté 1000 en café, 5000 en almuerzo, 2000 en metro y 1500 en snack"

Phase A: extrae 4 actions → trunca a 3

actions: [
  {id:1, register_transaction, {amount:1000, category:"Alimentación"}, ready},
  {id:2, register_transaction, {amount:5000, category:"Alimentación"}, ready},
  {id:3, register_transaction, {amount:2000, category:"Transporte"}, ready}
]

Mensajes:
  1. "✅ *$1.000* — Café | 🍽️ Alimentación"
  2. "✅ *$5.000* — Almuerzo | 🍽️ Alimentación"
  3. "✅ *$2.000* — Metro | 🚗 Transporte"
  4. "Solo proceso 3 acciones a la vez. ¿Registro también $1.500 en snack?"
```

### Agrupación si >3 acciones del mismo tipo

Si el Planner recibe 3 acciones del mismo tipo (ej: 3 register_transaction), se agrupan en 1 mensaje resumen en vez de 3 separados:

```
✅ Registré 3 gastos:
  • $1.000 — Café | 🍽️ Alimentación
  • $5.000 — Almuerzo | 🍽️ Alimentación
  • $2.000 — Metro | 🚗 Transporte
Total: $8.000

[↩️ Deshacer todo]
```

Umbral: ≤2 acciones del mismo tipo → mensajes separados. 3 → agrupado.

---

## Casos borde

### 1. Dos items necesitan la misma clarificación
```
User: "gasté en comida y en uber"
Phase A: [
  {amount: ?, category: "Alimentación", needs_info: ["amount"]},
  {amount: ?, category: "Transporte", needs_info: ["amount"]}
]
Bot: "¿Cuánto en comida y cuánto en uber?"
User: "5 lucas"
→ ¿A cuál aplica?
```
**Solución**: Phase A recibe el bloque pendiente. Si el usuario da un solo número, pide especificar: "¿$5.000 para ambos o solo uno?". Si dice "5 y 10", asigna por orden.

### 2. Bloque abierto + usuario cambia de tema
```
Bloque: [{amount: 3000, needs_info: ["category"]}]
User: "oye cuánto llevo gastado?"
```
**Solución**: Phase A distingue:
- Si parece respuesta al pending → completar
- Si es intent nuevo → agregar al bloque como nuevo item, mantener pending
- Si es cambio de tema total → abandonar bloque

Un bloque puede **crecer** con nuevos items sin abandonar los pendientes.

### 3. Dependencia falla → items dependientes colgados
```
User: "crea categoría X y agrega 5 lucas ahí"
→ Crear X falla: "MAX_CATEGORIES (50)"
→ Item 2 depende de item 1 → ¿qué pasa?
```
**Solución**: Items dependientes se **auto-abandonan**: "No pude registrar $5.000 porque la categoría no se creó." Excepción: si el error es "ya existe" (dedup silencioso), la dependencia se considera cumplida.

### 4. Timeout del bloque + respuesta tardía
```
Bloque abierto → usuario espera 11 minutos → bloque expiró
User: "transporte" (respondiendo a categoría)
```
**Solución**: Bloque expirado = datos perdidos. Phase A usa history (si no expiró también) para reconstruir contexto parcialmente. Si no puede, trata como mensaje nuevo.

### 5. Mensajes rápidos consecutivos + lock
```
Mensaje 1: "5 lucas en comida" → procesando (lock activo)
Mensaje 2: "y 3 en uber" → lock rechaza → "Dame un momento..."
→ Intent del mensaje 2 se PIERDE
```
**Solución**: Cuando mensaje 2 llega después del lock, Phase A ve el bloque del mensaje 1 + el nuevo texto + history. Puede agregar el nuevo item al bloque. No se pierde si el usuario reenvía.

### 6. Undo de create_and_register
```
Bloque ejecutó: crear "Ocio" + registrar $5.000 en Ocio
User presiona [↩️ Deshacer]
```
**Solución**: Solo deshace la **transacción**. La categoría queda — el usuario la creó explícitamente. `callbackData` es `"undo:tx:abc-123"`, no incluye la categoría.

### 7. Saludo + acción en mismo mensaje
```
User: "hola, gasté 5 lucas en comida"
Phase A: [{greeting, quick}, {register_transaction, ready}]
→ 3 mensajes: saludo + confirmación + cierre → excesivo
```
**Solución**: Si hay `action` en el bloque, **ignorar greeting**. El template de confirmación ya es respuesta suficiente.

### 8. Audio referencia imagen de turno anterior
```
Turn 1: 📸 Foto de boleta → registra $5.190
Turn 2: 🎤 "y eso otro también" (algo de la foto)
```
**Solución**: No soportado sin persistencia de media (roadmap #27). Phase A usa history textual para inferir. Si no puede, pide clarificación.

### 9. Acción condicional
```
User: "si me queda más de 100 lucas, agrega 50 en ahorro"
```
**Solución**: Phase A no soporta condicionales. Ejecuta ambas (consulta + registro). El usuario puede deshacer después.

### 10. Slot-fill crea nuevo intent
```
Bloque: [{amount: 3000, needs_info: ["category"]}]
User: "crea la categoría Espacio"
```
**Solución**: Phase A convierte en dependencia explícita: [{create "Espacio", ready}, {register $3000 in "Espacio", depends_on: 1}]. El slot-fill se resuelve como parte del flujo de dependencias.

### 11. WhatsApp 3 botones limit
```
¿Queremos [Editar] [Eliminar] [Deshacer] por acción?
→ WhatsApp máximo 3 botones por mensaje
```
**Solución**: Solo 1 botón: `[↩️ Deshacer]`. Editar y eliminar por texto conversacional.

### Resumen de soluciones

| Caso | Solución |
|------|----------|
| 2 items misma clarificación | Phase A asigna por orden o pide especificar |
| Cambio de tema con bloque abierto | Nuevo item se agrega al bloque |
| Dependencia falla | Items dependientes auto-abandonados |
| Timeout 10 min | History reconstruye parcialmente |
| Mensajes rápidos + lock | Bloque crece en siguiente turno |
| Undo de create_and_register | Solo deshace transacción |
| Saludo + acción | Greeting ignorado si hay acción |
| Audio ref imagen previa | No soportado sin persistencia media |
| Acción condicional | No soportado, ejecuta ambas |
| Slot-fill → nuevo intent | Convierte en dependencia |
| WhatsApp 3 botones | Solo 1 botón (Deshacer) |
| >3 acciones | Trunca a 3, notifica el resto |

---

## Decisiones de diseño

### 1. Modelo de IA para Phase A: Gemini 2.5 Flash-Lite

Se mantiene Flash-Lite para multi-action. Es su caso de uso principal (clasificación, extracción). Si la calidad de extracción multi-action es insuficiente, se evalúa upgrade a Flash (más caro).

### 2. Phase B siempre se ejecuta

Phase B tiene la personalidad del bot (Gus). Siempre se llama, incluso si solo hay queries. El cierre con tono es parte de la identidad. No se omite.

### 3. Migración incremental (no corte de golpe)

Phase A puede devolver `tool_call` (viejo) o `actions[]` (nuevo). El backend detecta y enruta:

```typescript
if (phaseA.response_type === 'actions') {
  // Nuevo pipeline: Action Planner → templates → Phase B cierre
} else if (phaseA.response_type === 'tool_call') {
  // Pipeline actual: 1 handler → Phase B completo (fallback)
}
```

Permite deploy gradual y rollback sin riesgo. `direct_reply` y `clarification` siguen funcionando como hoy.

### 4. Testing: futuro

Tests unitarios del Action Planner se crean cuando se implemente. No bloquea el diseño.

### 5. Formato de mensajes: HTML

Se usa HTML (`<b>`, `<i>`) en vez de MarkdownV2. Razones:
- Telegram y WhatsApp soportan HTML básico
- No requiere escapar caracteres especiales (`.`, `-`, `$`, etc.)
- MarkdownV2 rompe con nombres como "Sr. Pizza" o montos como "$5.000"

```html
✅ <b>$5.000</b> — Comida
🍽️ Alimentación · 17/03
```

### 6. Message log: N filas por acción

Cada acción de un bloque genera su propia fila en `bot_message_log`:

```
| user_message | bot_response | tool_name | block_id |
|---|---|---|---|
| "5 lucas en comida y 2100 en lime" | "✅ $5.000 — Comida..." | register_transaction | block-abc |
| "5 lucas en comida y 2100 en lime" | "$2.100 en Lime — ¿categoría?" | register_transaction | block-abc |
```

Campo nuevo `block_id` para agrupar acciones del mismo bloque. `user_message` se repite en cada fila (es el mismo mensaje del usuario). Permite debug granular por acción.

### 7. Nudges como mensaje separado

Los nudges NO van dentro del cierre de Phase B. Van como mensaje independiente entre las confirmaciones y el cierre:

```
Mensaje 1: "✅ $5.000 — Comida | 🍽️ Alimentación"      ← template
Mensaje 2: "⚠️ Llevas el 85% del presupuesto mensual"   ← nudge (template)
Mensaje 3: "¿Algo más?"                                  ← Phase B cierre
```

El nudge es un template más, evaluado por el Planner después de ejecutar todas las acciones del bloque. Cooldowns se respetan (24h global, 5h budget).

### 8. History: reevaluar Redis Tier 1

El sistema actual de history (20 entradas, 10min TTL) necesita revisarse para bloques multi-acción:

**Qué guardar en history por bloque:**
- 1 entrada `user`: mensaje original del usuario
- 1 entrada `assistant`: resumen consolidado de todo lo que se hizo

```
{ role: "user", content: "5 lucas en comida y 2100 en lime" }
{ role: "assistant", content: "Registré $5.000 en Alimentación y $2.100 en Transporte" }
```

NO guardar cada confirmación individual — contamina el history y confunde a Phase A en turnos siguientes.

**Pendiente**: evaluar si el TTL de 10 minutos es suficiente para bloques multi-turno, y si la ventana de 20 entradas es adecuada.

### 9. Métricas, streaks y nudges: se evalúan al cerrar bloque

Todo se procesa **una sola vez al completar el bloque**, no por cada acción individual:

| Métrica | Cuándo se evalúa |
|---------|-----------------|
| Streak (días consecutivos) | +1 al cerrar bloque (si tiene ≥1 transacción) |
| Week tx count | +N al cerrar bloque (N = transacciones registradas) |
| Nudge de presupuesto | Evalúa % después de TODAS las transacciones del bloque |
| Nudge de streak | Evalúa streak después de actualizar |
| Cooldowns | Se registran al cerrar bloque, no por acción |
| Mood hint | Se calcula 1 vez con métricas finales del bloque |

**Razón**: si un bloque tiene 3 transacciones, no queremos 3 nudges de presupuesto ni incrementar el streak 3 veces. El bloque es la unidad atómica de trabajo.

---

## Plan de implementación detallado

---

### Fase 1: Tipos, contratos y Response Builder

**Objetivo**: Crear la base de tipos y el generador de mensajes template. No toca el flujo actual — solo agrega código nuevo.

**Archivos nuevos:**

| Archivo | Contenido |
|---------|-----------|
| `src/bot/actions/action-block.ts` | Interfaces `ActionItem`, `ActionBlock`, `BotReply`, `BotButton` |
| `src/bot/services/response-builder.service.ts` | Templates HTML de confirmación por tool + formatters CLP/fecha |

**Pasos técnicos:**

1. Crear `action-block.ts` con todos los tipos:
   ```typescript
   export type ActionStatus = 'ready' | 'needs_info' | 'depends_on' | 'executed' | 'failed' | 'abandoned';
   export type ItemType = 'action' | 'query' | 'quick' | 'direct';

   export interface ActionItem {
     id: number;
     tool: string;
     type: ItemType;
     args: Record<string, any>;
     status: ActionStatus;
     missing?: string[];
     question?: string;
     dependsOn?: number;
     result?: ActionResult;
     attempts: number;
   }

   export interface ActionBlock {
     id: string;
     items: ActionItem[];
     createdAt: string;
     maxAttempts: number;  // 2
     maxItems: number;     // 3
   }

   export interface BotReply {
     text: string;
     buttons?: BotButton[];
     parseMode?: 'HTML';
   }

   export interface BotButton {
     text: string;
     callbackData: string;
     expiresIn?: number;
   }
   ```

2. Crear `response-builder.service.ts`:
   - `buildConfirmation(tool, data): BotReply` — template por tool
   - `buildQuestion(items: ActionItem[]): BotReply` — pregunta para items pendientes
   - `buildAbandonNote(item: ActionItem): BotReply` — nota de abandono
   - `buildGroupedConfirmation(items: ActionItem[]): BotReply` — resumen agrupado (3 del mismo tipo)
   - `buildLimitMessage(remaining: ActionItem[]): BotReply` — "Solo proceso 3 a la vez"
   - Helpers: `formatCLP()`, `formatDate()`, `escapeHtml()`

3. Registrar `ResponseBuilderService` en `bot.module.ts`

**Validación**: importar los tipos desde el código existente, verificar que compilan.

---

### Fase 2: Action Planner

**Objetivo**: Crear el orquestador que ejecuta N acciones. Todavía no conectado a Phase A — se alimenta manualmente para testing.

**Archivo nuevo:**

| Archivo | Contenido |
|---------|-----------|
| `src/bot/services/action-planner.service.ts` | Core del pipeline de ejecución |

**Pasos técnicos:**

1. Crear `ActionPlannerService` con método principal:
   ```typescript
   async processBlock(
     userId: string,
     block: ActionBlock,
     context: MinimalUserContext,
     msg: DomainMessage,
   ): Promise<{
     replies: BotReply[];
     updatedBlock: ActionBlock;
     executedCount: number;
     pendingCount: number;
   }>
   ```

2. Lógica interna del Planner:
   ```
   a. Clasificar items por tipo (action, query, quick, direct)
   b. Filtrar quick/direct — no entran al bloque
   c. Validar límite de 3 items
   d. Ordenar por dependencias (topological sort simple)
   e. Para cada item en orden:
      - Si status === 'ready':
        → Validar con Guardrails
        → Ejecutar handler
        → Si OK: status = 'executed', generar BotReply con template
        → Si fail: status = 'failed', generar BotReply con error
      - Si status === 'depends_on':
        → Verificar que dependencia está 'executed'
        → Si sí: cambiar a 'ready', ejecutar
        → Si dependencia falló: auto-abandonar
      - Si status === 'needs_info':
        → Incrementar attempts
        → Generar pregunta
   f. Retornar replies[] + bloque actualizado
   ```

3. Inyectar dependencias: `ToolRegistry`, `GuardrailsService`, `ResponseBuilderService`

4. Registrar en `bot.module.ts`

**Validación**: crear test manual vía `/bot/test` pasando un ActionBlock hardcoded.

---

### Fase 3: Phase A multi-action

**Objetivo**: Phase A devuelve `actions[]` en vez de `tool_call`. Backend detecta y enruta.

**Archivos a modificar:**

| Archivo | Cambio |
|---------|--------|
| `phase_a_system.txt` | Nuevo formato de respuesta `actions[]` con reglas |
| `schemas.py` | `ActionItemSchema`, nuevo response_type "actions" en `OrchestrateResponsePhaseA` |
| `orchestrator.py` | Parsear response_type "actions", validar estructura |
| `orchestrator.contracts.ts` | `PhaseAActionItem` type, actualizar `PhaseAResponse` |
| `orchestrator.client.ts` | Parsear y pasar actions al backend |

**Pasos técnicos:**

1. `schemas.py` — agregar modelos:
   ```python
   class PhaseAActionItem(BaseModel):
       id: int
       tool: str
       args: Dict[str, Any] = Field(default_factory=dict)
       status: str  # ready, needs_info, depends_on
       missing: List[str] = Field(default_factory=list)
       question: Optional[str] = None
       depends_on: Optional[int] = None
   ```
   Extender `OrchestrateResponsePhaseA` con `actions: Optional[List[PhaseAActionItem]]`

2. `phase_a_system.txt` — nuevo formato de respuesta:
   - Si detecta 1 intent: puede usar `tool_call` (legacy) o `actions` con 1 item
   - Si detecta 2-3 intents: DEBE usar `actions[]`
   - Si detecta 4+: usar `actions[]` con los primeros 3
   - Reglas de extracción máxima: siempre incluir name, type, description
   - Reglas de `_no_match`: cuando el usuario responde a slot-fill con nombre nuevo, enviar el nombre como category (no `_no_match`)
   - Nunca usar `clarification` si se puede extraer un monto parcial

3. `orchestrator.py` — parsear la respuesta:
   ```python
   if response_type == "actions":
       actions = [PhaseAActionItem(**a) for a in data.get("actions", [])]
       # Validar máximo 3
       # Retornar OrchestrateResponsePhaseA con actions
   ```

4. `orchestrator.contracts.ts` + `orchestrator.client.ts` — tipos TypeScript + parsing

5. `bot.service.ts` — routing:
   ```typescript
   if (phaseA.response_type === 'actions' && phaseA.actions?.length) {
     // Construir ActionBlock desde phaseA.actions
     // Llamar actionPlanner.processBlock()
   } else if (phaseA.response_type === 'tool_call') {
     // Pipeline actual (fallback)
   }
   ```

**Validación**: enviar mensajes con 1, 2 y 3 intents. Verificar que Phase A devuelve actions[]. Verificar fallback a tool_call.

---

### Fase 4: Multi-message en adapters y controller

**Objetivo**: `handle()` retorna `BotReply[]`, controller envía N mensajes, adapters soportan HTML.

**Archivos a modificar:**

| Archivo | Cambio |
|---------|--------|
| `bot.service.ts` | `handle()` retorna `BotReply[]` en vez de `string` |
| `bot.controller.ts` | Loop de envío: `for (reply of replies)` |
| `telegram.adapter.ts` | `sendReply` acepta `parseMode: 'HTML'` (ya soportado) |
| `whatsapp.adapter.ts` | Sin cambios (texto plano, emojis ya funcionan) |

**Pasos técnicos:**

1. `bot.service.ts`:
   ```typescript
   // ANTES
   async handle(m: DomainMessage): Promise<string>
   // DESPUÉS
   async handle(m: DomainMessage): Promise<BotReply[]>
   ```
   - Pipeline nuevo (actions): retorna replies del Planner + Phase B cierre
   - Pipeline viejo (tool_call): wrappear respuesta en `[{text: reply}]`
   - `handleTest()` también retorna `BotReply[]`

2. `bot.controller.ts`:
   ```typescript
   const replies = await this.bot.handle(msg);
   for (const reply of replies) {
     await this.tg.sendReply(msg, reply.text, { parseMode: 'HTML' });
   }
   ```

3. Adapters: `sendReply` ya acepta `parseMode` en Telegram. Para WhatsApp, HTML tags se stripean (o se convierten a formato WhatsApp: `<b>` → `*`).

**Validación**: enviar mensaje con 2 intents, verificar que llegan 3 mensajes separados (2 confirmaciones + 1 cierre).

---

### Fase 5: Pending como ActionBlock (multi-turno)

**Objetivo**: El pending ya no es 1 acción, sino un bloque completo. Soporta multi-turno para completar items pendientes.

**Archivos a modificar:**

| Archivo | Cambio |
|---------|--------|
| `conversation.service.ts` | `setPending` / `getPending` manejan `ActionBlock` |
| `bot.service.ts` | Cuando hay bloque pendiente, pasarlo a Phase A y al Planner |
| `phase_a_system.txt` | Recibir bloque pendiente con N items, completar los que faltan |

**Pasos técnicos:**

1. `conversation.service.ts`:
   ```typescript
   async setBlock(userId: string, block: ActionBlock): Promise<void>
   async getBlock(userId: string): Promise<ActionBlock | null>
   async clearBlock(userId: string): Promise<void>
   ```
   Redis key: `conv:{userId}:block` con TTL 10 minutos.

2. `bot.service.ts` — flujo con bloque pendiente:
   ```
   a. Cargar bloque existente (si hay)
   b. Si hay bloque:
      → Pasar a Phase A como contexto: "Hay items pendientes: [...]"
      → Phase A completa los items con nueva info del usuario
      → Phase A puede agregar nuevos items (bloque crece)
      → Planner procesa bloque actualizado
   c. Si bloque se completó: cerrar, Phase B, limpiar Redis
   d. Si aún hay pendientes: guardar bloque actualizado
   ```

3. Reglas de abandono implementadas en Planner:
   ```typescript
   for (const item of block.items) {
     if (item.status === 'needs_info' && item.attempts >= block.maxAttempts) {
       item.status = 'abandoned';
       replies.push(responseBuilder.buildAbandonNote(item));
     }
   }
   ```

4. Dependencias: si item 1 está `executed` y item 2 era `depends_on:1`, cambiar item 2 a `ready`.

**Validación**: enviar "5 lucas en comida y algo en lime" → recibir confirmación + pregunta → responder "transporte" → recibir confirmación + cierre. Verificar bloque en Redis entre turnos.

---

### Fase 6: Botón Deshacer + Callbacks

**Objetivo**: Cada confirmación de acción tiene botón "Deshacer". Cross-platform.

**Archivos nuevos:**

| Archivo | Contenido |
|---------|-----------|
| `src/bot/services/callback-handler.service.ts` | Parsea callbacks, ejecuta undo, verifica expiración |

**Archivos a modificar:**

| Archivo | Cambio |
|---------|--------|
| `bot.controller.ts` | Nuevo endpoint para `callback_query` (Telegram) |
| `telegram.adapter.ts` | `sendReplyWithButtons()` — inline keyboard. `editMessage()` para timeout/undo |
| `whatsapp.adapter.ts` | `sendInteractiveReply()` — interactive buttons |
| `response-builder.service.ts` | Agregar `BotButton` a confirmaciones de acciones |

**Pasos técnicos:**

1. `callback-handler.service.ts`:
   ```typescript
   async handleCallback(callbackData: string, userId: string): Promise<string>
   // Parsea: "undo:tx:abc-123"
   // Verifica expiración (60s desde creación, guardado en Redis)
   // Ejecuta: delete transaction + revert balance
   // Retorna: "↩️ Deshecho: $5.000 en Alimentación"
   ```

2. `telegram.adapter.ts`:
   ```typescript
   async sendReplyWithButtons(dm, text, buttons, parseMode)
   // POST sendMessage con reply_markup: { inline_keyboard: [[...]] }

   async editMessageRemoveButtons(chatId, messageId)
   // POST editMessageReplyMarkup con reply_markup: { inline_keyboard: [] }
   // Se llama después de 60s via setTimeout o Redis TTL
   ```

3. `bot.controller.ts`:
   ```typescript
   @Post('telegram/webhook')
   async telegram(@Body() body: any) {
     // Si es callback_query:
     if (body.callback_query) {
       return this.handleCallback(body.callback_query);
     }
     // Si es message (actual):
     // ... flujo actual
   }
   ```

4. `whatsapp.adapter.ts`:
   ```typescript
   async sendInteractiveReply(dm, text, buttons)
   // POST con type: "interactive", interactive: { type: "button", ... }
   ```

5. Timeout del botón (Telegram):
   - Al enviar mensaje con botón, guardar `{messageId, chatId, expiresAt}` en Redis
   - Cron job o delayed task que llama `editMessageRemoveButtons` después de 60s
   - Alternativa simple: verificar expiración en el callback handler, no remover botón activamente

**Validación**: registrar gasto → ver botón → presionar → verificar que la transacción se eliminó y el balance se revirtió. Verificar expiración.

---

### Fase 7: Nudges como mensajes separados

**Objetivo**: Los nudges se evalúan al cerrar bloque y se envían como mensaje template independiente.

**Archivos a modificar:**

| Archivo | Cambio |
|---------|--------|
| `action-planner.service.ts` | Evaluar nudges después de ejecutar todas las acciones |
| `response-builder.service.ts` | Templates de nudges |
| `cooldown.service.ts` | Evaluar cooldowns al cerrar bloque, no por acción |
| `metrics.service.ts` | Streak +1 por bloque, weekCount +N |

**Pasos técnicos:**

1. Después de ejecutar todas las acciones del bloque:
   ```typescript
   // Evaluar métricas con datos finales
   const txCount = block.items.filter(i => i.tool === 'register_transaction' && i.status === 'executed').length;
   if (txCount > 0) {
     await metricsService.recordTransactions(userId, txCount);
   }

   // Evaluar nudges
   const nudgeReply = await this.evaluateNudges(userId, context, cooldowns);
   if (nudgeReply) replies.push(nudgeReply);
   ```

2. Templates de nudges:
   ```typescript
   buildBudgetNudge: (percent) =>
     `⚠️ Llevas el ${percent}% del presupuesto mensual`,

   buildStreakNudge: (days) =>
     `🔥 ${days} días seguidos registrando. ¡Sigue así!`,
   ```

3. Orden de mensajes:
   ```
   [confirmaciones] → [nudge si aplica] → [Phase B cierre]
   ```

**Validación**: registrar gasto que lleve presupuesto >90% → verificar nudge como mensaje separado.

---

### Fase 8: Message log con block_id

**Objetivo**: Cada acción de un bloque se loguea individualmente con `block_id` para agrupar.

**Archivos a modificar:**

| Archivo | Cambio |
|---------|--------|
| Supabase migration | `ALTER TABLE bot_message_log ADD COLUMN block_id TEXT` |
| `message-log.service.ts` | Aceptar `blockId` en el log |
| `action-planner.service.ts` | Pasar `block.id` al log por cada acción |
| Admin frontend | Agrupar mensajes por `block_id` en vista de chat |

**Validación**: enviar mensaje multi-action → verificar N filas en `bot_message_log` con mismo `block_id`.

---

### Fase 9: Contexto Tier 1 mejorado

**Objetivo**: Después de todo implementado, mejorar la ventana de contexto para que Phase A tenga mejor información en turnos siguientes.

**Análisis previo necesario:**
- ¿Cuánto contexto necesita Phase A para bloques multi-turno?
- ¿El TTL de 10 minutos es suficiente?
- ¿20 entradas de history bastan?
- ¿Qué pasa con media (fotos/audio) — se persiste o no?

**Archivos a modificar:**

| Archivo | Cambio |
|---------|--------|
| `conversation-history.service.ts` | Nuevo formato de history por bloque |
| `conversation.service.ts` | Resumen consolidado por bloque |
| Redis keys | Evaluar TTLs, tamaños de ventana |

**Pasos técnicos:**

1. History por bloque — guardar resumen, no cada mensaje:
   ```typescript
   // En vez de N entries por turno:
   { role: "user", content: "5 lucas en comida y 2100 en lime" }
   { role: "assistant", content: "Registré $5.000 en Alimentación y $2.100 en Transporte" }
   ```

2. Evaluar TTLs:
   - History: ¿subir de 10min a 30min? (sesiones más largas)
   - Block: 10min TTL (mantener — si no responde en 10min, abandonar)
   - Summary: mantener 2-24h (ya funciona bien)

3. Evaluar ventana:
   - ¿20 entradas suficientes? Con bloques, cada turno genera 1 par. 20 entradas = 10 turnos.
   - Si los bloques son multi-turno, 10 turnos podrían ser solo 3-4 bloques de contexto.
   - Evaluar subir a 30-40 entradas.

4. Persistencia de media:
   - Decisión: ¿guardar referencia a media en history?
   - Opción A: guardar descripción textual ("📸 Foto de boleta de $5.190 en Jumbo")
   - Opción B: guardar base64 en Redis (costoso en memoria)
   - Opción C: no persistir (actual) — Phase A no puede referenciar media previo
   - **Recomendación**: Opción A — guardar descripción textual del media procesado

5. Summary mejorado:
   - El summary actual es texto plano ("Registró $5.000 en comida")
   - Mejorarlo para incluir bloques: "Bloque 1: registró $5.000 en Alimentación + $2.100 en Transporte"

**Validación**: enviar 5 bloques consecutivos → verificar que Phase A del bloque 6 tiene contexto de los 5 anteriores. Verificar que no se confunde con datos de bloques viejos.

---

### Fase 10: Handlers faltantes

**Objetivo**: Agregar handlers detectados como faltantes.

| Handler | Qué hace | Tool Schema |
|---------|----------|-------------|
| `manage_goals` | Crear meta, abonar, editar | operation: create/deposit/edit/delete |
| `manage_budget` | Crear/editar presupuesto | operation: create/edit/delete |

**Se implementan DESPUÉS de que el Action Pipeline esté funcionando** — aprovechan el nuevo sistema de bloques y templates.

---

## Orden de implementación y dependencias

```
Fase 1: Tipos + Response Builder ──────────────┐
                                                ↓
Fase 2: Action Planner ────────────────────────┐│
                                               ↓↓
Fase 3: Phase A multi-action ─────────────────┐││
                                              ↓↓↓
Fase 4: Multi-message adapters ──────────────→ SISTEMA FUNCIONAL (MVP)
                                                ↓
Fase 5: Pending como bloque (multi-turno) ─────┤
                                                ↓
Fase 6: Botón Deshacer + Callbacks ────────────┤
                                                ↓
Fase 7: Nudges separados ──────────────────────┤
                                                ↓
Fase 8: Message log con block_id ──────────────┤
                                                ↓
Fase 9: Contexto Tier 1 mejorado ─────────────→ SISTEMA COMPLETO
                                                ↓
Fase 10: Handlers faltantes ──────────────────→ FEATURES NUEVOS
```

**MVP funcional**: Fases 1-4. El bot puede procesar N acciones de 1 mensaje, enviar confirmaciones separadas, y Phase B genera el cierre. Fallback al pipeline viejo si algo falla.

**Sistema completo**: Fases 5-9. Bloques multi-turno, botones, nudges, logging, contexto mejorado.

**Features nuevos**: Fase 10. Metas y presupuesto vía chat.
