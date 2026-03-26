# Plan Detallado: Bot TallyFinance v3 — Gemini Function Calling

## Resumen ejecutivo

Reemplazar la arquitectura de 2 fases (Phase A + Phase B) con un pipeline de 1 sola llamada a Gemini 2.5 Flash usando function calling nativo. Esto elimina 23 code paths, 120+ reglas de prompt, y ~1,100 líneas de código defensivo. El bot se vuelve más inteligente porque ve la conversación completa y decide naturalmente qué función llamar.

---

## Funciones: Especificación completa

### 1. `register_expense` — Registrar un gasto

**Qué hace:** Inserta una transacción de tipo gasto en Supabase.

**Parámetros:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `amount` | number | ✅ | Monto en CLP. >0, <100.000.000 |
| `category` | string | ✅ | Nombre exacto de una categoría del usuario |
| `name` | string | ✅ | Nombre descriptivo generado por la IA (2-4 palabras, Title Case) |
| `posted_at` | string | ❌ | Fecha ISO-8601. Default: hoy en zona Chile |
| `description` | string | ❌ | Nota adicional |

**Lo que hace el handler:**
1. Busca `category` en las categorías del usuario (exact → substring → typo tolerance)
2. Si no matchea → retorna `{ ok: false, error: "CATEGORY_NOT_FOUND", available: [...] }`
3. Si matchea → busca la cuenta default del usuario
4. INSERT en `transactions` con `source: 'chat_intent'`, `type: 'expense'`
5. UPDATE `accounts.current_balance` restando el monto
6. Retorna `{ ok: true, data: { id, amount, category, name, posted_at } }`

**Cómo Gemini lo usa:**
```
User: "gasté 15 lucas en almuerzo con amigos"
Gemini: register_expense({ amount: 15000, category: "Alimentación", name: "Almuerzo Amigos" })
→ Backend retorna: { ok: true, data: { id: "abc-123", amount: 15000, category: "Alimentación" } }
→ Gemini genera respuesta con personalidad usando el resultado
```

**Categoría no existe:**
```
User: "gasté 7000 en filosofía"
Gemini: register_expense({ amount: 7000, category: "Filosofía", name: "Compra Filosofía" })
→ Backend: { ok: false, error: "CATEGORY_NOT_FOUND", available: ["Alimentación", "Transporte", ...] }
→ Gemini ve el error + las categorías disponibles
→ Gemini responde: "No tienes categoría 'Filosofía'. ¿La creo?"
→ User: "sí"
→ Gemini: manage_category({ operation: "create", name: "Filosofía", icon: "🧠" })
→ Backend crea la categoría
→ Gemini: register_expense({ amount: 7000, category: "Filosofía", name: "Compra Filosofía" })
→ Todo en la misma conversación, sin pending state
```

**Sin monto:**
```
User: "barra de proteína"
→ amount es required. Gemini NO puede llamar la función sin él.
→ Gemini responde: "¿Cuánto te costó?"
→ User: "1400"
→ Gemini: register_expense({ amount: 1400, category: "Alimentación", name: "Barra Proteína" })
```

**Nombre generado por IA:**
El campo `name` es required. Gemini genera un nombre descriptivo basado en lo que dijo el usuario:
- "gasté en el almuerzo" → `name: "Almuerzo"`
- "pagué el uber al trabajo" → `name: "Uber Trabajo"`
- "compré ropa en el mall" → `name: "Ropa Mall"`
- "15 lucas en la pelu" → `name: "Peluquería"`

No hay reglas en el prompt para esto — Gemini lo hace naturalmente por la descripción del campo.

---

### 2. `register_income` — Registrar un ingreso

**Qué hace:** Inserta un ingreso como entidad separada. NO es una transacción con `type=income` — es un ingreso con su propia estructura.

**Parámetros:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `amount` | number | ✅ | Monto en CLP |
| `source` | string | ✅ | Fuente/nombre del ingreso |
| `posted_at` | string | ❌ | Fecha ISO-8601. Default: hoy |
| `recurring` | boolean | ❌ | Si es ingreso recurrente (sueldo, arriendo) |
| `period` | string | ❌ | "weekly", "monthly" (solo si recurring=true) |

**Lo que hace el handler:**
1. Busca la cuenta default del usuario
2. INSERT en `transactions` con `type: 'income'`, `source: 'chat_intent'`
3. UPDATE `accounts.current_balance` sumando el monto
4. Retorna `{ ok: true, data: { id, amount, source, posted_at, recurring } }`

**Sin categoría — nunca.** El campo `category` no existe en esta función. Gemini no puede pedirla.

**Ejemplos:**
```
"me pagaron 500 mil" → register_income({ amount: 500000, source: "Sueldo" })
"vendí la bici en 80 lucas" → register_income({ amount: 80000, source: "Venta Bicicleta" })
"freelance me depositó 200 mil" → register_income({ amount: 200000, source: "Freelance" })
"mi sueldo mensual de 1.2M" → register_income({ amount: 1200000, source: "Sueldo Mensual", recurring: true, period: "monthly" })
```

---

### 3. `query_transactions` — Consultar transacciones

**Qué hace:** Busca, filtra, suma y cuenta transacciones con soporte completo de queries.

**Parámetros:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `operation` | string | ✅ | "list", "sum", "count" |
| `type` | string | ❌ | "expense", "income", "all" (default "all") |
| `category` | string | ❌ | Filtrar por categoría |
| `period` | string | ❌ | "today", "week", "month", "year", "custom" |
| `start_date` | string | ❌ | Inicio rango ISO-8601 (solo custom) |
| `end_date` | string | ❌ | Fin rango ISO-8601 (solo custom) |
| `limit` | number | ❌ | Máx resultados para list (default 10, max 50) |
| `search` | string | ❌ | Buscar por nombre o descripción (ILIKE) |

**Lo que hace el handler:**
1. Construye query dinámica a `transactions` con todos los filtros
2. Calcula rango de fechas según `period`
3. Si `operation=list` → SELECT con ORDER BY posted_at DESC, LIMIT
4. Si `operation=sum` → SELECT SUM(amount)
5. Si `operation=count` → SELECT COUNT(*)
6. Retorna resultados con totales

**Ejemplos de queries que el LLM construye naturalmente:**
```
"mis últimos gastos" → query_transactions({ operation: "list", type: "expense" })
"cuánto gasté esta semana" → query_transactions({ operation: "sum", type: "expense", period: "week" })
"transacciones en alimentación de marzo" → query_transactions({ operation: "list", category: "Alimentación", period: "custom", start_date: "2026-03-01", end_date: "2026-03-31" })
"cuántas transacciones hice hoy" → query_transactions({ operation: "count", period: "today" })
"busca la compra del supermercado" → query_transactions({ operation: "list", search: "supermercado" })
"mis ingresos este mes" → query_transactions({ operation: "list", type: "income", period: "month" })
"total gastado en uber en 2026" → query_transactions({ operation: "sum", category: "Transporte", search: "uber", period: "year" })
```

No hay reglas de prompt para parsear fechas ni construir queries. El function calling tipado + la inteligencia de Gemini lo resuelve.

---

### 4. `edit_transaction` — Editar cualquier campo

**Qué hace:** Modifica uno o más campos de una transacción existente. Puede cambiar hasta una sola letra.

**Parámetros:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `transaction_id` | string | ❌ | UUID directo (si lo tiene del historial) |
| `hint_amount` | number | ❌ | Monto para identificar la transacción |
| `hint_category` | string | ❌ | Categoría para identificar |
| `hint_name` | string | ❌ | Nombre para identificar |
| `changes` | object | ✅ | Campos a modificar |
| `changes.amount` | number | ❌ | Nuevo monto |
| `changes.category` | string | ❌ | Nueva categoría |
| `changes.name` | string | ❌ | Nuevo nombre |
| `changes.description` | string | ❌ | Nueva descripción |
| `changes.posted_at` | string | ❌ | Nueva fecha |

**Lo que hace el handler:**
1. Si `transaction_id` → buscar por ID directo
2. Si hints → buscar con tolerancia (amount ±5%, ILIKE para textos)
3. Si nada → usar la transacción más reciente
4. Si múltiples matches → retornar lista para que Gemini pregunte cuál
5. Aplicar `changes` via UPDATE
6. Ajustar `accounts.current_balance` si cambió amount
7. Retorna `{ ok: true, data: { previous, updated } }`

**Referencia contextual:**
```
User: "gasté 5000 en comida"
Gemini: register_expense(...)
→ { ok: true, data: { id: "abc-123", amount: 5000, ... } }

User: "no eran 5000, eran 8000"
→ Gemini VE en la conversación que el último registro fue abc-123 con amount 5000
→ edit_transaction({ transaction_id: "abc-123", changes: { amount: 8000 } })
```

**Editar nombre o descripción:**
```
User: "cámbialo a Almuerzo Oficina"
→ edit_transaction({ transaction_id: "abc-123", changes: { name: "Almuerzo Oficina" } })
```

**Múltiples matches:**
```
User: "cambia el gasto de comida a 10 lucas"
→ Handler encuentra 3 gastos en comida
→ Retorna { ok: false, multiple: [{ id, amount, name, posted_at }, ...] }
→ Gemini presenta las opciones: "Encontré 3 gastos en comida: 1. $5.000 Almuerzo (22/3), 2. ..."
→ User: "el primero"
→ edit_transaction({ transaction_id: "...", changes: { amount: 10000 } })
```

---

### 5. `delete_transaction` — Eliminar transacción

**Parámetros:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `transaction_id` | string | ❌ | UUID directo |
| `hint_amount` | number | ❌ | Monto para identificar |
| `hint_category` | string | ❌ | Categoría para identificar |
| `hint_name` | string | ❌ | Nombre para identificar |

**Lo que hace:**
1. Resolver transacción (ID → hints → más reciente)
2. Si múltiples matches → retornar lista
3. DELETE de `transactions`
4. Revertir `accounts.current_balance`
5. Retorna `{ ok: true, data: { deleted: { id, amount, category, name } } }`

**Referencia contextual:**
```
User: "registra 5000 en comida"
→ register_expense → { id: "abc-123" }

User: "elimínalo"
→ Gemini ve en la conversación que el último function response tiene id "abc-123"
→ delete_transaction({ transaction_id: "abc-123" })
→ Sin metadata artificial, sin pending state
```

---

### 6. `manage_category` — CRUD completo de categorías

**Parámetros:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `operation` | string | ✅ | "list", "create", "rename", "delete", "update_icon", "update_budget" |
| `name` | string | ❌ | Nombre de la categoría (create, rename source, delete) |
| `new_name` | string | ❌ | Nuevo nombre (solo rename) |
| `icon` | string | ❌ | Emoji (create o update_icon). IA elige el mejor |
| `budget` | number | ❌ | Presupuesto mensual (create o update_budget) |
| `force_delete` | boolean | ❌ | Forzar eliminación si tiene transacciones |

**Operaciones:**

**list:**
```
User: "mis categorías"
→ manage_category({ operation: "list" })
→ Retorna: { categories: [{ name, icon, budget, transactionCount }, ...] }
→ Gemini formatea la lista con personalidad
```

**create:**
```
User: "crea la categoría Gaming"
→ manage_category({ operation: "create", name: "Gaming", icon: "🎮" })
→ IA elige emoji. No hay lista fija — puede ser cualquier emoji Unicode
→ Retorna: { ok: true, data: { name: "Gaming", icon: "🎮" } }
```

**rename:**
```
User: "renombra Comida a Alimentación"
→ manage_category({ operation: "rename", name: "Comida", new_name: "Alimentación" })
```

**update_icon:**
```
User: "cambia el emoji de Transporte a 🚌"
→ manage_category({ operation: "update_icon", name: "Transporte", icon: "🚌" })
```

**update_budget:**
```
User: "ponle un presupuesto de 50 lucas a Alimentación"
→ manage_category({ operation: "update_budget", name: "Alimentación", budget: 50000 })
```

**delete:**
```
User: "elimina la categoría Ocio"
→ manage_category({ operation: "delete", name: "Ocio" })
→ Si tiene transacciones: { ok: false, error: "HAS_TRANSACTIONS", count: 5 }
→ Gemini: "Ocio tiene 5 transacciones. ¿Elimino de todos modos?"
→ User: "sí"
→ manage_category({ operation: "delete", name: "Ocio", force_delete: true })
```

---

### 7. `get_balance` — Balance, presupuesto, resumen financiero

**Parámetros:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `period` | string | ❌ | "today", "week", "month" (default), "year", "custom" |
| `start_date` | string | ❌ | Solo custom |
| `end_date` | string | ❌ | Solo custom |
| `category` | string | ❌ | Filtrar por categoría |
| `include_budget` | boolean | ❌ | Incluir estado del presupuesto |
| `include_breakdown` | boolean | ❌ | Desglose por categoría |

**Lo que retorna:**
```json
{
  "ok": true,
  "data": {
    "totalBalance": 350000,
    "totalSpent": 45000,
    "totalIncome": 500000,
    "periodLabel": "marzo 2026",
    "activeBudget": { "period": "monthly", "amount": 100000, "spent": 45000, "remaining": 55000 },
    "breakdown": [
      { "category": "Alimentación", "spent": 25000, "count": 8 },
      { "category": "Transporte", "spent": 12000, "count": 5 }
    ],
    "dashboardUrl": "https://tallyfinance.vercel.app/app"
  }
}
```

**Ejemplos:**
```
"cuánto tengo" → get_balance({})
"cuánto gasté esta semana" → get_balance({ period: "week" })
"cuánto gasté en comida" → get_balance({ category: "Alimentación" })
"cómo va mi presupuesto" → get_balance({ include_budget: true })
"desglose de gastos del mes" → get_balance({ include_breakdown: true })
"cuánto gasté entre el 1 y el 15" → get_balance({ period: "custom", start_date: "2026-03-01", end_date: "2026-03-15" })
```

Gemini puede mencionar el link al dashboard para más detalle: "Para ver el desglose completo, entra a tallyfinance.vercel.app/app"

---

### 8. `get_app_info` — Info, ayuda, FAQ

**Parámetros:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `question` | string | ✅ | La pregunta del usuario |

**Lo que retorna:**
Knowledge base estática con todo lo que el bot puede hacer, limitaciones, canales soportados, seguridad, y FAQ. Gemini usa esta info para responder CON EL TONO del usuario.

```
"qué puedes hacer" → Gemini lista las funcionalidades en el tono configurado
"es seguro" → Explica la seguridad con el tono
"cómo registro un gasto" → Explica paso a paso con el tono
```

---

## Lo que NO hace el bot

- **No setea balance** — eliminado. El balance se configura en onboarding o web.
- **No gestiona metas** — fuera de scope por ahora.
- **No cambia el tono** — el tono se configura desde la web (configuración), no por chat.
- **No accede a bancos** — solo registra lo que el usuario dice.
- **No hace cálculos de impuestos o inversiones** — fuera de dominio.

---

## System Prompt: Diseño final

```
Eres Gus, asistente financiero personal de TallyFinance.

=== IDENTIDAD ===
- Tu nombre es Gus. Eres chileno.
- Trabajas para TallyFinance SPA, una empresa chilena.
- Nunca dices que eres un bot, IA o programa. Eres "Gus, tu asistente financiero".
- Entiendes "lucas" = x1000 CLP. "10 lucas" = $10.000.
- Moneda: CLP (pesos chilenos). Formato: $X.XXX

=== TONO: {tone} ===
Tu tono define CÓMO hablas. Es la regla más importante.

neutral → Directo, eficiente, sin adornos. Solo los hechos.
friendly → Cercano, cálido, como un amigo. Puede usar 1-2 emojis.
serious → Profesional, conciso. Como un contador serio.
motivational → Energía positiva, refuerza buenos hábitos.
strict → Mínimo absoluto, sin rodeos ni decoración.
toxic → Sarcástico, confrontacional, humor negro sobre el gasto. Pica con cariño.

Sigue ángulos y direcciones, nunca frases fijas. Varía creativamente cada vez.
Nunca repitas la misma estructura dos veces seguidas.

=== MOOD: {mood} ===
normal → estándar según tono
happy → potencia lo positivo
tired → más conciso
hopeful → nota optimista
frustrated → más directo
proud → celebra logros

=== COMPORTAMIENTO ===
- Registra gastos e ingresos cuando el usuario lo pide
- Genera nombres descriptivos para transacciones (2-4 palabras, Title Case)
- Elige emojis creativos y precisos para categorías nuevas (cualquier emoji Unicode)
- Responde consultas financieras con datos de las funciones
- Mantiene conversación natural — recuerda todo lo que se habló
- Nunca inventa montos — si no hay número explícito, pregunta
- Los ingresos NO tienen categoría — son entidades separadas
- Cuando una categoría no existe, ofrece crearla naturalmente
- Puede mencionar el dashboard (tallyfinance.vercel.app/app) para más detalle

=== LIMITACIONES ===
- Solo finanzas personales. Fuera de dominio → redirige amablemente en tu tono.
- No accede a bancos ni hace transferencias.
- No cambia el tono — eso se configura en la web.
- No gestiona metas por ahora.

=== USUARIO ===
Nombre: {displayName}
Categorías: {categories}
Presupuesto: {budget}
```

**~1,200 tokens.** Sin reglas de routing. Sin slot-fill. Sin multi-acción. Sin metadata. Sin guardrails. Todo eso lo maneja el function calling.

---

## Contexto conversacional: La pieza clave

### Por qué es robusto

El sistema actual resume la conversación en ~500 tokens y pierde información. El nuevo pasa la **conversación completa** como array de mensajes.

Gemini ve:
```
[user]: "gasté 5 lucas en comida"
[model → functionCall]: register_expense({ amount: 5000, category: "Alimentación", name: "Comida" })
[function → response]: { ok: true, data: { id: "abc-123", amount: 5000 } }
[model]: "✅ $5.000 — Comida / Alimentación. ¿Vas a seguir confesando gastos?"
[user]: "elimínalo"
```

Gemini sabe que "eso" = transacción abc-123 porque **lo ve en la conversación**. No necesita metadata artificial ni txId en Redis.

### Almacenamiento

**Redis (hot):** Array de mensajes en formato Gemini. Últimos 50 entries. TTL 4h.
```
conv:v3:{userId} → JSON array de Content[]
```

Cada Content tiene:
- `role`: "user" | "model" | "function"
- `parts`: array de { text } | { functionCall } | { functionResponse } | { inlineData }

**Supabase (cold):** Persistencia a largo plazo en `conversation_history` (ya existe).

**Multimedia:** Al guardar en Redis, las imágenes/audio se reemplazan por descripciones:
```
Original: { inlineData: { mimeType: "image/jpeg", data: "base64..." } }
En Redis:  { text: "[📷 Imagen enviada por el usuario]" }
```
El base64 solo existe durante el request actual. No se guarda.

### ¿Qué pasa cuando la conversación es muy larga?

FIFO trim a 50 entries. Los mensajes viejos se eliminan de Redis pero persisten en Supabase. Si el usuario pregunta por algo antiguo ("cuánto gasté la semana pasada"), Gemini llama `query_transactions` que busca en la DB — no necesita recordar cada transacción.

---

## ¿Es tan robusto para manejar solicitudes totalmente personalizadas?

### Sí. Por 3 razones estructurales:

**1. Function calling es determinístico en la estructura, creativo en el contenido**

Gemini no puede inventar funciones ni parámetros que no existen. Si `amount` es required y el usuario no da un número, Gemini NO puede llamar la función — tiene que preguntar. Esto elimina toda una clase de bugs (hallucination, slot-fill loops, montos inventados) sin una sola línea de guardrails.

Pero dentro de los parámetros, Gemini es libre de ser creativo: genera nombres descriptivos, elige emojis, construye queries complejas, decide cuándo preguntar vs cuándo ejecutar.

**2. La conversación completa es el estado**

No hay pending state. No hay action blocks. No hay metadata artificial. La conversación completa (incluyendo function calls y responses) ES el estado. Cuando el usuario dice "sí", "elimínalo", "cámbialo", "lo mismo" — Gemini lee la conversación y sabe exactamente a qué se refiere.

Esto maneja cualquier caso de multi-turno naturalmente:
- "gasté 7000 en filosofía" → "no existe, ¿la creo?" → "sí, llámala Pensamiento" → crea + registra
- "registra 5000" → "¿en qué categoría?" → "la de siempre" → Gemini ve la última categoría usada
- "eso está mal" → "¿qué quieres cambiar?" → "eran 8000, no 5000" → edita
- 3 gastos en 1 mensaje → 3 function calls paralelos → 1 respuesta unificada

No hay código que maneje estos flujos. Gemini los maneja por contexto conversacional.

**3. El tono se aplica en la generación, no como post-proceso**

El sistema actual genera una confirmación template y luego Phase B agrega personalidad (a veces duplicando, a veces contradiciéndose). El nuevo genera la respuesta completa con tono integrado en 1 paso.

El tono está en el system prompt como ángulos:
- toxic → "sarcástico, confrontacional, humor negro"
- friendly → "cercano, cálido, como un amigo"

Gemini aplica esto a TODO: confirmaciones, preguntas, errores, saludos. No hay template + closing separados.

### Escenarios personalizados extremos:

**Escenario 1: Usuario envía foto de boleta con 5 items + texto "registra todo"**
```
→ Gemini ve la imagen (multimodal nativo)
→ Extrae 5 items con montos
→ 5 function calls: register_expense × 5
→ Backend ejecuta los 5
→ Gemini genera 1 respuesta confirmando los 5 con personalidad
→ 0 código custom para esto — es function calling + visión
```

**Escenario 2: "Cuánto gasté en comida esta semana vs la pasada"**
```
→ Gemini llama:
  query_transactions({ operation: "sum", category: "Alimentación", period: "week" })
  query_transactions({ operation: "sum", category: "Alimentación", period: "custom", start_date: "hace 2 semanas", end_date: "hace 1 semana" })
→ Compara los 2 resultados
→ Responde: "Esta semana gastaste $25.000 en comida, la pasada fueron $18.000. Vas subiendo 🤡"
```

**Escenario 3: "Registra mis gastos de ayer: 3000 en uber, 8000 en almuerzo, 2000 en café, y crea la categoría Snacks con 1500 en ella"**
```
→ 4 register_expense (3 en categorías existentes + 1 en "Snacks")
→ El de "Snacks" falla → CATEGORY_NOT_FOUND
→ Gemini llama manage_category({ operation: "create", name: "Snacks", icon: "🍿" })
→ Luego register_expense({ amount: 1500, category: "Snacks", name: "Snack", posted_at: "ayer" })
→ 1 respuesta unificada con los 4 gastos + 1 categoría creada
→ 0 código especial — Gemini maneja la secuencia naturalmente
```

**Escenario 4: Audio de 30 segundos diciendo "Hoy gasté quince lucas en el almuerzo, después tomé un uber de tres lucas y en la tarde compré un café de dos quinientos"**
```
→ Gemini recibe el audio como inlineData
→ Transcribe + interpreta
→ 3 function calls: almuerzo $15.000, uber $3.000, café $2.500
→ 1 respuesta con tono
→ 0 servicio de transcripción externo
```

**Escenario 5: "Cámbiame el emoji de Alimentación a 🍕 y ponle un presupuesto de 100 lucas"**
```
→ 2 function calls:
  manage_category({ operation: "update_icon", name: "Alimentación", icon: "🍕" })
  manage_category({ operation: "update_budget", name: "Alimentación", budget: 100000 })
→ Ambos ejecutados
→ 1 respuesta confirmando ambos cambios
```

---

## Token tracking y seguridad

### Por mensaje
Gemini retorna `usageMetadata` con cada response:
```json
{ "promptTokenCount": 4500, "candidatesTokenCount": 150, "totalTokenCount": 4650 }
```

Si hay function calls (loop), se suman todos los calls:
```
Call 1: prompt=4500, candidates=50 (function call)
Call 2: prompt=5200, candidates=120 (response final)
Total: input=9700, output=170
```

### Por usuario (Redis)
```
tokens:{userId}:daily → INCRBY totalTokens, TTL 24h
tokens:{userId}:monthly → INCRBY totalTokens, TTL 30d
```

### Límites
| Nivel | Diario | Mensual | ~Mensajes/día |
|-------|--------|---------|---------------|
| Free | 50K tokens | 500K tokens | ~10 |
| Basic | 200K tokens | 2M tokens | ~40 |
| Premium | Sin límite | Sin límite | Ilimitado |

Antes de cada request: check `tokens:{userId}:daily`. Si excedido:
```
"Has alcanzado tu límite diario de mensajes. Vuelve mañana o mejora tu plan en tallyfinance.vercel.app/app"
```

### Costos
Gemini 2.5 Flash: $0.15/1M input tokens, $0.60/1M output tokens
- Request promedio: ~5,000 input + ~150 output = $0.00084/mensaje
- 1,000 mensajes/mes = $0.84/mes
- 10,000 mensajes/mes = $8.40/mes

---

## Pipeline de 1 mensaje (producto final)

```
1. Webhook recibe mensaje de Telegram/WhatsApp
2. Rate limit check (30 msgs/60s)
3. Dedup check (msg:{msgId})
4. Concurrency lock (lock:{userId})
5. Token limit check (tokens:{userId}:daily)
6. Cargar: user context (Redis cache 60s) + conversation history (Redis)
7. Construir request:
   - System prompt (~1,200 tokens)
   - Conversation history (variable, hasta 50 entries)
   - Current message (texto + media si aplica)
   - 8 function declarations
8. Llamar Gemini 2.5 Flash
9. Si response tiene function_call(s):
   a. Ejecutar cada función contra Supabase
   b. Agregar function response a la conversación
   c. Llamar Gemini de nuevo (continuación)
   d. Repetir hasta que no haya más function calls (max 5 iteraciones)
10. Extraer respuesta final de texto
11. Guardar en conversation history (Redis + Supabase fire-and-forget)
12. Registrar tokens usados (Redis counter + message log)
13. Liberar lock + setear dedup "done"
14. Enviar respuesta al usuario via adapter (Telegram/WhatsApp)
```

**14 pasos lineales.** Sin branching. Sin if/else para response_type. Sin Phase A/B. Sin guardrails. Sin sanitizer. Sin action blocks.

---

## Archivos del producto final

```
bot/
├── bot.controller.ts           # Webhooks (mínimo cambio: usa nuevo service)
├── bot.service.ts              # ~300 líneas — el pipeline de 14 pasos
├── gemini.client.ts            # Client Gemini con function calling loop
├── contracts.ts                # DomainMessage (sin cambios)
├── adapters/
│   ├── telegram.adapter.ts     # Sin cambios
│   └── whatsapp.adapter.ts     # Sin cambios
├── functions/                  # 8 handlers puros
│   ├── register-expense.fn.ts
│   ├── register-income.fn.ts
│   ├── query-transactions.fn.ts
│   ├── edit-transaction.fn.ts
│   ├── delete-transaction.fn.ts
│   ├── manage-category.fn.ts
│   ├── get-balance.fn.ts
│   └── get-app-info.fn.ts
├── services/
│   ├── conversation.service.ts # Solo get/append/trim mensajes
│   ├── metrics.service.ts      # Sin cambios
│   ├── token-tracker.service.ts # Tracking + límites
│   └── message-log.service.ts  # + tokens por mensaje
├── delegates/
│   └── bot-channel.service.ts  # Sin cambios
└── prompts/
    └── gus_system.txt          # ~1,200 tokens (reemplaza 4 archivos)
```

**Eliminados:** ai-service (FastAPI completo), action-planner, response-builder, guardrails, style-detector, orchestrator.client, orchestrator.contracts, conversation-history (merged), cooldown (merged en metrics), phase_a_system.txt, phase_b_system.txt, variability_rules.txt, tool_schemas.py, schemas.py, orchestrator.py, debug_logger.py, config.py, app.py.
