# Plan: Pivot Arquitectónico — Bot TallyFinance v3

## Por qué pivotear

El sistema actual tiene 23+ code paths, 120+ reglas en el prompt de Phase A, y 65% del código es error handling. Cada feature nueva requiere cambios en 10+ archivos. Los bugs se arreglan con parches que agregan más complejidad. El sistema funciona pero es frágil e impredecible.

**Causa raíz:** La arquitectura de 2 fases (Phase A clasifica → Backend ejecuta → Phase B responde) divide la inteligencia entre prompts rígidos y código defensivo. El LLM no puede ser inteligente si le damos 120 reglas y le quitamos contexto.

---

## Arquitectura Nueva: Single-Pass con Function Calling

### Principio
Un solo LLM call por turno. El modelo recibe la conversación completa, las funciones disponibles, y decide qué hacer. Si necesita ejecutar algo, llama la función. El backend ejecuta y devuelve el resultado. El modelo genera la respuesta final con personalidad.

```
HOY (2 LLM calls + 23 code paths):
  User → Phase A (classify+extract) → Backend (route+guard+execute) → Phase B (personalize) → User
  Latencia: ~8-12s | Código: 1,469 líneas bot.service | Prompt: 6,100 tokens

NUEVO (1 LLM call con tool_use):
  User → Gemini (system prompt + history + tools) → tool_call? → Backend ejecuta → result → Gemini continúa → User
  Latencia: ~3-6s | Código: ~300 líneas | Prompt: ~2,000 tokens
```

### Stack
- **LLM:** Gemini 2.5 Flash (soporta texto, imágenes, audio, function calling nativo, 1M context)
- **Protocol:** Gemini API con `tools` parameter (function declarations)
- **Backend:** NestJS ejecuta las funciones, retorna resultado
- **Redis:** Solo historial de mensajes + métricas de usuario
- **Supabase:** Datos persistentes (sin cambios)

---

## Funcionalidades del Bot v3

### 1. Registrar Gasto
- Monto, categoría, fecha, descripción
- **Nombre generado por IA** — el LLM genera un nombre corto y descriptivo como parte de su respuesta, no como campo separado
- Si la categoría no existe → el LLM pregunta naturalmente, sin flujo especial
- Emoji de categoría asignado inteligentemente al crear

### 2. Registrar Ingreso
- Ingreso como entidad propia, no como transacción con type=income
- Cada ingreso tiene: monto, fuente/nombre, fecha, recurrencia (opcional)
- Sin categoría — es una entidad diferente
- Se pueden tener múltiples ingresos activos

### 3. CRUD Transacciones (completo)
- **Listar:** cualquier query — por fecha, rango, categoría, mes, tipo, totales
- **Editar:** cualquier campo — monto, categoría, nombre, fecha, descripción. Hasta una letra
- **Eliminar:** por ID, por referencia contextual, por búsqueda
- El LLM construye las queries usando funciones tipadas

### 4. CRUD Categorías (completo)
- **Listar:** todas con jerarquía
- **Crear:** con nombre + emoji inteligente (IA elige el mejor)
- **Editar:** nombre, emoji, presupuesto. Cualquier campo
- **Eliminar:** con protección de transacciones huérfanas
- **Renombrar:** cambiar nombre manteniendo ID

### 5. Balance y Consultas
- Balance general, por período, por categoría
- Ingresos vs gastos
- Presupuesto activo y restante
- Link al dashboard para ver más
- Consultas libres: "cuánto gasté en uber en marzo"

### 6. Info de la App
- Explicar funcionalidades en detalle
- FAQ, limitaciones, canales
- Usando el tono del usuario

### 7. Saludos y Off-topic
- Saludos personalizados con tono
- Redirección amable de temas fuera de dominio

---

## Diseño del System Prompt (único, ~1,500 tokens)

```
Eres Gus, asistente financiero personal de TallyFinance.

IDENTIDAD:
[gus_identity.txt — 200 tokens, sin cambios]

TONO: {tone}
[Ángulos y direcciones por tono — 300 tokens, sin ejemplos concretos]

MOOD: {mood}
[Reglas de mood reactivo — 100 tokens]

COMPORTAMIENTO:
- Registra gastos e ingresos cuando el usuario lo pide
- Genera nombres descriptivos para las transacciones (2-4 palabras, Title Case)
- Elige emojis creativos y precisos para categorías nuevas
- Responde consultas financieras con datos reales de las funciones
- Mantiene conversación natural — recuerda todo lo que se habló
- Nunca inventa montos — si no hay número explícito, pregunta
- Nunca repite la misma estructura dos veces seguidas
- Ingresos son entidades separadas, no transacciones con categoría

LIMITACIONES:
- Solo finanzas personales. Temas fuera de dominio → redirige amablemente
- No puede acceder a bancos ni hacer transferencias
- Moneda: CLP (pesos chilenos). "lucas" = x1000

CONTEXTO DEL USUARIO:
{user_context_json}
```

**~1,500 tokens total.** Vs 3,500+ actuales. Las reglas de routing, slot-fill, categorías, multi-acción — todo eso lo maneja el function calling nativo. No necesita reglas.

---

## Functions (Tool Declarations para Gemini)

### `register_expense`
```json
{
  "name": "register_expense",
  "description": "Registra un gasto del usuario",
  "parameters": {
    "amount": { "type": "number", "description": "Monto en CLP" },
    "category": { "type": "string", "description": "Nombre de la categoría" },
    "name": { "type": "string", "description": "Nombre descriptivo corto (2-4 palabras)" },
    "posted_at": { "type": "string", "description": "Fecha ISO-8601, default hoy" },
    "description": { "type": "string", "description": "Descripción opcional" }
  },
  "required": ["amount", "category", "name"]
}
```

### `register_income`
```json
{
  "name": "register_income",
  "description": "Registra un ingreso del usuario (sueldo, venta, freelance, etc)",
  "parameters": {
    "amount": { "type": "number", "description": "Monto en CLP" },
    "source": { "type": "string", "description": "Fuente del ingreso (ej: Sueldo Marzo, Venta Bicicleta)" },
    "posted_at": { "type": "string", "description": "Fecha ISO-8601, default hoy" },
    "recurring": { "type": "boolean", "description": "Si es ingreso recurrente" }
  },
  "required": ["amount", "source"]
}
```

### `query_transactions`
```json
{
  "name": "query_transactions",
  "description": "Busca, filtra y agrega transacciones del usuario",
  "parameters": {
    "operation": { "type": "string", "enum": ["list", "sum", "count"] },
    "category": { "type": "string", "description": "Filtrar por categoría" },
    "type": { "type": "string", "enum": ["expense", "income", "all"] },
    "period": { "type": "string", "enum": ["today", "week", "month", "year", "custom"] },
    "start_date": { "type": "string", "description": "Inicio del rango (ISO-8601)" },
    "end_date": { "type": "string", "description": "Fin del rango (ISO-8601)" },
    "limit": { "type": "number", "description": "Máximo de resultados (default 10)" }
  },
  "required": ["operation"]
}
```

### `edit_transaction`
```json
{
  "name": "edit_transaction",
  "description": "Edita cualquier campo de una transacción existente",
  "parameters": {
    "transaction_id": { "type": "string", "description": "UUID de la transacción" },
    "hint_amount": { "type": "number", "description": "Monto aprox para identificar" },
    "hint_category": { "type": "string", "description": "Categoría para identificar" },
    "changes": {
      "type": "object",
      "description": "Campos a modificar",
      "properties": {
        "amount": { "type": "number" },
        "category": { "type": "string" },
        "name": { "type": "string" },
        "description": { "type": "string" },
        "posted_at": { "type": "string" }
      }
    }
  },
  "required": ["changes"]
}
```

### `delete_transaction`
```json
{
  "name": "delete_transaction",
  "description": "Elimina una transacción",
  "parameters": {
    "transaction_id": { "type": "string" },
    "hint_amount": { "type": "number" },
    "hint_category": { "type": "string" }
  }
}
```

### `manage_category`
```json
{
  "name": "manage_category",
  "description": "CRUD completo de categorías del usuario",
  "parameters": {
    "operation": { "type": "string", "enum": ["list", "create", "rename", "delete", "update_icon", "update_budget"] },
    "name": { "type": "string", "description": "Nombre de la categoría" },
    "new_name": { "type": "string", "description": "Nuevo nombre (rename)" },
    "icon": { "type": "string", "description": "Emoji de la categoría" },
    "budget": { "type": "number", "description": "Presupuesto mensual" },
    "force_delete": { "type": "boolean", "description": "Forzar eliminación con transacciones" }
  },
  "required": ["operation"]
}
```

### `get_balance`
```json
{
  "name": "get_balance",
  "description": "Obtiene balance, gastos, ingresos y presupuesto del usuario",
  "parameters": {
    "period": { "type": "string", "enum": ["today", "week", "month", "year", "custom"] },
    "start_date": { "type": "string" },
    "end_date": { "type": "string" },
    "category": { "type": "string" },
    "include_budget": { "type": "boolean", "description": "Incluir info de presupuesto" },
    "include_breakdown": { "type": "boolean", "description": "Desglose por categoría" }
  }
}
```

### `get_app_info`
```json
{
  "name": "get_app_info",
  "description": "Responde preguntas sobre TallyFinance, funcionalidades, limitaciones",
  "parameters": {
    "question": { "type": "string", "description": "La pregunta del usuario" }
  },
  "required": ["question"]
}
```

**Total: 8 funciones** (vs 8 handlers actuales, pero más limpias y con schemas tipados)

---

## Contexto Conversacional: Mensajes Reales

### Cómo funciona con Gemini
Gemini acepta un array de mensajes completo. En vez de resumir, pasamos la conversación real:

```python
messages = [
    {"role": "user", "parts": [{"text": "gasté 5 lucas en comida"}]},
    {"role": "model", "parts": [
        {"functionCall": {"name": "register_expense", "args": {"amount": 5000, "category": "Alimentación", "name": "Comida"}}},
    ]},
    {"role": "function", "parts": [
        {"functionResponse": {"name": "register_expense", "response": {"ok": true, "data": {"id": "abc", "amount": 5000}}}}
    ]},
    {"role": "model", "parts": [{"text": "✅ $5.000 — Comida\n🍽️ Alimentación\n\n¿Algo más que quieras registrar?"}]},
    {"role": "user", "parts": [{"text": "elimínalo"}]},
    # ... Gemini ve TODO el contexto y sabe qué "eso" es
]
```

### Almacenamiento
- **Redis:** Últimos 50 mensajes (25 turnos) con TTL 4h — para respuesta rápida
- **Supabase:** Todos los mensajes en `conversation_history` — para persistencia
- **Multimedia:** Referencias en Redis (tipo, descripción), base64 solo en el request actual

### Ventajas vs sistema actual
- El LLM **ve** la conversación completa — no un resumen lossy
- "Elimínalo" funciona porque el LLM ve el `functionResponse` con el ID
- No necesita metadata artificial — los function calls son el contexto
- Multi-turno es natural — el LLM continúa la conversación

### Token Budget
- System prompt: ~1,500 tokens
- 25 turnos de conversación: ~3,000-5,000 tokens
- Tool declarations: ~800 tokens
- User context: ~300 tokens
- **Total: ~6,000-8,000 tokens por request**
- Gemini 2.5 Flash tiene 1M context — usamos < 1%

---

## Multimedia: Imágenes, Audio, Archivos

Gemini 2.5 Flash es multimodal nativo. No necesitamos OCR ni speech-to-text externo:

```python
# Imagen de boleta
message = {
    "role": "user",
    "parts": [
        {"inlineData": {"mimeType": "image/jpeg", "data": base64_image}},
        {"text": "registra estos gastos"}
    ]
}

# Audio de voz
message = {
    "role": "user",
    "parts": [
        {"inlineData": {"mimeType": "audio/ogg", "data": base64_audio}},
    ]
}
```

Gemini analiza la imagen/audio y decide qué funciones llamar. Sin procesamiento intermedio.

Para el historial: guardamos `{"type": "image", "description": "Boleta Jumbo $23.450"}` — no el base64.

---

## Tracking de Tokens

### Por mensaje
Gemini API retorna `usageMetadata` en cada response:
```json
{
  "promptTokenCount": 4500,
  "candidatesTokenCount": 150,
  "totalTokenCount": 4650
}
```

Guardamos esto en `bot_message_log` por cada interacción.

### Por usuario (Redis)
```
tokens:{userId}:daily → counter con TTL 24h
tokens:{userId}:monthly → counter con TTL 30d
```

### Límites de seguridad
| Nivel | Límite diario | Límite mensual |
|-------|--------------|----------------|
| Free | 50,000 tokens | 500,000 tokens |
| Basic | 200,000 tokens | 2,000,000 tokens |
| Premium | Ilimitado | Ilimitado |

Si el usuario excede → respuesta cortés: "Has alcanzado tu límite diario. Vuelve mañana o mejora tu plan."

---

## Lo que se elimina

| Componente | Razón |
|-----------|-------|
| Phase A (AI service) | Reemplazado por function calling de Gemini |
| Phase B (AI service) | Reemplazado por la respuesta del mismo LLM call |
| ai-service completo (FastAPI) | Todo lo hace Gemini directo desde el backend |
| Guardrails service | Function calling valida tipos nativamente |
| Hallucination guard | El LLM con historial completo no necesita regex de validación |
| ActionPlanner service | No hay action blocks — Gemini maneja multi-tool naturalmente |
| ResponseBuilder service | El LLM genera las confirmaciones con personalidad |
| Stub mode | Sin AI service separado, no hay stub |
| Pending slot-fill (Redis) | El LLM maneja multi-turno leyendo la conversación |
| Action blocks (Redis) | Gemini soporta múltiples function calls en un turno |
| Conversation summary | Reemplazado por mensajes reales en el array |
| Style detector | El LLM detecta estilo naturalmente de la conversación |
| 120+ reglas en prompts | Reemplazadas por ~20 líneas de comportamiento + function declarations |

## Lo que se mantiene

| Componente | Razón |
|-----------|-------|
| Tool handlers (refactored) | Siguen ejecutando queries a Supabase |
| Redis (simplificado) | Historial de mensajes + métricas + rate limit |
| Supabase | Sin cambios en schema |
| Bot controller | Webhooks Telegram/WhatsApp siguen igual |
| Channel adapters | Sin cambios |
| Rate limiting | Sigue necesario |
| Message dedup | Sigue necesario |
| Concurrency lock | Sigue necesario |
| Message logging | Sigue necesario + tracking de tokens |

---

## Estructura de archivos nueva

```
bot/
├── bot.controller.ts          # Webhooks (sin cambios)
├── bot.service.ts             # ~300 líneas (vs 1,469)
├── gemini.client.ts           # NEW: Gemini API client con function calling
├── contracts.ts               # DomainMessage (sin cambios)
├── adapters/                  # Sin cambios
│   ├── telegram.adapter.ts
│   └── whatsapp.adapter.ts
├── functions/                 # NEW: reemplaza tools/handlers/
│   ├── register-expense.fn.ts
│   ├── register-income.fn.ts
│   ├── query-transactions.fn.ts
│   ├── edit-transaction.fn.ts
│   ├── delete-transaction.fn.ts
│   ├── manage-category.fn.ts
│   ├── get-balance.fn.ts
│   └── get-app-info.fn.ts
├── services/
│   ├── conversation.service.ts  # Simplificado: solo get/append messages
│   ├── metrics.service.ts       # Sin cambios
│   ├── cooldown.service.ts      # Sin cambios
│   ├── token-tracker.service.ts # NEW: tracking de tokens por usuario
│   └── message-log.service.ts   # + token tracking
└── prompts/
    ├── gus_identity.txt         # Sin cambios
    └── gus_system.txt           # NEW: ~1,500 tokens (reemplaza phase_a + phase_b)
```

**Eliminados:** action-planner, response-builder, guardrails, style-detector, orchestrator.client, orchestrator.contracts, conversation-history (merged), todo el ai-service (FastAPI).

---

## Migración

### Fase 1: Gemini client + nuevo bot.service (~2 días)
1. Crear `gemini.client.ts` con function calling
2. Crear `gus_system.txt` (system prompt unificado)
3. Reescribir `bot.service.ts` (~300 líneas)
4. Adaptar handlers existentes como functions

### Fase 2: Contexto conversacional (~1 día)
1. Simplificar conversation.service (solo messages array)
2. Pasar conversación real a Gemini (no resumen)
3. Media references en el historial

### Fase 3: Token tracking + cleanup (~1 día)
1. Crear token-tracker.service
2. Agregar límites por usuario
3. Eliminar ai-service, guardrails, action-planner, etc.

### Fase 4: Testing (~1 día)
1. Correr todos los test suites
2. Validar en producción

---

## Paso a paso de implementación

### Paso 1: Gemini Client (`gemini.client.ts`)
Crear el cliente que:
- Conecta a Gemini 2.5 Flash API
- Envía system prompt + historial + funciones declaradas
- Recibe respuesta (texto y/o function calls)
- Si hay function call → ejecuta handler → inyecta resultado → pide que continúe
- Soporta múltiples function calls en un turno (Gemini lo hace nativo)
- Envía imágenes/audio como `inlineData` parts (multimodal nativo)
- Retorna `usageMetadata` para tracking de tokens

### Paso 2: Functions (handlers refactored)
Cada handler actual se simplifica a una función pura:
- Recibe: `userId` + args tipados del function call
- Ejecuta: query/insert/update/delete en Supabase
- Retorna: JSON con el resultado
- Sin slot-fill, sin pending, sin action blocks — solo ejecución

### Paso 3: System Prompt (`gus_system.txt`)
Un solo prompt que define:
- Identidad de Gus (200 tokens)
- Tono activo con ángulos (300 tokens) — SIN ejemplos concretos
- Mood reactivo (100 tokens)
- Comportamiento general (200 tokens)
- Limitaciones (100 tokens)
- Contexto del usuario inyectado (200 tokens)
- **Total: ~1,100 tokens** (vs 6,100 actuales)

### Paso 4: Conversation Service (simplificado)
- `getMessages(userId)` → array de mensajes Gemini-format desde Redis
- `appendMessage(userId, message)` → agregar al array, FIFO trim a 50
- `persistToSupabase(userId, message)` → fire-and-forget a conversation_history
- Sin summary, sin pending, sin blocks — el array de mensajes ES el estado

### Paso 5: Bot Service (~300 líneas)
```
1. Rate limit check
2. Dedup check
3. Concurrency lock
4. Token limit check
5. Load: user context + conversation history
6. Build Gemini request (system prompt + history + current message + tools)
7. Call Gemini
8. While response has function_call:
     a. Execute function handler
     b. Append function result to conversation
     c. Call Gemini again (continuation)
9. Extract final text response
10. Append to conversation history
11. Track tokens
12. Log message
13. Return response
```

13 pasos lineales. Sin branching. Sin if/else para response_type. Sin guardrails. Sin sanitizer.

### Paso 6: Token Tracker
- Cada response de Gemini incluye `usageMetadata`
- Incrementar contadores en Redis: `tokens:{userId}:daily`, `tokens:{userId}:monthly`
- Antes de cada request: check si excedió límite → respuesta cortés

### Paso 7: Cleanup
- Eliminar: ai-service (FastAPI completo)
- Eliminar: orchestrator.client, orchestrator.contracts, guardrails, action-planner, response-builder, style-detector
- Eliminar: prompts/phase_a_system.txt, phase_b_system.txt, variability_rules.txt
- Mantener: gus_identity.txt (se incorpora al system prompt nuevo)

### Paso 8: Testing
- Correr los 7 test suites existentes contra la nueva arquitectura
- Validar en producción con usuarios reales

---

## Cómo maneja cada caso borde

### Caso: "gasté 5 lucas en comida"
```
HOY: Phase A (3,500 tok prompt, 120 reglas) → classifica → register_transaction
     → guardrails valida → handler ejecuta → Phase B genera respuesta
     Puntos de fallo: 6

NUEVO: Gemini ve el mensaje + funciones disponibles
       → function_call: register_expense({amount: 5000, category: "Alimentación", name: "Comida"})
       → Backend ejecuta → resultado inyectado
       → Gemini genera: "✅ $5.000 — Comida / Alimentación. ¿Otra confesión que hacer? 🤡"
       Puntos de fallo: 2 (Gemini call + DB insert)
```

### Caso: "barra de proteína" (sin monto — el bug de Francisco)
```
HOY: Phase A puede inventar el monto del historial → hallucination guard (regex)
     → bloquea → pregunta "¿Cuánto fue?" → pero puede fallar si guard es muy/poco estricto

NUEVO: Gemini ve la conversación completa. Ve que "barra de proteína" no tiene monto.
       → NO llama function (porque amount es required en el schema)
       → Responde: "¿Cuánto te costó la barra de proteína?"
       Function calling OBLIGA a tener los required fields. No puede inventar.
       Puntos de fallo: 0
```

### Caso: "gasté 7000 en filosofía" (categoría no existe)
```
HOY: Phase A envía → handler detecta no match → CATEGORY_NOT_FOUND
     → Phase B genera pregunta → metadata en historial → next turn Phase A
     lee metadata → puede funcionar o no
     Puntos de fallo: 5 (cada paso puede fallar)

NUEVO: Gemini llama register_expense({category: "filosofía"})
       → Handler: categoría no existe, retorna {ok: false, error: "not_found", available: [...]}
       → Gemini ve el error y las categorías disponibles
       → Gemini responde: "No tienes categoría 'Filosofía'. ¿La creo? Tienes: Alimentación, Transporte..."
       → User: "sí"
       → Gemini ve la conversación previa, sabe que "sí" = crear filosofía
       → function_call: manage_category({operation: "create", name: "Filosofía", icon: "🧠"})
       → Luego: register_expense({amount: 7000, category: "Filosofía", name: "Compra Filosofía"})
       → TODO en la misma conversación, sin metadata artificial, sin pending state
       Puntos de fallo: 2 (Gemini + DB)
```

### Caso: "elimínalo" (referencia contextual)
```
HOY: Phase A busca en metadata del historial → encuentra txId → manage_transactions delete
     Pero: metadata puede estar stale, history puede haberse perdido (TTL)

NUEVO: Gemini ve en la conversación:
       [..., {functionResponse: {name: "register_expense", response: {id: "abc-123", amount: 5000}}}]
       → Sabe que "eso" = transacción abc-123
       → function_call: delete_transaction({transaction_id: "abc-123"})
       → No necesita metadata artificial — el function response ES el contexto
       Puntos de fallo: 1
```

### Caso: "gasté 5 lucas en comida y 3 en uber" (multi-acción)
```
HOY: Phase A decide response_type=actions → ActionPlanner procesa block
     → puede crear bloque zombie → puede perder acciones nuevas
     Puntos de fallo: 4+

NUEVO: Gemini soporta parallel function calls nativamente:
       → function_calls: [
           register_expense({amount: 5000, category: "Alimentación", name: "Comida"}),
           register_expense({amount: 3000, category: "Transporte", name: "Uber"})
         ]
       → Backend ejecuta ambas → inyecta ambos resultados
       → Gemini genera respuesta unificada con ambas confirmaciones
       Puntos de fallo: 1
```

### Caso: "cuánto gasté en comida entre el 1 y el 15 de marzo" (query compleja)
```
HOY: Phase A tiene que mapear a ask_balance con filtros limitados
     → handler construye query → retorna datos parciales

NUEVO: Gemini llama:
       query_transactions({operation: "sum", category: "Alimentación",
                          period: "custom", start_date: "2026-03-01", end_date: "2026-03-15"})
       → Handler ejecuta SELECT SUM(amount) WHERE... → retorna total
       → Gemini: "Entre el 1 y el 15 de marzo gastaste $45.000 en Alimentación"
       Sin reglas especiales de parsing de fechas en el prompt
```

### Caso: "cámbialo a 10 lucas, no eran 5" (edición contextual)
```
HOY: Phase A debe: detectar intent de edit + encontrar txId + mapear new_amount
     120 reglas compiten para decidir qué hacer

NUEVO: Gemini ve en la conversación que el último registro fue $5.000 (id: abc-123)
       → function_call: edit_transaction({transaction_id: "abc-123", changes: {amount: 10000}})
       → Backend actualiza → Gemini confirma
       Sin reglas de resolución de referencias — la conversación ES la referencia
```

### Caso: usuario envía foto de boleta
```
HOY: Adapter descarga → base64 → Phase A (Gemini vision) → puede extraer datos o no
     → se pierde después del request (no se guarda)

NUEVO: Adapter descarga → base64 en el mensaje:
       {"role": "user", "parts": [
         {"inlineData": {"mimeType": "image/jpeg", "data": "..."}},
         {"text": "registra estos gastos"}
       ]}
       → Gemini analiza la imagen Y decide qué funciones llamar
       → Puede llamar múltiples register_expense si la boleta tiene varios items
       → En el historial se guarda: {"text": "[📷 Boleta: 3 items, total $23.450]"}
```

### Caso: usuario envía audio de voz
```
HOY: No soportado realmente — se intenta transcribir pero falla a menudo

NUEVO: Audio se envía como inlineData:
       {"role": "user", "parts": [
         {"inlineData": {"mimeType": "audio/ogg", "data": "..."}}
       ]}
       → Gemini transcribe + interpreta + llama funciones
       → Sin servicio de transcripción externo
```

### Caso: "sí" (respuesta ambigua)
```
HOY: Phase A no tiene contexto suficiente → clarification "¿Sí a qué?"
     O peor: interpreta mal desde metadata stale

NUEVO: Gemini ve la conversación completa:
       [...último mensaje de Gus: "¿Creo la categoría Filosofía?"]
       → "sí" = confirmación de crear la categoría
       → function_call: manage_category({operation: "create", name: "Filosofía", icon: "🧠"})
       → Luego: register_expense con la categoría recién creada
       El LLM tiene el contexto REAL, no un resumen
```

### Caso: conversación larga (25+ turnos)
```
HOY: History tiene 50 entries (25 pares) con TTL 4h. Después se pierde.
     Summary es lossy — pierde datos clave.

NUEVO: Redis: 50 mensajes (incluye function calls y responses)
       Si la conversación excede 50: FIFO trim (los más viejos se eliminan de Redis)
       Pero: Supabase tiene TODOS los mensajes (conversation_history)
       Si necesita contexto viejo: el handler query_transactions busca en la DB
       El LLM no necesita recordar todo — las funciones le dan acceso a los datos
```

### Caso: "gasté 5000 en comida, cómo va mi presupuesto, y crea la categoría Gym"
```
HOY: ActionPlanner intenta 3 acciones → puede crear bloque zombie
     → puede perder la tercera acción → puede contaminar mensajes siguientes

NUEVO: Gemini emite 3 function calls en paralelo:
       1. register_expense({amount: 5000, category: "Alimentación", name: "Comida"})
       2. get_balance({include_budget: true})
       3. manage_category({operation: "create", name: "Gym", icon: "🏋️"})
       → Backend ejecuta las 3 → inyecta los 3 resultados
       → Gemini genera 1 respuesta que confirma las 3 acciones
       Sin action blocks, sin bloque zombie, sin pending state
```

---

## Por qué es más resiliente

| Aspecto | Sistema actual | Sistema nuevo |
|---------|---------------|---------------|
| **Puntos de fallo por mensaje** | 6-8 | 2-3 |
| **Code paths** | 23+ | 1 (lineal) |
| **Reglas en prompt** | 120+ | ~20 |
| **Tokens de prompt** | 6,100 | ~1,500 |
| **LLM calls por turno** | 2 (Phase A + B) | 1 + N (N = function calls) |
| **Archivos que cambian por feature** | 10+ | 2 (handler + function declaration) |
| **Multi-turno** | Metadata artificial + pending state | Conversación real en el array |
| **Multimedia** | Procesamiento externo parcial | Gemini multimodal nativo |
| **Slot-fill** | Redis pending state + Phase A rules | Gemini pregunta naturalmente |
| **Categoría no existe** | CATEGORY_NOT_FOUND flow + Phase B + metadata | Gemini ve error → pregunta → crea |
| **Referencias contextuales** | Metadata txId en history | Function responses en la conversación |
| **Monto inventado** | Hallucination guard (regex) | Function calling requiere campos required |

---

## Producto final

Un bot que:
1. **Nunca se confunde** — tiene la conversación completa, no un resumen
2. **Nunca pierde contexto** — los function calls y responses son parte del historial
3. **Maneja multimedia** — imágenes y audio procesados nativamente por Gemini
4. **Es extensible** — agregar un tool = 1 handler + 1 function declaration
5. **Es rápido** — 1 LLM call en vez de 2, latencia ~3-6s
6. **Es barato** — Gemini Flash a $0.075/1M tokens, ~$0.0006/mensaje
7. **Tiene personalidad real** — el tono y mood se aplican en la misma generación, no en un paso separado
8. **Trackea costos** — cada mensaje tiene conteo de tokens, cada usuario tiene límites
9. **Es mantenible** — 300 líneas de bot.service vs 1,469

---

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Gemini function calling es menos preciso que GPT | Gemini 2.5 Flash tiene function calling de alta calidad. Si falla, evaluar GPT-4o con function calling |
| Costo mayor por usar más context | Gemini Flash: $0.075/1M input. 8K tokens/request = $0.0006/msg. 10K mensajes/mes = $6 |
| Migración rompe algo | Mantener endpoints iguales (/bot/test, webhooks). Solo cambia el pipeline interno |
| Personalidad diferente | El system prompt de Gus se mantiene. Los ángulos de tono no cambian |
| Gemini no disponible | Rate limit + retry con backoff exponencial. Sin stub mode — si Gemini cae, el bot espera |
| Conversación muy larga | FIFO trim a 50 mensajes en Redis. Datos históricos accesibles via funciones (query_transactions) |
