# Plan: Contexto Conversacional Perfecto

## Estado Actual

### 3 memorias en Redis (independientes)

| Memoria | Key | TTL | Contenido | Problema |
|---------|-----|-----|-----------|----------|
| **History** | `conv:{userId}:history` | 10 min | 20 entries (10 pares user/assistant), solo texto | Se pierde tras 10min inactivo. Solo 10 pares. No guarda media. |
| **Summary** | `conv:{userId}:summary` | 2-24h | Resumen en lenguaje natural (Phase B genera) | Genérico, omite datos clave, no acumula bien |
| **Pending/Block** | `conv:{userId}:pending/block` | 10 min | Estado slot-fill o multi-action | OK para su propósito |

### Flujo actual del historial

```
1. Usuario envía mensaje
2. Backend carga history de Redis (20 entries max, 10min TTL)
3. Phase A recibe history como conversation_history[] → inyectado como mensajes previos
4. Phase B recibe history + summary en RuntimeContext
5. Después de responder: appendToHistory(userText, assistantText) → FIFO trim a 20
6. Phase B genera new_summary → se guarda en conv:{userId}:summary
```

### Tipo ConversationMessage actual
```typescript
{ role: 'user' | 'assistant', content: string }
```
- Solo texto plano
- Sin metadata (timestamp, tool usado, resultado, media)
- Sin distinción entre confirmación de template y respuesta AI

---

## Bugs Encontrados en Producción (message_log analysis)

Análisis de 1715 mensajes (sebastian.derpsch@uc.cl) y 137 mensajes (josetomasarevalo.x5@gmail.com).

### BUG A: Confirmaciones duplicadas
**Frecuencia:** ~40% de registros de transacciones
**Ejemplo:**
```
Usuario: "gasté 3000 en uber"
Gus:     ✅ $3.000 — Uber / Transporte · 17/3       ← Template (ActionPlanner)
         ✅ $3.000 — Transporte / Transporte · 17/3  ← Phase B repite la confirmación
```
**Causa:** Phase B recibe el resultado del tool y genera OTRA confirmación además del template.
El assistant content que se guarda en history incluye ambas, contaminando el contexto.
**Fix:** Phase B debe generar SOLO el cierre breve ("¿Algo más?"), nunca repetir la confirmación.
Esto se resuelve con el cambio ya planificado de que Phase B solo hace closing breve sin datos de balance/totales.

### BUG B: Ingresos piden categoría (bloquea registro)
**Frecuencia:** 100% de intentos de registrar ingresos
**Cadena real:**
```
"Ingresa 60 mil pesos"         → "¿En qué categoría lo pongo?"
"Los recibí de transferencia"  → "No pude procesar tu solicitud"
"Quiero anotar ingresos"       → "No pude procesar"
"Anota como ingreso 9150"      → "¿En qué categoría?"
"Es un ingreso"                → "¿En qué categoría?" (3er intento)
```
**Causa:** Prompt de Phase A dice "ingresos NO requieren categoría" pero Gemini/OpenAI lo ignora.
El handler `register_transaction` pide `category` como required en la validación.
**Fix:**
1. Handler: hacer `category` opcional cuando `type === 'income'`
2. Tool schema: agregar descripción explícita: "category: NO enviar para ingresos (type=income)"
3. Prompt Phase A: reforzar con ejemplo concreto de ingreso sin categoría
4. Guardrails: no rechazar si falta category cuando type=income

### BUG C: Bucle infinito de clarification (slot-fill no funciona)
**Frecuencia:** ~5% de interacciones multi-turno
**Cadena real:**
```
"cambia los 1000 de la bebida por 2000" → "¿En qué categoría?"
"alimentacion"                          → "¿Cuál es el monto?"
"2000"                                  → "¿En qué categoría?"
"alimentacion"                          → "¿Cuál es el monto?"
"2000 pesos"                            → "¿En qué categoría?"
(usuario abandona después de 5 intentos)
```
**Causa raíz:** El pending slot-fill no pasa correctamente los args ya recolectados a Phase A.
Cuando Phase A ve `pending.collected_args = { amount: 1000 }` y el usuario dice "alimentacion",
Phase A debería merge → `{ amount: 1000, category: "Alimentación" }` y ejecutar.
Pero en vez de eso, trata el mensaje como nuevo intent y vuelve a pedir lo que ya tiene.
**Relación con contexto:** History de 10 pares + 10min TTL agrava el problema. Si el history
se pierde entre turnos (>10min), Phase A no tiene contexto del slot-fill previo.
**Fix:**
1. Subir TTL de history a 4h (Fase 1 del plan)
2. Metadata en history: marcar los mensajes de slot-fill con `metadata.action: 'slot_fill_ask'`
3. Pending context: incluir SIEMPRE los collected_args como texto visible en el prompt
4. Phase A: regla explícita "si collected_args tiene amount, NO pidas amount de nuevo"

### BUG D: Respuesta vacía del bot
**Frecuencia:** ~3% de mensajes
**Ejemplos:**
```
"Crea una categoría que se llame comida en la u" → "" (vacío)
"fecha de hoy?"                                  → "" (vacío)
```
**Causa:** El response builder no tiene template para ese caso, y Phase B falla silenciosamente.
Cuando `response_type: "actions"` con `actions: []` y no hay bloque zombie, el backend
no ejecuta nada y no genera respuesta.
**Fix:** Ya corregido parcialmente con Bug 6 (normalizar actions vacío a tool_call).
Agregar fallback: si replies[] está vacío después de todo el pipeline, enviar
"No entendí tu mensaje. ¿Puedes reformularlo?"

### BUG E: No puede crear metas desde el chat
**Frecuencia:** 100% de intentos
**Cadena real:**
```
"Quiero crear una meta"                            → "¿Cómo se llama y cuánto?"
"Reloj amazfit y necesito ahorrar 100 Lucas"       → "No pude procesar"
"La meta se llama reloj amazfit, ahorrar 100 mil"  → "No pude procesar"
```
**Causa:** `ask_goal_status` es solo lectura. No existe handler para crear metas.
Phase A rutea a `ask_goal_status` que solo hace SELECT, no INSERT.
**Fix:** Crear handler `manage_goals` (similar a `manage_categories`) con operaciones:
create, edit, delete, add_progress. O extender `ask_goal_status` con operaciones de escritura.
**Prioridad:** Media — es un feature gap, no un bug del contexto.

### BUG F: "No encontré una transacción" cuando debería registrar
**Frecuencia:** ~8% de registros
**Causa raíz descubierta:** Gemini devuelve `response_type: "actions"` con `actions: []` vacío
pero pone el tool correcto en `tool_call`. Backend ve actions vacío → no ejecuta → cae a
bloque zombie o legacy path que falla.
**Fix:** Ya corregido — normalizar a `tool_call` si actions vacío + tool_call presente.

### BUG G: Referencias contextuales no funcionan
**Frecuencia:** ~15% de mensajes que referencian acciones previas
**Ejemplos:**
```
"Elimina esto que anotaste acá"     → "¿A qué te refieres?" (debería saber qué anotó)
"Perdón me equivoqué, vuelve a agregarlo" → Rutea a manage_transactions delete (opuesto!)
"Falta lo de abajo"                 → A veces funciona, a veces no
```
**Causa:** History solo tiene texto plano. Phase A no puede "buscar" en el historial
qué transacción se registró. Sin metadata, la IA no sabe qué tool se usó ni con qué args.
**Fix directo del plan:**
1. Metadata en history entries (Fase 1): `{ tool, amount, category, txId }`
2. Phase A puede ver en el historial: "la última acción fue register_transaction con $1390 en Alimentación"
3. Cuando usuario dice "elimínalo" → Phase A busca en metadata del historial el txId
4. Prompt Phase A: regla "si el usuario referencia una acción previa, busca en metadata del historial"

---

## Problemas del Contexto Conversacional

1. **10 pares = 20 entries es muy poco** — Gus no recuerda lo que pasó hace 5 mensajes
2. **TTL 10min borra todo** — Si el usuario se va 15min y vuelve, Gus no sabe nada
3. **Media no se guarda** — Fotos, audios, PDFs se pierden después del request
4. **assistant content es texto combinado** — Mezcla confirmaciones template con respuestas AI, dificulta búsqueda
5. **Summary es genérico** — Phase B genera un summary que a veces pierde info clave
6. **No hay búsqueda en historial** — Si no está en los 20 entries, no existe para la IA
7. **No hay persistencia a largo plazo** — Redis se borra, no hay backup en Supabase
8. **Slot-fill pierde contexto entre turnos** — Si pasan >10min, pending args se pierden y entra en loop
9. **Phase B contamina el history** — Repite confirmaciones, el contexto se llena de duplicados
10. **Sin metadata estructurada** — La IA no puede buscar "la última transacción" porque no sabe cuál fue

---

## Diseño Nuevo: 3 Tiers de Memoria

### Tier 1: Working Memory (Redis — hot)
**Lo que la IA ve directamente como mensajes previos.**

| Aspecto | Actual | Nuevo |
|---------|--------|-------|
| Max entries | 20 (10 pares) | **50 (25 pares)** |
| TTL | 10 min | **4 horas** |
| Contenido | Solo texto | **Texto + metadata** |
| Media | No se guarda | **Referencia + descripción** |

**Nuevo tipo ConversationMessage:**
```typescript
interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;               // Texto del mensaje
  timestamp: string;             // ISO-8601
  metadata?: {
    tool?: string;               // Tool usado (register_transaction, ask_balance, etc.)
    action?: string;             // Resultado: 'expense_registered', 'income_registered', 'balance_queried', etc.
    amount?: number;             // Monto si aplica
    category?: string;           // Categoría si aplica
    txId?: string;               // ID de transacción (para undo/delete/edit)
    slotFill?: boolean;          // true si es un mensaje de slot-fill (pregunta pendiente)
    media?: MediaReference[];    // Referencias a media enviada
  };
}

interface MediaReference {
  type: 'image' | 'audio' | 'document';
  mimeType: string;
  fileName?: string;
  description?: string;          // Descripción generada (OCR, transcripción, etc.)
}
```

**Cómo se inyecta a la IA:**
- Se serializa como texto para el campo `content` del mensaje
- La metadata permite a la IA buscar y referenciar acciones pasadas
- Las MediaReference se agregan como contexto extra al content

**Ejemplo de history enriquecido:**
```json
[
  {
    "role": "user",
    "content": "gasté 5 lucas en comida",
    "timestamp": "2026-03-19T15:13:46Z"
  },
  {
    "role": "assistant",
    "content": "✅ $5.000 — Comida\n🍽️ Alimentación · 19/3",
    "timestamp": "2026-03-19T15:13:54Z",
    "metadata": {
      "tool": "register_transaction",
      "action": "expense_registered",
      "amount": 5000,
      "category": "Alimentación",
      "txId": "a1b2c3d4-..."
    }
  },
  {
    "role": "user",
    "content": "elimínalo",
    "timestamp": "2026-03-19T15:14:10Z"
  },
  {
    "role": "assistant",
    "content": "🗑️ Eliminé $5.000 en Alimentación",
    "timestamp": "2026-03-19T15:14:15Z",
    "metadata": {
      "tool": "manage_transactions",
      "action": "transaction_deleted",
      "amount": 5000,
      "txId": "a1b2c3d4-..."
    }
  }
]
```

**Cómo esto resuelve Bug G (referencias contextuales):**
Phase A ve `metadata.txId` del registro anterior y puede usarlo para delete/edit sin preguntar.

### Tier 2: Session Summary (Redis — warm)
**Resumen compacto de la sesión para contexto rápido.**

| Aspecto | Actual | Nuevo |
|---------|--------|-------|
| TTL | 2-24h | **24 horas** |
| Generado por | Phase B (AI genera) | **Backend (determinístico)** |
| Contenido | Texto libre AI | **JSON estructurado** |

**Nuevo formato de summary:**
```typescript
interface SessionSummary {
  lastActivity: string;           // ISO timestamp
  todayTxCount: number;           // Transacciones registradas hoy
  todayTotalSpent: number;        // Total gastado hoy
  todayTotalIncome: number;       // Total ingresos hoy
  todayCategories: string[];      // Categorías usadas hoy
  lastTool: string;               // Última herramienta usada
  lastAmount?: number;            // Último monto registrado
  lastCategory?: string;          // Última categoría usada
  lastTxId?: string;              // Último ID de transacción (para "el último gasto")
  lastTxType?: string;            // 'expense' | 'income'
  sessionTopics: string[];        // Temas tocados: ['gastos', 'balance', 'metas']
  mediaReceived: number;          // Cantidad de media recibida en sesión
  failedAttempts: number;         // Intentos fallidos consecutivos (para detección de frustración)
}
```

**Ventaja:** Determinístico, nunca pierde datos clave, no depende de que la IA genere un buen resumen.
`failedAttempts` permite detectar cuando el usuario está frustrado y ajustar el approach.

**Se actualiza después de cada interacción:**
```
Después de tool execution exitosa:
  summary.todayTxCount += N (si register_transaction)
  summary.todayTotalSpent += amount (si expense)
  summary.todayTotalIncome += amount (si income)
  summary.todayCategories = dedupe([...existing, newCategory])
  summary.lastTool = toolName
  summary.lastAmount = amount
  summary.lastCategory = category
  summary.lastTxId = txId
  summary.lastTxType = type
  summary.sessionTopics = dedupe([...existing, topicFromTool])
  summary.lastActivity = now()
  summary.failedAttempts = 0  // reset on success

Después de fallo:
  summary.failedAttempts += 1
  summary.lastActivity = now()
```

**Cómo esto resuelve Bug C (bucle clarification):**
Si `failedAttempts >= 3`, el backend puede intervenir directamente:
- Enviar mensaje de ayuda: "Parece que algo no funciona. Intenta con: 'gasté [monto] en [categoría]'"
- O limpiar pending state y empezar de cero

### Tier 3: Long-Term Memory (Supabase — cold)
**Historial persistente para búsqueda y referencia.**

| Aspecto | Actual | Nuevo |
|---------|--------|-------|
| Almacenamiento | No existe | **Tabla `conversation_history` en Supabase** |
| Retención | N/A | **30 días** (o configurable) |
| Búsqueda | No existe | **Por userId + rango de fechas + tool + categoría** |

**Tabla `conversation_history`:**
```sql
CREATE TABLE conversation_history (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES users(id) NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  tool        TEXT,                    -- Tool usado (null para mensajes sin tool)
  action      TEXT,                    -- 'expense_registered', 'balance_queried', etc.
  amount      NUMERIC,                -- Monto si aplica
  category    TEXT,                    -- Categoría si aplica
  tx_id       UUID,                   -- ID de transacción vinculada
  media_type  TEXT,                    -- 'image', 'audio', 'document' o null
  media_desc  TEXT,                    -- Descripción del media
  channel     TEXT,                    -- 'telegram', 'whatsapp', 'test'
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_conv_history_user_date ON conversation_history(user_id, created_at DESC);
CREATE INDEX idx_conv_history_user_tool ON conversation_history(user_id, tool);
```

**Escritura:** Fire-and-forget después de cada interacción (como message_log).

**Lectura:** Solo cuando la IA necesita contexto más allá del Tier 1 (ver Recall System abajo).

---

## Recall System: Búsqueda en Historial Largo

### Problema
El usuario dice "cuánto gasté en comida la semana pasada?" o "qué te mandé ayer?" y Gus dice "no tengo acceso a esa información" porque no está en los 50 entries de Redis.

### Solución: Mejorar ask_balance con filtros

**Opción A (MVP — sin nuevo tool):** Agregar parámetros a `ask_balance`:
```typescript
// Tool schema actualizado
{
  name: "ask_balance",
  parameters: {
    period: "string — 'today', 'week', 'month', 'custom'",
    start_date: "string — ISO date (solo si period='custom')",
    end_date: "string — ISO date (solo si period='custom')",
    category: "string — filtrar por categoría específica",
    type: "string — 'expense', 'income', 'all' (default 'all')"
  }
}
```

**Ejemplo de uso:**
```
Usuario: "cuánto gasté en uber esta semana?"
Phase A: ask_balance { period: "week", category: "Transporte", type: "expense" }
Handler: SELECT SUM(amount) FROM transactions WHERE ... AND posted_at >= week_start AND category = 'Transporte'
```

**Opción B (futuro):** Nuevo tool `recall_history` que busca en `conversation_history`
cuando Phase A detecta preguntas sobre conversaciones pasadas ("qué te dije ayer?", "qué foto te mandé?").

---

## Media en Conversación

### Flujo de media actual
```
1. Usuario envía foto/audio/PDF via Telegram/WhatsApp
2. Adapter descarga el archivo → base64 en DomainMessage.media[]
3. Se pasa a Phase A como payload
4. Phase A (Gemini) puede "ver" la imagen
5. Después del request, el media se pierde
```

### Flujo nuevo
```
1. Usuario envía foto/audio/PDF
2. Adapter descarga → base64 en DomainMessage.media[]
3. Phase A recibe media → analiza (Gemini vision)
4. Phase A genera descripción del media en su respuesta
5. Backend guarda referencia en history:
   - Tier 1 (Redis): { type, mimeType, fileName, description }
   - Tier 3 (Supabase): media_type + media_desc
6. En mensajes futuros, la IA ve la referencia y puede decir
   "la boleta que me mandaste era de $23.450"
```

**No se guarda el base64 en Redis** — solo la referencia y descripción. Esto mantiene Redis liviano.

**Para PDFs y audios:** Requiere procesamiento adicional (transcripción, parsing). Se puede agregar después. Por ahora, guardar al menos `{ type: 'audio', description: 'Audio de 15 segundos' }`.

---

## Cambios por Archivo

### Backend

| Archivo | Cambio | Resuelve |
|---------|--------|----------|
| `redis/keys.ts` | TTL: `CONV_HISTORY: 14400` (4h), `CONV_SUMMARY_DEFAULT: 86400` (24h) | Bugs C, G (contexto persiste) |
| `orchestrator.contracts.ts` | Extender `ConversationMessage` con `timestamp`, `metadata` | Bugs G (referencias), A (metadata distingue template vs AI) |
| `conversation-history.service.ts` | `MAX_HISTORY_ENTRIES` → 50. Nuevo `appendWithMetadata()` | Bugs C, G |
| `conversation.service.ts` | Nuevo `SessionSummary` tipo. `updateSummary()` determinístico | Bug C (failedAttempts), Bug A (summary no depende de Phase B) |
| `bot.service.ts` | Actualizar history con metadata. Actualizar summary después de cada tool. Fallback para replies vacíos | Bugs A, C, D, G |
| `orchestrator.client.ts` | Serializar metadata en history para Phase A/B | Bug G |
| `guardrails.service.ts` | category opcional cuando type=income | Bug B |
| `register-transaction.tool-handler.ts` | category no required para ingresos | Bug B |

### AI Service

| Archivo | Cambio | Resuelve |
|---------|--------|----------|
| `schemas.py` | `ConversationMessage` acepta `timestamp`, `metadata` opcionales | Infra para todos |
| `orchestrator.py` | Inyectar metadata como contexto. Media como `[📷 descripción]` | Bug G |
| `tool_schemas.py` | `register_transaction.category`: "NO enviar para ingresos". `ask_balance`: agregar filtros | Bugs B, recall |
| `prompts/phase_a_system.txt` | Sección "HISTORIAL ENRIQUECIDO" + reglas de metadata + refuerzo ingresos | Bugs B, C, G |
| `prompts/phase_b_system.txt` | Phase B SOLO genera cierre breve, NUNCA repite confirmación | Bug A |

### Base de Datos

| Cambio | Descripción | Resuelve |
|--------|-------------|----------|
| Tabla `conversation_history` | Persistencia largo plazo con metadata | Recall, Tier 3 |
| Índices | user_id+date, user_id+tool | Performance recall |

---

## Orden de Implementación

### Fase 1: Bugs Críticos + History Mejorado (impacto inmediato)
**Bugs que se resuelven: A, B, C, D, F, G**

1. Subir `MAX_HISTORY_ENTRIES` de 20 a 50
2. Subir `CONV_HISTORY` TTL de 10min a 4 horas
3. Agregar `timestamp` y `metadata` a `ConversationMessage`
4. `appendWithMetadata()` — guarda tool, amount, category, txId en cada entry del assistant
5. Fix Bug B: category opcional para ingresos en handler + guardrails + tool schema
6. Fix Bug D: fallback si replies[] vacío → "No entendí tu mensaje"
7. Fix Bug A: Phase B solo genera cierre breve (ya planificado en la sesión anterior)
8. Actualizar AI service para leer metadata en history
9. Actualizar prompts Phase A: reglas de metadata + refuerzo ingresos + anti-loop slot-fill

### Fase 2: Summary Determinístico + Detección de Frustración
**Bugs que se resuelven: C (definitivo)**

1. Crear tipo `SessionSummary` con `failedAttempts`
2. Implementar `updateSessionSummary()` determinístico en backend
3. Si `failedAttempts >= 3`: intervención directa (limpiar pending, mensaje de ayuda)
4. Pasar SessionSummary como contexto estructurado a Phase B
5. Eliminar dependencia de Phase B para generar summary

### Fase 3: Media References
1. Guardar `MediaReference` en history entries
2. Agregar `[📷 Imagen: descripción]` al content del mensaje
3. Phase A ya analiza imágenes via Gemini — la descripción viene de ahí
4. Para audio/PDF: guardar metadata básica (tipo, duración/páginas, nombre)

### Fase 4: Long-Term Memory + Recall
1. Crear tabla `conversation_history` en Supabase
2. Insert fire-and-forget en cada interacción
3. Agregar filtros a `ask_balance` (period, category, type)
4. Futuro: tool `recall_history` para preguntas sobre conversaciones pasadas

---

## Configuración Redis Final

| Key | TTL | Max Size | Contenido |
|-----|-----|----------|-----------|
| `conv:{userId}:history` | **4 horas** | **50 entries** | Mensajes con metadata enriquecida |
| `conv:{userId}:summary` | **24 horas** | ~2KB | SessionSummary JSON estructurado |
| `conv:{userId}:pending` | 10 min | ~500B | Sin cambio |
| `conv:{userId}:block` | 10 min | ~2KB | Sin cambio |
| `conv:{userId}:cooldowns` | 30 días | ~500B | Sin cambio |
| `conv:{userId}:metrics` | 30 días | ~200B | Sin cambio |

---

## Estimación de Memoria Redis

**Por usuario activo (peor caso):**
- History: 50 entries × ~500 bytes (con metadata) = ~25KB
- Summary: ~2KB
- Otros: ~4KB
- **Total: ~31KB por usuario**

**100 usuarios activos simultáneos: ~3.1MB** — dentro de límites de Upstash free tier (256MB).

---

## Métricas de Éxito

| Métrica | Actual | Objetivo |
|---------|--------|----------|
| Mensajes en contexto | 10 pares | 25 pares |
| Ventana temporal | 10 min | 4 horas |
| Media recordada | 0% | 100% (referencia) |
| "No sé de qué hablas" | Frecuente (~15%) | Raro (<2%) |
| Bucle clarification | ~5% de multi-turno | 0% (detección + intervención) |
| Ingresos bloqueados | 100% fallan | 0% |
| Confirmaciones duplicadas | ~40% | 0% |
| Respuestas vacías | ~3% | 0% |
| Summary accuracy | Variable (AI) | Determinístico (siempre correcto) |
| Referencias contextuales | ~15% fallan | <3% |
