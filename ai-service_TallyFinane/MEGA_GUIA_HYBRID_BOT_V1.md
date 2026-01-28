# MEGA GUÍA V1: Arquitectura Híbrida del Bot TallyFinance

**Versión:** 1.0
**Fecha:** Diciembre 2024
**Principio central:** *"Backend ejecuta, IA entiende/decide/comunica"*

---

## Tabla de Contenidos

0. [Objetivo y Alcance V1](#0-objetivo-y-alcance-v1)
1. [Arquitectura Final](#1-arquitectura-final--componentes-y-responsabilidades)
2. [Contratos (Schemas)](#2-contratos-schemas)
3. [Endpoints a Tener](#3-endpoints-a-tener)
4. [Flujo Runtime End-to-End](#4-flujo-runtime-end-to-end)
5. [Componentes NestJS](#5-componentes-nestjs-por-archivomódulo)
6. [Componentes AI-Service](#6-componentes-ai-service-fastapi)
7. [Plan de Implementación Incremental](#7-plan-de-implementación-incremental)
8. [Pruebas y Checklist de Calidad](#8-pruebas-y-checklist-de-calidad)
9. [Riesgos y Decisiones Futuras](#9-riesgos-y-decisiones-futuras)

---

## 0. OBJETIVO Y ALCANCE V1

### 0.1 Qué ENTRA en V1

1. **Un único endpoint de IA:** `POST /orchestrate` en FastAPI
2. **Tool-calling loop** en NestJS: Backend → IA → Tool → IA → Respuesta
3. **5 tools funcionales:**
   - `register_transaction` (registrar gasto/ingreso)
   - `ask_balance` (consultar saldo) — *requiere resolver tabla accounts*
   - `ask_budget_status` (consultar presupuesto activo)
   - `ask_goal_status` (consultar metas)
   - `greeting` (saludos simples)
4. **Contexto mínimo cacheado** (30-120 segundos)
5. **Slot-filling** vía clarification questions
6. **Endpoint de debug:** `POST /bot/test`
7. **Guardrails básicos:** validación de argumentos, fallback ante errores de IA
8. **Personalización en respuestas:** tono/intensidad según `personality_snapshot`

### 0.2 Qué QUEDA FUERA de V1

- ❌ RAG / búsqueda semántica
- ❌ Proactive notifications
- ❌ OCR para comprobantes
- ❌ Audio/voice messages
- ❌ Contexto condicional (carga selectiva por intent)
- ❌ Multi-turn memory (cada mensaje es independiente)
- ❌ Fine-tuning de modelos
- ❌ Analytics/dashboards

---

## 1. ARQUITECTURA FINAL — COMPONENTES Y RESPONSABILIDADES

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CANALES EXTERNOS                                │
│         Telegram                    WhatsApp                  Web Test       │
└──────────┬────────────────────────────┬────────────────────────┬────────────┘
           │                            │                        │
           ▼                            ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         NestJS Backend (System of Record)                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         BotController                                │    │
│  │   POST /telegram/webhook   POST /whatsapp/webhook   POST /bot/test   │    │
│  └──────────────────────────────────┬──────────────────────────────────┘    │
│                                     │                                        │
│  ┌──────────────────────────────────▼──────────────────────────────────┐    │
│  │                           BotService                                 │    │
│  │  ┌────────────────────────────────────────────────────────────────┐ │    │
│  │  │                    TOOL-CALLING LOOP                            │ │    │
│  │  │  1. Obtener contexto mínimo (UserContextService)               │ │    │
│  │  │  2. Llamar /orchestrate Phase A (texto + context + tools)      │ │    │
│  │  │  3. Si tool_call → ejecutar handler → obtener ActionResult     │ │    │
│  │  │  4. Llamar /orchestrate Phase B (result + context)             │ │    │
│  │  │  5. Retornar mensaje final personalizado                        │ │    │
│  │  └────────────────────────────────────────────────────────────────┘ │    │
│  └──────────────────────────────────┬──────────────────────────────────┘    │
│                                     │                                        │
│  ┌──────────────────────────────────┼──────────────────────────────────┐    │
│  │                                  ▼                                   │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐  │    │
│  │  │UserContext   │  │ToolRegistry │  │     Tool Handlers          │  │    │
│  │  │Service       │  │             │  │ RegisterTransactionHandler │  │    │
│  │  │getMinimal()  │  │getHandler() │  │ AskBalanceHandler          │  │    │
│  │  │(cached)      │  │             │  │ AskBudgetStatusHandler     │  │    │
│  │  └──────────────┘  └──────────────┘  │ AskGoalStatusHandler       │  │    │
│  │                                      │ GreetingHandler            │  │    │
│  │  ┌──────────────┐                    │ UnknownHandler             │  │    │
│  │  │Guardrails    │                    └───────────────────────────┘  │    │
│  │  │validateArgs()│                                                    │    │
│  │  └──────────────┘                                                    │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
           ┌───────────────────────────┼───────────────────────────┐
           ▼                           ▼                           ▼
┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│   Supabase (DB)      │    │   FastAPI ai-service │    │   Telegram/WA API    │
│                      │    │                      │    │                      │
│  - users             │    │  POST /orchestrate   │    │  sendMessage()       │
│  - personality_snap  │    │  GET /health         │    │                      │
│  - user_prefs        │    │                      │    │                      │
│  - goals             │    │  ┌────────────────┐  │    │                      │
│  - categories        │    │  │ Phase A:       │  │    │                      │
│  - transactions      │    │  │ tool_call OR   │  │    │                      │
│  - spending_expect   │    │  │ clarification  │  │    │                      │
│  - channel_accounts  │    │  ├────────────────┤  │    │                      │
│  - channel_link_codes│    │  │ Phase B:       │  │    │                      │
│                      │    │  │ final message  │  │    │                      │
│                      │    │  └────────────────┘  │    │                      │
└──────────────────────┘    └──────────────────────┘    └──────────────────────┘
```

### 1.1 Responsabilidades por Componente

| Componente | Responsabilidad | NO debe hacer |
|------------|-----------------|---------------|
| **BotController** | Recibir webhooks, convertir a DomainMessage, devolver respuesta al canal | Lógica de negocio, formateo de mensajes |
| **BotService** | Orquestar el loop: context → AI → tool → AI → response | Acceso directo a DB, formateo final |
| **UserContextService** | Cargar datos mínimos del usuario, cachear por TTL | Cargar transactions, datos pesados |
| **ToolRegistry** | Mapear tool names a handler instances | Ejecutar lógica, decidir qué tool usar |
| **Tool Handlers** | Ejecutar operación en Supabase, retornar ActionResult | Formatear mensaje final, personalizar |
| **Guardrails** | Validar tool_call args antes de ejecutar | Decidir tool, comunicar errores al usuario |
| **OrchestratorClient** | HTTP client para POST /orchestrate | Lógica de retry, parsing complejo |
| **ai-service /orchestrate** | Decidir qué tool usar, generar mensaje final personalizado | Ejecutar DB, almacenar datos |

---

## 2. CONTRATOS (SCHEMAS)

### 2.1 ToolCall

```typescript
interface ToolCall {
  name: string;       // e.g., "register_transaction", "ask_balance"
  args: {
    [key: string]: any;
  };
}
```

**Ejemplo `register_transaction`:**
```json
{
  "name": "register_transaction",
  "args": {
    "amount": 15000,
    "category": "comida",
    "date": "2024-12-27",
    "payment_method": null
  }
}
```

**Ejemplo `ask_balance`:**
```json
{
  "name": "ask_balance",
  "args": {}
}
```

### 2.2 ActionResult

```typescript
interface ActionResult {
  ok: boolean;
  action: ActionType;  // "register_transaction" | "ask_balance" | "ask_budget_status" | "ask_goal_status" | "greeting" | "none"
  data?: Record<string, any>;    // Datos estructurados para Phase B
  userMessage?: string;          // SOLO para slot-filling (clarification)
  errorCode?: string;            // SOLO si ok=false
}

type ActionType =
  | 'none'
  | 'register_transaction'
  | 'ask_balance'
  | 'ask_budget_status'
  | 'ask_goal_status';
```

**Ejemplo éxito:**
```json
{
  "ok": true,
  "action": "register_transaction",
  "data": {
    "amount": 15000,
    "category": "Comida",
    "date": "2024-12-27T00:00:00Z",
    "transaction_id": "uuid-xxx"
  }
}
```

**Ejemplo slot-filling (falta amount):**
```json
{
  "ok": true,
  "action": "register_transaction",
  "userMessage": "¿Cuánto fue el gasto exactamente?"
}
```

**Ejemplo error:**
```json
{
  "ok": false,
  "action": "register_transaction",
  "errorCode": "CATEGORY_NOT_FOUND"
}
```

### 2.3 OrchestrateRequest (Phase A)

```typescript
interface OrchestrateRequestPhaseA {
  phase: "A";
  user_text: string;
  user_context: MinimalUserContext;
  tools: ToolSchema[];
}

interface MinimalUserContext {
  user_id: string;
  personality: {
    tone: string;       // "neutral" | "friendly" | "serious" | "motivational" | "strict"
    intensity: number;  // 0.0 - 1.0
    mood: string;       // "normal" | "happy" | "stressed"
  } | null;
  prefs: {
    notification_level: string;  // "none" | "light" | "medium" | "intense"
    unified_balance: boolean;
  } | null;
  active_budget: {
    period: string;  // "daily" | "weekly" | "monthly"
    amount: number;
  } | null;
  goals_summary: string[];  // ["Viaje a Europa (45%)", "Fondo emergencia (80%)"]
}

interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}
```

**Ejemplo completo Phase A:**
```json
{
  "phase": "A",
  "user_text": "gasté 15 lucas en comida",
  "user_context": {
    "user_id": "uuid-123",
    "personality": {
      "tone": "friendly",
      "intensity": 0.7,
      "mood": "normal"
    },
    "prefs": {
      "notification_level": "medium",
      "unified_balance": true
    },
    "active_budget": {
      "period": "monthly",
      "amount": 500000
    },
    "goals_summary": ["Viaje a Europa (45%)"]
  },
  "tools": [
    {
      "name": "register_transaction",
      "description": "Registra un gasto o ingreso del usuario",
      "parameters": {
        "type": "object",
        "properties": {
          "amount": { "type": "number", "description": "Monto en CLP" },
          "category": { "type": "string", "description": "Nombre de la categoría" },
          "date": { "type": "string", "description": "Fecha ISO-8601, default hoy" },
          "payment_method": { "type": "string", "description": "Método de pago opcional" }
        },
        "required": ["amount", "category"]
      }
    }
  ]
}
```

### 2.4 OrchestrateResponse (Phase A)

```typescript
interface OrchestrateResponsePhaseA {
  phase: "A";
  response_type: "tool_call" | "clarification" | "direct_reply";
  tool_call?: ToolCall;           // Si response_type === "tool_call"
  clarification?: string;         // Si response_type === "clarification"
  direct_reply?: string;          // Si response_type === "direct_reply" (raro: solo saludos)
}
```

**Ejemplo tool_call:**
```json
{
  "phase": "A",
  "response_type": "tool_call",
  "tool_call": {
    "name": "register_transaction",
    "args": {
      "amount": 15000,
      "category": "comida",
      "date": "2024-12-27"
    }
  }
}
```

**Ejemplo clarification:**
```json
{
  "phase": "A",
  "response_type": "clarification",
  "clarification": "¿En qué categoría quieres que registre este gasto?"
}
```

**Ejemplo direct_reply:**
```json
{
  "phase": "A",
  "response_type": "direct_reply",
  "direct_reply": "¡Hola! ¿En qué te puedo ayudar hoy?"
}
```

### 2.5 OrchestrateRequest (Phase B)

```typescript
interface OrchestrateRequestPhaseB {
  phase: "B";
  tool_name: string;
  action_result: ActionResult;
  user_context: MinimalUserContext;
}
```

**Ejemplo:**
```json
{
  "phase": "B",
  "tool_name": "register_transaction",
  "action_result": {
    "ok": true,
    "action": "register_transaction",
    "data": {
      "amount": 15000,
      "category": "Comida",
      "date": "2024-12-27T00:00:00Z"
    }
  },
  "user_context": {
    "user_id": "uuid-123",
    "personality": {
      "tone": "friendly",
      "intensity": 0.7,
      "mood": "normal"
    },
    "prefs": null,
    "active_budget": {
      "period": "monthly",
      "amount": 500000
    },
    "goals_summary": []
  }
}
```

### 2.6 OrchestrateResponse (Phase B)

```typescript
interface OrchestrateResponsePhaseB {
  phase: "B";
  final_message: string;
}
```

**Ejemplo:**
```json
{
  "phase": "B",
  "final_message": "¡Listo! 🎉 Registré $15.000 en Comida. Vas súper bien con tu presupuesto mensual, ¡sigue así!"
}
```

---

## 3. ENDPOINTS A TENER

### 3.1 NestJS Backend

| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| POST | `/telegram/webhook` | No (validación Telegram) | Recibe updates de Telegram |
| POST | `/whatsapp/webhook` | No (validación WhatsApp) | Recibe updates de WhatsApp |
| POST | `/bot/test` | No (solo dev) | Debug sin canal real |

#### 3.1.1 POST /bot/test

**Request:**
```json
{
  "channel": "telegram",
  "externalId": "12345678",
  "text": "gasté 20 lucas en transporte"
}
```

**Response (200):**
```json
{
  "reply": "¡Anotado! $20.000 en Transporte. 🚌",
  "debug": {
    "phase_a": { "response_type": "tool_call", "tool_call": { "name": "register_transaction", "args": {} } },
    "action_result": { "ok": true, "action": "register_transaction", "data": {} },
    "phase_b": { "final_message": "..." },
    "duration_ms": 1234
  }
}
```

**Response (sin linking):**
```json
{
  "reply": "👋 ¡Hola! Aún no hemos vinculado tu cuenta...",
  "debug": {
    "reason": "user_not_linked"
  }
}
```

### 3.2 FastAPI ai-service

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/orchestrate` | Único endpoint de IA |
| GET | `/health` | Health check |

#### 3.2.1 POST /orchestrate

**Request Phase A:** (ver sección 2.3)

**Response Phase A:** (ver sección 2.4)

**Request Phase B:** (ver sección 2.5)

**Response Phase B:** (ver sección 2.6)

**Errores:**

| HTTP | Código | Descripción |
|------|--------|-------------|
| 400 | `INVALID_PHASE` | Phase debe ser "A" o "B" |
| 400 | `MISSING_USER_TEXT` | Phase A requiere user_text |
| 400 | `MISSING_ACTION_RESULT` | Phase B requiere action_result |
| 500 | `LLM_ERROR` | Error llamando al modelo |
| 503 | `LLM_TIMEOUT` | Timeout del modelo (30s) |

#### 3.2.2 GET /health

**Response (200):**
```json
{
  "status": "healthy",
  "model": "gpt-4o-mini",
  "version": "1.0.0"
}
```

---

## 4. FLUJO RUNTIME END-TO-END

### 4.1 Diagrama de Secuencia (Usuario Vinculado)

```
Usuario        Telegram      BotController    BotService       UserContext    Orchestrator    ToolHandler     Supabase
   │               │              │               │                 │              │               │              │
   │ "gasté 15 lucas"             │               │                 │              │               │              │
   ├──────────────►│              │               │                 │              │               │              │
   │               │──webhook────►│               │                 │              │               │              │
   │               │              │─fromIncoming()│                 │              │               │              │
   │               │              │──DomainMsg───►│                 │              │               │              │
   │               │              │               │                 │              │               │              │
   │               │              │               │─lookupLinkedUser()────────────────────────────►│              │
   │               │              │               │◄────userId──────────────────────────────────────│              │
   │               │              │               │                 │              │               │              │
   │               │              │               │──getMinimal()──►│              │               │              │
   │               │              │               │◄──context───────│              │               │              │
   │               │              │               │                 │              │               │              │
   │               │              │               │══════ PHASE A ═══════════════►│               │              │
   │               │              │               │◄═══ tool_call ════════════════│               │              │
   │               │              │               │                 │              │               │              │
   │               │              │               │──validateArgs()──►             │               │              │
   │               │              │               │◄─────ok──────────              │               │              │
   │               │              │               │                 │              │               │              │
   │               │              │               │──getHandler()──────────────────────────────────►│              │
   │               │              │               │──execute()─────────────────────────────────────►│──INSERT─────►│
   │               │              │               │◄─ActionResult───────────────────────────────────│◄─────ok──────│
   │               │              │               │                 │              │               │              │
   │               │              │               │══════ PHASE B ═══════════════►│               │              │
   │               │              │               │◄═ final_message ══════════════│               │              │
   │               │              │               │                 │              │               │              │
   │               │              │◄──reply───────│                 │              │               │              │
   │               │◄─sendReply───│               │                 │              │               │              │
   │◄──────────────│              │               │                 │              │               │              │
```

### 4.2 Flujo Narrativo — Caso Exitoso

1. **Usuario envía mensaje** vía Telegram: `"gasté 15 lucas en comida"`
2. **Telegram webhook** llega a `POST /telegram/webhook`
3. **BotController** usa `TelegramAdapter.fromIncoming()` → `DomainMessage`
4. **BotController** llama `BotService.handle(domainMessage)`
5. **BotService** verifica vinculación:
   - `BotChannelService.handleLinkToken()` → null (no es comando /start)
   - `BotChannelService.lookupLinkedUser()` → `userId`
6. **BotService** obtiene contexto:
   - `UserContextService.getMinimal(userId)` → `MinimalUserContext` (cached)
7. **BotService** llama Phase A:
   - `OrchestratorClient.phaseA(text, context, tools)` → `{ response_type: "tool_call", tool_call: {...} }`
8. **BotService** valida argumentos:
   - `Guardrails.validateArgs("register_transaction", args)` → ok
9. **BotService** ejecuta tool:
   - `ToolRegistry.getHandler("register_transaction")` → `RegisterTransactionHandler`
   - `handler.execute(userId, domainMessage, toolCall.args)` → `ActionResult`
10. **BotService** llama Phase B:
    - `OrchestratorClient.phaseB(toolName, actionResult, context)` → `{ final_message: "..." }`
11. **BotService** retorna mensaje final
12. **BotController** envía respuesta vía `TelegramAdapter.sendReply()`

### 4.3 Flujo — Usuario No Vinculado

1. `BotChannelService.lookupLinkedUser()` → `null`
2. `BotChannelService.buildLinkReply()` genera URL de vinculación
3. **Retorno inmediato** sin llamar a IA

### 4.4 Flujo — Slot-Filling (Falta Información)

1-6. Igual que caso exitoso
7. Phase A retorna: `{ response_type: "clarification", clarification: "¿En qué categoría?" }`
8. **BotService retorna** `clarification` directamente (sin Phase B)
9. Usuario responde: `"comida"`
10. **Nuevo ciclo completo** con el nuevo mensaje

### 4.5 Flujo — Error en Tool

1-8. Igual que caso exitoso
9. `handler.execute()` → `ActionResult { ok: false, errorCode: "CATEGORY_NOT_FOUND" }`
10. Phase B recibe error → genera mensaje amigable: `"No encontré la categoría 'xyz'. ¿Quizás quisiste decir...?"`

### 4.6 Flujo — IA Retorna Payload Inválido

1-6. Igual que caso exitoso
7. Phase A retorna JSON malformado o campos faltantes
8. **Guardrails** detecta error:
   - Log del error con correlation_id
   - Retorna mensaje fallback: `"Hubo un problema procesando tu mensaje. Por favor intenta de nuevo."`
9. **NO se ejecuta ningún tool**

---

## 5. COMPONENTES NESTJS (Por Archivo/Módulo)

### 5.1 BotService

**Archivo:** `src/bot/bot.service.ts`

**Responsabilidades:**
1. Orquestar el flujo completo de manejo de mensajes
2. Coordinar llamadas entre componentes
3. Manejar errores y fallbacks
4. Generar correlation_id para logging

**Inputs:**
- `DomainMessage` desde controller

**Outputs:**
- `string` (mensaje de respuesta)

**Dependencias:**
- `BotChannelService` — vinculación
- `UserContextService` — contexto
- `OrchestratorClient` — llamadas a IA
- `ToolRegistry` — obtener handlers
- `Guardrails` — validación

**Pseudo-código del loop:**
```typescript
async handle(m: DomainMessage): Promise<string> {
  const correlationId = generateCorrelationId();
  this.log.debug(`[${correlationId}] Mensaje recibido: ${m.text}`);

  // 1. Vinculación
  const linkReply = await this.channels.handleLinkToken(m);
  if (linkReply) return linkReply;

  const userId = await this.channels.lookupLinkedUser(m);
  if (!userId) return this.channels.buildLinkReply(m);

  // 2. Contexto
  const context = await this.contextService.getMinimal(userId);

  // 3. Phase A
  const phaseA = await this.orchestrator.phaseA(m.text, context, this.toolSchemas);

  // 4. Procesar respuesta Phase A
  if (phaseA.response_type === 'direct_reply') {
    return phaseA.direct_reply;
  }

  if (phaseA.response_type === 'clarification') {
    return phaseA.clarification;
  }

  // 5. Validar y ejecutar tool
  const toolCall = phaseA.tool_call;
  const validation = this.guardrails.validateArgs(toolCall.name, toolCall.args);
  if (!validation.ok) {
    return this.fallbackMessage(validation.reason);
  }

  const handler = this.toolRegistry.getHandler(toolCall.name);
  const result = await handler.execute(userId, m, toolCall.args);

  // 6. Si handler pide clarificación (slot-filling), retornar
  if (result.userMessage) {
    return result.userMessage;
  }

  // 7. Phase B
  const phaseB = await this.orchestrator.phaseB(toolCall.name, result, context);

  return phaseB.final_message;
}
```

**LO QUE NO DEBE HACER:**
- ❌ Acceder directamente a Supabase
- ❌ Formatear mensajes (eso lo hace IA)
- ❌ Decidir qué tool usar (eso lo hace IA)
- ❌ Implementar lógica de negocio

### 5.2 UserContextService

**Archivo:** `src/bot/services/user-context.service.ts` (NUEVO)

**Responsabilidades:**
1. Cargar datos mínimos del usuario desde Supabase
2. Cachear resultados por userId (TTL 60 segundos)
3. Transformar datos a formato `MinimalUserContext`

**Método principal:**
```typescript
async getMinimal(userId: string): Promise<MinimalUserContext>
```

**Datos que carga (5 queries paralelas):**
1. `personality_snapshot` (tone, intensity, mood)
2. `user_prefs` (notification_level, unified_balance)
3. `spending_expectations` WHERE active = true
4. `goals` (solo id, name, progress_amount, target_amount)

**Datos que NO carga:**
- ❌ transactions
- ❌ categories completas (solo names en V2)
- ❌ payment_methods
- ❌ channel_accounts

**Caché:**
```typescript
private cache = new Map<string, { data: MinimalUserContext; expiry: number }>();

async getMinimal(userId: string): Promise<MinimalUserContext> {
  const now = Date.now();
  const cached = this.cache.get(userId);

  if (cached && cached.expiry > now) {
    return cached.data;
  }

  const data = await this.loadFromDb(userId);
  this.cache.set(userId, { data, expiry: now + 60_000 }); // 60 segundos

  return data;
}
```

**LO QUE NO DEBE HACER:**
- ❌ Cargar datos pesados (transactions)
- ❌ Transformar datos para UI (eso es controller)
- ❌ Acceder a contexto de sesión/auth

### 5.3 ToolRegistry

**Archivo:** `src/bot/tools/tool-registry.ts` (NUEVO)

**Responsabilidades:**
1. Mantener mapa de tool names → handler instances
2. Proveer método `getHandler(name): ToolHandler`
3. Proveer lista de tool schemas para Phase A

**Interfaz:**
```typescript
interface ToolHandler {
  execute(
    userId: string,
    msg: DomainMessage,
    args: Record<string, any>,
  ): Promise<ActionResult>;
}
```

**Implementación:**
```typescript
@Injectable()
export class ToolRegistry {
  private handlers: Map<string, ToolHandler>;

  constructor(@Inject('SUPABASE') supabase: SupabaseClient) {
    this.handlers = new Map([
      ['register_transaction', new RegisterTransactionHandler(supabase)],
      ['ask_balance', new AskBalanceHandler(supabase)],
      ['ask_budget_status', new AskBudgetStatusHandler(supabase)],
      ['ask_goal_status', new AskGoalStatusHandler(supabase)],
      ['greeting', new GreetingHandler()],
    ]);
  }

  getHandler(name: string): ToolHandler {
    return this.handlers.get(name) ?? new UnknownHandler();
  }

  getToolSchemas(): ToolSchema[] {
    return TOOL_SCHEMAS; // definidos en constante
  }
}
```

**LO QUE NO DEBE HACER:**
- ❌ Ejecutar lógica de handlers
- ❌ Decidir qué handler usar (eso viene de IA)
- ❌ Validar argumentos (eso es Guardrails)

### 5.4 Tool Handlers

**Directorio:** `src/bot/tools/handlers/`

#### 5.4.1 RegisterTransactionHandler

**Archivo:** `src/bot/tools/handlers/register-transaction.handler.ts`

**Input args:**
```typescript
{
  amount: number;      // REQUIRED
  category: string;    // REQUIRED
  date?: string;       // ISO-8601, default: hoy
  payment_method?: string;
}
```

**Lógica:**
1. Buscar category por nombre en `categories` WHERE user_id
2. Si no existe → retornar `ActionResult { ok: true, action: 'register_transaction', userMessage: "No encontré la categoría..." }`
3. Normalizar fecha (default: hoy)
4. INSERT en `transactions`
5. Retornar `ActionResult { ok: true, data: { amount, category, date, transaction_id } }`

**Retorna userMessage solo si:**
- Categoría no encontrada → lista de categorías disponibles

**NO hace:**
- ❌ Formatear mensaje final (eso hace IA)
- ❌ Verificar si falta amount/category (eso hace IA en Phase A)

#### 5.4.2 AskBalanceHandler

**Archivo:** `src/bot/tools/handlers/ask-balance.handler.ts`

**NOTA:** Requiere resolver si existe tabla `accounts` o cambiar lógica.

**Input args:**
```typescript
{} // Sin argumentos
```

**Lógica:**
1. SELECT * FROM `accounts` WHERE user_id (o `payment_method` si no hay accounts)
2. Calcular total
3. Retornar `ActionResult { ok: true, data: { accounts: [...], total } }`

#### 5.4.3 AskBudgetStatusHandler

**Archivo:** `src/bot/tools/handlers/ask-budget-status.handler.ts`

**Input args:**
```typescript
{} // Sin argumentos
```

**Lógica:**
1. SELECT FROM `spending_expectations` WHERE user_id AND active = true
2. Retornar `ActionResult { ok: true, data: { active: { period, amount } } }`

#### 5.4.4 AskGoalStatusHandler

**Archivo:** `src/bot/tools/handlers/ask-goal-status.handler.ts`

**Input args:**
```typescript
{} // Sin argumentos
```

**Lógica:**
1. SELECT * FROM `goals` WHERE user_id
2. Calcular porcentajes
3. Retornar `ActionResult { ok: true, data: { goals: [...] } }`

#### 5.4.5 GreetingHandler

**Archivo:** `src/bot/tools/handlers/greeting.handler.ts`

**Input args:**
```typescript
{} // Sin argumentos
```

**Lógica:**
1. Retornar `ActionResult { ok: true, action: 'none' }`
2. Phase B genera saludo personalizado

#### 5.4.6 UnknownHandler

**Archivo:** `src/bot/tools/handlers/unknown.handler.ts`

**Lógica:**
1. Retornar `ActionResult { ok: true, action: 'none' }`
2. Phase B genera mensaje de "no entendí"

### 5.5 Guardrails

**Archivo:** `src/bot/guardrails/guardrails.service.ts` (NUEVO)

**Responsabilidades:**
1. Validar tool_call.args antes de ejecutar
2. Aplicar reglas de seguridad (amount > 0, date válida, etc.)
3. Sanitizar inputs

**Método principal:**
```typescript
validateArgs(toolName: string, args: Record<string, any>): ValidationResult

interface ValidationResult {
  ok: boolean;
  reason?: string;
  sanitizedArgs?: Record<string, any>;
}
```

**Validaciones por tool:**

| Tool | Validación |
|------|------------|
| `register_transaction` | amount > 0, amount < 100_000_000, date es ISO válido o null, category es string no vacío |
| `ask_balance` | Sin args, cualquier extra se ignora |
| `ask_budget_status` | Sin args |
| `ask_goal_status` | Sin args |
| `greeting` | Sin args |

### 5.6 OrchestratorClient

**Archivo:** `src/bot/clients/orchestrator.client.ts` (NUEVO)

**Responsabilidades:**
1. HTTP client para POST `/orchestrate`
2. Serializar/deserializar requests/responses
3. Manejo de timeouts (30s)
4. Logging de llamadas

**Métodos:**
```typescript
async phaseA(
  userText: string,
  context: MinimalUserContext,
  tools: ToolSchema[],
): Promise<OrchestrateResponsePhaseA>

async phaseB(
  toolName: string,
  result: ActionResult,
  context: MinimalUserContext,
): Promise<OrchestrateResponsePhaseB>
```

**Configuración:**
```typescript
@Injectable()
export class OrchestratorClient {
  private readonly baseUrl: string;

  constructor(cfg: ConfigService) {
    this.baseUrl = cfg.get<string>('AI_SERVICE_URL');
  }

  async phaseA(...): Promise<OrchestrateResponsePhaseA> {
    const { data } = await axios.post(
      `${this.baseUrl}/orchestrate`,
      { phase: 'A', user_text: userText, user_context: context, tools },
      { timeout: 30_000 },
    );
    return data;
  }
}
```

**LO QUE NO DEBE HACER:**
- ❌ Retry automático (en V1)
- ❌ Parsing complejo de respuestas
- ❌ Lógica de negocio

---

## 6. COMPONENTES AI-SERVICE (FastAPI)

### 6.1 Estructura de Archivos

```
ai-service/
├── app.py                    # FastAPI app + endpoints
├── orchestrator.py           # Lógica de orquestación
├── prompts/
│   ├── phase_a_system.txt    # System prompt Phase A
│   └── phase_b_system.txt    # System prompt Phase B
├── schemas.py                # Pydantic models
├── tool_schemas.py           # Definiciones de tools
└── config.py                 # Configuración
```

### 6.2 Endpoint /orchestrate

**Archivo:** `app.py`

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from orchestrator import Orchestrator

app = FastAPI()
orchestrator = Orchestrator()

@app.post("/orchestrate")
async def orchestrate(request: OrchestrateRequest):
    if request.phase == "A":
        return await orchestrator.phase_a(
            user_text=request.user_text,
            user_context=request.user_context,
            tools=request.tools,
        )
    elif request.phase == "B":
        return await orchestrator.phase_b(
            tool_name=request.tool_name,
            action_result=request.action_result,
            user_context=request.user_context,
        )
    else:
        raise HTTPException(status_code=400, detail="INVALID_PHASE")
```

### 6.3 Orquestador

**Archivo:** `orchestrator.py`

#### 6.3.1 Phase A — Decisión de Tool

**Prompt System Phase A:**
```
Eres un asistente financiero que ayuda a usuarios a gestionar sus gastos.

Tu tarea es analizar el mensaje del usuario y decidir:
1. Si necesitas usar una herramienta (tool_call)
2. Si necesitas más información (clarification)
3. Si puedes responder directamente (direct_reply) — SOLO para saludos simples

REGLAS ESTRICTAS:
- SIEMPRE responde en JSON válido con el formato especificado
- Si el usuario menciona un gasto/ingreso → usa "register_transaction"
- Si el usuario pregunta por saldo/balance → usa "ask_balance"
- Si el usuario pregunta por presupuesto → usa "ask_budget_status"
- Si el usuario pregunta por metas → usa "ask_goal_status"
- Si es un saludo simple ("hola", "buenos días") → usa "greeting"
- Si falta información esencial (monto, categoría) → genera clarification
- NO inventes datos. Si algo falta, pregunta.

CONTEXTO DEL USUARIO:
{user_context}

HERRAMIENTAS DISPONIBLES:
{tool_schemas}

FORMATO DE RESPUESTA (estricto):
{
  "response_type": "tool_call" | "clarification" | "direct_reply",
  "tool_call": { "name": "...", "args": {...} },  // solo si response_type = tool_call
  "clarification": "...",  // solo si response_type = clarification
  "direct_reply": "..."    // solo si response_type = direct_reply
}
```

**Código Phase A:**
```python
async def phase_a(self, user_text: str, user_context: dict, tools: list) -> dict:
    prompt = self.load_prompt("phase_a_system.txt").format(
        user_context=json.dumps(user_context, ensure_ascii=False),
        tool_schemas=json.dumps(tools, ensure_ascii=False),
    )

    response = await self.llm.chat(
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_text},
        ],
        response_format={"type": "json_object"},
        temperature=0.3,
    )

    result = json.loads(response.content)
    return {"phase": "A", **result}
```

#### 6.3.2 Phase B — Generación de Mensaje Final

**Prompt System Phase B:**
```
Eres un asistente financiero amigable y personalizado.

Tu tarea es generar un mensaje de respuesta para el usuario basándote en:
1. El resultado de la operación ejecutada
2. El perfil de personalidad del usuario

PERSONALIDAD DEL USUARIO:
- Tono: {tone}
- Intensidad: {intensity}
- Estado de ánimo: {mood}

RESULTADO DE LA OPERACIÓN:
- Tool: {tool_name}
- Éxito: {ok}
- Datos: {data}
{error_info}

REGLAS DE PERSONALIZACIÓN:
- Si tono = "friendly": Usa emojis moderados, sé cálido
- Si tono = "serious": Sé conciso y profesional
- Si tono = "motivational": Incluye frases de ánimo relacionadas con finanzas
- Si intensidad > 0.7: Más expresivo
- Si intensidad < 0.3: Más sobrio

CONTEXTO ADICIONAL:
- Presupuesto activo: {active_budget}
- Metas: {goals_summary}

IMPORTANTE:
- Responde SOLO con el mensaje, sin JSON
- Usa formato CLP para montos (ej: $15.000)
- Si hubo error, sé empático y sugiere alternativas
- Máximo 2 oraciones
```

**Código Phase B:**
```python
async def phase_b(self, tool_name: str, action_result: dict, user_context: dict) -> dict:
    personality = user_context.get("personality") or {}

    prompt = self.load_prompt("phase_b_system.txt").format(
        tone=personality.get("tone", "neutral"),
        intensity=personality.get("intensity", 0.5),
        mood=personality.get("mood", "normal"),
        tool_name=tool_name,
        ok=action_result.get("ok"),
        data=json.dumps(action_result.get("data", {}), ensure_ascii=False),
        error_info=f"Error: {action_result.get('errorCode')}" if not action_result.get("ok") else "",
        active_budget=json.dumps(user_context.get("active_budget"), ensure_ascii=False),
        goals_summary=", ".join(user_context.get("goals_summary", [])),
    )

    response = await self.llm.chat(
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": "Genera el mensaje de respuesta."},
        ],
        temperature=0.7,
    )

    return {"phase": "B", "final_message": response.content}
```

### 6.4 Manejo de Clarification Questions

Cuando Phase A retorna `clarification`, el backend:
1. **NO llama a Phase B**
2. Retorna `clarification` directamente al usuario
3. El siguiente mensaje del usuario inicia un **nuevo ciclo completo**

**Ejemplo de clarification:**
```json
{
  "phase": "A",
  "response_type": "clarification",
  "clarification": "¿Cuánto fue el gasto exactamente? Por ejemplo: 15000"
}
```

### 6.5 Incorporación de Personalidad

La personalidad afecta **SOLO** Phase B:

| Tono | Ejemplo de respuesta |
|------|---------------------|
| `neutral` | "Registré $15.000 en Comida." |
| `friendly` | "¡Listo! 🎉 Registré $15.000 en Comida. ¡Buen provecho!" |
| `serious` | "Transacción registrada: $15.000 en categoría Comida." |
| `motivational` | "¡Genial! $15.000 en Comida. Cada registro te acerca más a tus metas 💪" |
| `strict` | "Registrado. $15.000 en Comida. Recuerda revisar tu presupuesto." |

### 6.6 Retries y Timeouts

**Configuración en ai-service:**
- Timeout LLM: 25 segundos
- Timeout total endpoint: 30 segundos
- Retries: 1 (solo si timeout)
- Fallback si falla: `{"phase": "B", "final_message": "Hubo un problema. Por favor intenta de nuevo."}`

---

## 7. PLAN DE IMPLEMENTACIÓN INCREMENTAL

### Sprint 1: Infraestructura y Contexto

#### Paso 1.1: Crear UserContextService
**Meta:** Tener servicio de contexto mínimo con cache

**Archivos a crear:**
- `src/bot/services/user-context.service.ts`

**Archivos a modificar:**
- `src/bot/bot.module.ts` (añadir provider)

**Criterios de aceptación:**
- [ ] `getMinimal(userId)` retorna `MinimalUserContext`
- [ ] Cache funciona (segunda llamada no hace queries)
- [ ] Cache expira después de 60 segundos

**Test Postman:**
```
// No hay endpoint directo, probar vía unit test
// O añadir endpoint temporal GET /bot/context/:userId
```

#### Paso 1.2: Crear OrchestratorClient (stub)
**Meta:** Tener cliente HTTP listo para llamar a /orchestrate

**Archivos a crear:**
- `src/bot/clients/orchestrator.client.ts`
- `src/bot/contracts/orchestrator.contracts.ts` (tipos)

**Archivos a modificar:**
- `src/bot/bot.module.ts`

**Criterios de aceptación:**
- [ ] Métodos `phaseA()` y `phaseB()` definidos
- [ ] Timeout configurado a 30s
- [ ] Logging de requests/responses
- [ ] Por ahora retorna mock responses

**Test Postman:** N/A (es cliente, no endpoint)

#### Paso 1.3: Crear Guardrails Service
**Meta:** Tener validación de argumentos

**Archivos a crear:**
- `src/bot/guardrails/guardrails.service.ts`

**Criterios de aceptación:**
- [ ] `validateArgs("register_transaction", {amount: -5})` → `{ ok: false, reason: "amount_invalid" }`
- [ ] `validateArgs("register_transaction", {amount: 100, category: "food"})` → `{ ok: true }`

---

### Sprint 2: Tool Registry y Refactor Handlers

#### Paso 2.1: Crear ToolRegistry
**Meta:** Centralizar mapeo de tools

**Archivos a crear:**
- `src/bot/tools/tool-registry.ts`
- `src/bot/tools/tool-schemas.ts` (constantes JSON)

**Archivos a modificar:**
- `src/bot/bot.module.ts`

**Criterios de aceptación:**
- [ ] `getHandler("register_transaction")` retorna handler
- [ ] `getHandler("unknown_tool")` retorna UnknownHandler
- [ ] `getToolSchemas()` retorna array de ToolSchema

#### Paso 2.2: Refactorizar Handlers
**Meta:** Handlers reciben args directamente, no IntentResult

**Archivos a modificar:**
- `src/bot/intents/handlers/register-transaction.handler.ts` → mover a `src/bot/tools/handlers/`
- Ídem para todos los handlers

**Nueva interfaz:**
```typescript
interface ToolHandler {
  execute(userId: string, msg: DomainMessage, args: Record<string, any>): Promise<ActionResult>;
}
```

**Criterios de aceptación:**
- [ ] Cada handler implementa nueva interfaz
- [ ] Handlers movidos a `src/bot/tools/handlers/`
- [ ] Tests pasan

#### Paso 2.3: Crear endpoint /bot/test
**Meta:** Poder probar sin Telegram

**Archivos a modificar:**
- `src/bot/bot.controller.ts`

**Criterios de aceptación:**
- [ ] `POST /bot/test` acepta `{ channel, externalId, text }`
- [ ] Retorna `{ reply, debug }`
- [ ] Funciona con usuario vinculado

**Test Postman:**
```json
POST /bot/test
{
  "channel": "telegram",
  "externalId": "123456",
  "text": "hola"
}
```

---

### Sprint 3: Integración con FastAPI

#### Paso 3.1: Crear /orchestrate en FastAPI
**Meta:** Endpoint funcional en ai-service

**Archivos a crear (ai-service):**
- `orchestrator.py`
- `prompts/phase_a_system.txt`
- `prompts/phase_b_system.txt`
- `schemas.py`

**Archivos a modificar:**
- `app.py`

**Criterios de aceptación:**
- [ ] `POST /orchestrate` con phase="A" retorna tool_call o clarification
- [ ] `POST /orchestrate` con phase="B" retorna final_message
- [ ] Logs claros de prompts y respuestas

**Test Postman:**
```json
POST http://localhost:8000/orchestrate
{
  "phase": "A",
  "user_text": "gasté 15 lucas en comida",
  "user_context": { "user_id": "test", "personality": null, "prefs": null, "active_budget": null, "goals_summary": [] },
  "tools": [...]
}
```

#### Paso 3.2: Conectar OrchestratorClient real
**Meta:** NestJS llama a FastAPI real

**Archivos a modificar:**
- `src/bot/clients/orchestrator.client.ts` (quitar mocks)

**Criterios de aceptación:**
- [ ] `/bot/test` usa IA real
- [ ] Manejo de errores HTTP
- [ ] Timeout funciona

---

### Sprint 4: Loop Completo en BotService

#### Paso 4.1: Implementar loop en BotService
**Meta:** Flujo completo Phase A → Tool → Phase B

**Archivos a modificar:**
- `src/bot/bot.service.ts`

**Criterios de aceptación:**
- [ ] Mensaje "gasté 15 lucas en comida" → transacción registrada → respuesta personalizada
- [ ] Mensaje "hola" → direct_reply
- [ ] Mensaje incompleto "gasté algo" → clarification

#### Paso 4.2: Eliminar código legacy
**Meta:** Limpiar IntentClassifierService, toUserMessage

**Archivos a eliminar:**
- `src/bot/intents/intent-classifier.service.ts`
- `src/bot/intents/intent.factory.ts`
- `src/bot/intents/intent.contracts.ts`
- `src/bot/intents/intent-handler.interface.ts`

**Archivos a modificar:**
- `src/bot/bot.module.ts` (quitar providers)
- `src/bot/bot.service.ts` (quitar toUserMessage, referencias a nlu)

---

### Sprint 5: Pruebas End-to-End

#### Paso 5.1: Probar con Telegram real
**Criterios de aceptación:**
- [ ] Mensaje desde Telegram → respuesta correcta
- [ ] Usuario no vinculado → link generado
- [ ] Slot-filling funciona (múltiples mensajes)

#### Paso 5.2: Probar edge cases
**Criterios de aceptación:**
- [ ] IA retorna JSON inválido → fallback funciona
- [ ] Timeout de IA → mensaje de error amigable
- [ ] Categoría inexistente → sugerencias

---

## 8. PRUEBAS Y CHECKLIST DE CALIDAD

### 8.1 Flujos de Postman a Probar

| # | Flujo | Request | Expected |
|---|-------|---------|----------|
| 1 | Usuario no vinculado | `POST /bot/test { channel: "telegram", externalId: "new123", text: "hola" }` | Reply contiene URL de vinculación |
| 2 | Saludo simple | `POST /bot/test { ..., text: "hola" }` | Reply es saludo personalizado |
| 3 | Registrar gasto completo | `POST /bot/test { ..., text: "gasté 15000 en comida" }` | Reply confirma registro |
| 4 | Registrar gasto sin monto | `POST /bot/test { ..., text: "gasté en comida" }` | Reply pregunta por monto |
| 5 | Consultar balance | `POST /bot/test { ..., text: "cuánto tengo" }` | Reply muestra balance |
| 6 | Consultar presupuesto | `POST /bot/test { ..., text: "cómo voy con mi presupuesto" }` | Reply muestra budget |
| 7 | Consultar metas | `POST /bot/test { ..., text: "cómo van mis metas" }` | Reply muestra goals |

### 8.2 Checklist de Logging

- [ ] Correlation ID en todos los logs del flujo
- [ ] Log de entrada: channel, externalId, text (truncado)
- [ ] Log de Phase A: request (sin tokens), response
- [ ] Log de tool execution: name, args (sanitizados), duration_ms
- [ ] Log de Phase B: request (sin tokens), response
- [ ] Log de errores: stack trace, context
- [ ] NO loguear: tokens, passwords, datos sensibles

### 8.3 Checklist de Performance

- [ ] `getMinimal()` < 200ms (con cache: < 5ms)
- [ ] Phase A < 5s
- [ ] Tool execution < 1s
- [ ] Phase B < 3s
- [ ] Total flujo < 10s
- [ ] No N+1 queries
- [ ] No full table scans

---

## 9. RIESGOS Y DECISIONES FUTURAS

### 9.1 Decisiones Pendientes V1

| Decisión | Opciones | Impacto |
|----------|----------|---------|
| Tabla `accounts` vs `payment_method` | (A) Crear accounts, (B) Eliminar ask_balance del V1 | Alto - afecta feature de balance |
| Cache distribuido | (A) In-memory Map, (B) Redis | Medio - escalabilidad |
| Rate limiting | (A) Por usuario, (B) Global | Medio - protección de IA |

### 9.2 Roadmap Post-V1

| Feature | Sprint estimado | Descripción |
|---------|-----------------|-------------|
| Contexto condicional | V1.1 | Cargar categorías solo para register_transaction |
| Multi-turn memory | V1.2 | Mantener últimos 3 mensajes en contexto |
| RAG básico | V2.0 | Búsqueda semántica para tips financieros |
| Proactive notifications | V2.0 | Alertas de presupuesto |
| OCR de comprobantes | V2.1 | Leer montos de fotos |
| Voice messages | V3.0 | Transcripción y respuesta por audio |

### 9.3 Riesgos Técnicos

| Riesgo | Mitigación |
|--------|------------|
| Latencia alta de IA | Timeout 30s + mensaje fallback + monitoring |
| Costos de API OpenAI | Usar GPT-4o-mini, cache de contexto, rate limit |
| IA genera tool_call inválido | Guardrails + validación estricta + fallback |
| Cache desincronizado | TTL corto (60s) + invalidación en write |

---

## RESUMEN EJECUTIVO

Esta guía define la implementación del **Hybrid Bot V1** de TallyFinance con los siguientes principios:

1. **Separación clara:** Backend ejecuta operaciones determinísticas en Supabase; IA decide y comunica.

2. **Flujo de dos fases:**
   - Phase A: IA analiza texto → retorna tool_call o clarification
   - Phase B: IA recibe resultado → genera mensaje personalizado

3. **5 tools funcionales:** register_transaction, ask_balance, ask_budget_status, ask_goal_status, greeting

4. **Contexto mínimo cacheado:** Solo datos esenciales para personalización (personality, prefs, budget, goals summary)

5. **Implementación incremental:** 5 sprints de pasos pequeños, cada uno testeable independientemente

6. **Endpoint de debug:** `/bot/test` para desarrollo sin canales reales

La ejecución debe ser secuencial respetando dependencias entre pasos. Cada paso tiene criterios de aceptación claros y tests de Postman asociados.
