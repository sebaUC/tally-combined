# RESUMEN COMPLETO DEL TRABAJO — TallyFinance Backend

**Fecha:** Diciembre 2024
**Proyecto:** Backend API para TallyFinance
**Stack:** NestJS + Supabase + TypeScript

---

## 1. VISIÓN GENERAL

TallyFinance es un asistente de finanzas personales que opera mediante canales de mensajería (Telegram y WhatsApp). El sistema implementa una arquitectura "Hybrid Bot" que combina:

1. **Orquestación con IA** (Phase A/B) para entender intenciones y generar respuestas naturales
2. **Tool Handlers** para ejecutar operaciones de negocio contra la base de datos
3. **Adaptadores de Canal** para normalizar mensajes de diferentes plataformas

---

## 2. SPRINTS COMPLETADOS

### Sprint 1: Limpieza Inicial y Servicios Base

**Archivos Creados:**
- `src/bot/services/user-context.service.ts` — Cache de contexto de usuario con TTL de 60 segundos
- `src/bot/services/orchestrator.client.ts` — Cliente para servicio de IA con modo stub
- `src/bot/services/guardrails.service.ts` — Validación y sanitización de argumentos de tools
- Endpoint `/bot/test` — Testing local sin webhooks

**Archivos Eliminados:**
- `src/bot/ai.client.ts` — Cliente HTTP legacy

**Correcciones:**
- `personality_snapshot` vs `user_persona` — Estandarizado
- Añadido timeouts a llamadas axios (30 segundos)
- Optimizado `getContext()` para no cargar todas las transacciones

---

### Sprint 2: Tool Registry

**Archivos Creados:**
- `src/bot/tools/tool-schemas.ts` — Esquemas JSON para herramientas de IA
- `src/bot/tools/tool-handler.interface.ts` — Interfaz para handlers
- `src/bot/tools/tool-registry.ts` — Registro central de handlers
- `src/bot/tools/handlers/register-transaction.tool-handler.ts`
- `src/bot/tools/handlers/ask-balance.tool-handler.ts`
- `src/bot/tools/handlers/ask-budget-status.tool-handler.ts`
- `src/bot/tools/handlers/ask-goal-status.tool-handler.ts`
- `src/bot/tools/handlers/greeting.tool-handler.ts`
- `src/bot/tools/handlers/unknown.tool-handler.ts`

**Archivos Eliminados:**
- `src/bot/intents/handlers/*.ts` — 6 handlers legacy
- `src/bot/intents/intent.factory.ts` — Factory de intents
- `src/bot/intents/intent-handler.interface.ts` — Interfaz legacy

---

### Sprint 3: Integración Hybrid Flow

**Archivos Creados:**
- `src/bot/services/orchestrator.contracts.ts` — Contratos TypeScript para Phase A/B

**Archivos Reescritos:**
- `src/bot/services/orchestrator.client.ts` — Implementación completa de `phaseA()` y `phaseB()`
- `src/bot/bot.service.ts` — Flujo híbrido completo

**Archivos Eliminados:**
- `src/bot/intents/intent-classifier.service.ts` — Clasificador NLU legacy
- `src/bot/intents/intent.contracts.ts` — Contratos legacy
- `src/bot/intents/` — Directorio completo eliminado

---

### Sprint 4: Logging y Métricas

**Cambios Implementados:**
- Correlation IDs en todos los logs (formato: `[abc12345]`)
- `ProcessingMetrics` interface con tiempos de cada fase
- Endpoint `/bot/test` ahora retorna métricas completas
- Modo verbose con contexto de usuario y debug info

**Estructura de Métricas:**
```typescript
interface ProcessingMetrics {
  correlationId: string;
  totalMs: number;
  contextMs: number;
  phaseAMs: number;
  toolMs: number;
  phaseBMs: number;
  phaseAResponse?: PhaseAResponse;
  toolName?: string;
  toolResult?: ActionResult;
}
```

---

### Sprint 5: Edge Cases y Testing

**Mejoras:**
- Fuzzy matching para categorías inexistentes en `register-transaction`
- Mensajes de error específicos por tipo de error (`LLM_TIMEOUT`, `INVALID_RESPONSE`, `LLM_ERROR`)
- Script de testing `scripts/test-bot.sh`

**Documentación:**
- `docs/CLEANUP_PLAN.md` — Plan de limpieza actualizado

---

### Sprint 6: ask_app_info y Patrones de Resiliencia

**Archivos Creados:**
- `src/bot/tools/handlers/ask-app-info.tool-handler.ts` — Handler con knowledge base completo (523 líneas)

**Características de ask_app_info:**
- Base de conocimiento estructurada sobre TallyFinance
- Detección de topics (capabilities, how_to, limitations, etc.)
- Easter eggs para respuestas especiales
- Fallback inteligente para conversación general
- No requiere contexto de usuario (requiresContext: false)

**Patrones de Resiliencia Implementados:**
- `RateLimiter` — 30 msgs/min por usuario en `bot.controller.ts`
- `CircuitBreaker` — Protección del servicio de IA en `orchestrator.client.ts`
- Modo stub mejorado con soporte completo para `ask_app_info`

---

## 3. ALINEACIÓN CON BASE DE DATOS

### Correcciones Realizadas (Post-Sprint 5)

#### 3.1 `register-transaction.tool-handler.ts`

| Antes | Después | Razón |
|-------|---------|-------|
| `date` | `posted_at` | Nombre de columna correcto en tabla `transactions` |
| `payment_method` (opcional) | `payment_method_id` (requerido) | Campo requerido en DB |
| No existía | `source: 'chat_intent'` | Indica origen de la transacción |
| No existía | `status: 'posted'` | Estado por defecto |

**Lógica añadida:** Si no se proporciona `payment_method_id`, se busca automáticamente el primer método de pago del usuario.

#### 3.2 `ask-goal-status.tool-handler.ts`

| Antes | Después | Razón |
|-------|---------|-------|
| `deadline` | `target_date` | Nombre de columna correcto en tabla `goals` |
| No existía | `status` | Campo útil para filtrar metas |

#### 3.3 `user-context.service.ts`

**Tabla `users`:**
| Antes | Después |
|-------|---------|
| `display_name` (no existe) | `full_name`, `nickname` |

**Tabla `user_prefs`:**
| Antes | Después |
|-------|---------|
| `currency` (no existe) | Eliminado |
| `timezone` (tabla incorrecta) | Movido a query de `users` |
| `language` (no existe) | Cambiado a `locale` de tabla `users` |

**Nueva estructura de `prefs`:**
```typescript
prefs: {
  timezone: string | null;        // de users.timezone
  locale: string | null;          // de users.locale
  notificationLevel: string | null; // de user_prefs.notification_level
  unifiedBalance: boolean | null;   // de user_prefs.unified_balance
}
```

---

## 4. ESTRUCTURA FINAL DEL MÓDULO BOT

```
src/bot/
├── actions/
│   └── action-result.ts           # Interfaz ActionResult
├── adapters/
│   ├── telegram.adapter.ts        # Adaptador Telegram
│   └── whatsapp.adapter.ts        # Adaptador WhatsApp
├── delegates/
│   └── bot-channel.service.ts     # Lógica de vinculación de canales
├── services/
│   ├── guardrails.service.ts      # Validación de argumentos
│   ├── orchestrator.client.ts     # Cliente de IA (Phase A/B)
│   ├── orchestrator.contracts.ts  # Contratos TypeScript
│   └── user-context.service.ts    # Cache de contexto de usuario
├── tools/
│   ├── handlers/
│   │   ├── ask-app-info.tool-handler.ts    # Información sobre la app (523 líneas)
│   │   ├── ask-balance.tool-handler.ts
│   │   ├── ask-budget-status.tool-handler.ts
│   │   ├── ask-goal-status.tool-handler.ts
│   │   ├── greeting.tool-handler.ts
│   │   ├── register-transaction.tool-handler.ts
│   │   └── unknown.tool-handler.ts
│   ├── index.ts
│   ├── tool-handler.interface.ts
│   ├── tool-registry.ts
│   └── tool-schemas.ts
├── bot.controller.ts              # Endpoints de webhook + test
├── bot.module.ts                  # Módulo NestJS
├── bot.service.ts                 # Servicio principal con flujo híbrido
└── contracts.ts                   # DomainMessage, Channel types
```

---

## 5. FLUJO HÍBRIDO (HYBRID FLOW)

```
Usuario envía mensaje
        │
        ▼
┌───────────────────┐
│   Adapter Layer   │  (Telegram/WhatsApp → DomainMessage)
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ BotChannelService │  (Verificar vinculación de canal)
└─────────┬─────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
 Vinculado   No vinculado → Generar link de vinculación
    │
    ▼
┌───────────────────┐
│ UserContextService│  (Cargar contexto del usuario - cache 60s)
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│    Phase A (IA)   │  (Decidir qué hacer)
└─────────┬─────────┘
          │
    ┌─────┼─────┬─────────────┐
    │     │     │             │
    ▼     ▼     ▼             ▼
 direct  clarif  tool_call   error
 _reply  ication     │
    │     │          ▼
    │     │   ┌──────────────┐
    │     │   │ GuardrailsSvc│  (Validar argumentos)
    │     │   └──────┬───────┘
    │     │          │
    │     │          ▼
    │     │   ┌──────────────┐
    │     │   │ ToolRegistry │  (Obtener handler)
    │     │   └──────┬───────┘
    │     │          │
    │     │          ▼
    │     │   ┌──────────────┐
    │     │   │ ToolHandler  │  (Ejecutar operación DB)
    │     │   └──────┬───────┘
    │     │          │
    │     │    ┌─────┴─────┐
    │     │    │           │
    │     │    ▼           ▼
    │     │ userMessage  data
    │     │    │           │
    │     │    │           ▼
    │     │    │    ┌──────────────┐
    │     │    │    │  Phase B (IA)│  (Generar respuesta)
    │     │    │    └──────┬───────┘
    │     │    │           │
    └─────┴────┴───────────┘
                   │
                   ▼
            Respuesta al usuario
```

---

## 6. TOOLS DISPONIBLES

| Tool Name | Descripción | Parámetros | Requiere Contexto |
|-----------|-------------|------------|-------------------|
| `register_transaction` | Registrar gasto/ingreso | `amount` (req), `category` (req), `date`, `description`, `payment_method_id` | Sí |
| `ask_balance` | Consultar saldos y gastos del mes | Ninguno | Sí |
| `ask_budget_status` | Estado del presupuesto | Ninguno | Sí |
| `ask_goal_status` | Progreso de metas | `goalId` (opcional) | Sí |
| `ask_app_info` | Información sobre TallyFinance | `userQuestion`, `suggestedTopic` | No |
| `greeting` | Responder saludos | Ninguno | No |
| `unknown` | Fallback para intenciones no reconocidas | Ninguno | No |

### 6.1 ask_app_info - Base de Conocimiento

El handler `ask_app_info` contiene una base de conocimiento completa sobre TallyFinance:

**Estructura del Knowledge Base:**
- **identity**: Nombre, tagline, versión, país, moneda
- **character**: Personalidad del bot (Tally/Gus), tono adaptativo
- **currentFeatures**: Funcionalidades actuales con ejemplos y tips
- **comingSoon**: Features próximos con ETAs estimados
- **limitations**: Limitaciones actuales y razones
- **channels**: Plataformas soportadas (Telegram, WhatsApp)
- **security**: Privacidad, encriptación, acceso bancario
- **gettingStarted**: Pasos para empezar
- **faq**: Preguntas frecuentes
- **financialKnowledge**: Tips y conceptos financieros
- **easterEggs**: Respuestas especiales para triggers específicos

**Funcionamiento:**
1. Phase A detecta pregunta sobre la app (ej: "¿qué puedes hacer?")
2. Envía pregunta original + topic sugerido al handler
3. Handler retorna knowledge base completo + instrucciones para IA
4. Phase B genera respuesta personalizada usando la información relevante

---

## 7. MODO STUB

Cuando `AI_SERVICE_URL` no está configurado, el `OrchestratorClient` opera en modo stub:

**Phase A (stubPhaseA):**
- Detecta patrones simples en el texto
- `hola/buenos/buenas/hey/hi` → direct_reply con saludo
- `gasté/compré/pagué` → tool_call `register_transaction` (extrae monto y categoría)
- `saldo/balance/cuánto tengo/dinero` → tool_call `ask_balance`
- `presupuesto/budget` → tool_call `ask_budget_status`
- `meta/goal/ahorro` → tool_call `ask_goal_status`
- Preguntas sobre la app (qué puedes hacer, cómo funciona, ayuda, etc.) → tool_call `ask_app_info`
- **Default/Fallback** → tool_call `ask_app_info` con topic `conversation`

**Topics detectados para ask_app_info:**
- `capabilities`: "qué puedes hacer", "funciones"
- `how_to`: "cómo registro", "cómo uso"
- `limitations`: "no puedes", "limitaciones"
- `channels`: "telegram", "whatsapp", "vincular"
- `getting_started`: "empezar", "comenzar"
- `about`: "qué es tally", "quién eres"
- `security`: "seguridad", "privacidad"
- `pricing`: "gratis", "precio"
- `conversation`: Fallback para conversación general

**Phase B (stubPhaseB):**
- Genera mensajes amigables basados en el resultado de la tool
- Para `ask_app_info`: Usa el knowledge base completo para generar respuestas contextuales

---

## 8. DECISIONES DE DISEÑO

### 8.1 `ask_balance` deshabilitado
- **Razón:** La tabla `accounts` no existe aún
- **Tabla actual:** `payment_method` (tarjetas de crédito/débito sin campo balance)
- **Mensaje:** "La consulta de saldos estará disponible muy pronto..."
- **Pendiente:** V1.1 crear tabla `accounts`

### 8.2 Cache en memoria para UserContext
- **TTL:** 60 segundos
- **Razón:** Evitar queries repetitivos durante conversación
- **Pendiente:** V1.2 migrar a Redis

### 8.3 Stub mode para desarrollo local
- **Razón:** Permitir testing sin servicio de IA
- **Comportamiento:** Pattern matching simple para simular respuestas

---

## 9. VARIABLES DE ENTORNO

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# IA Service (opcional - sin esto usa modo stub)
AI_SERVICE_URL=http://localhost:8000

# Telegram
TELEGRAM_BOT_TOKEN=123456:ABC...

# WhatsApp
WHATSAPP_TOKEN=EAAx...
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_GRAPH_API_BASE=https://graph.facebook.com
WHATSAPP_GRAPH_API_VERSION=v17.0

# Frontend
CORS_ORIGINS=http://localhost:3000,https://app.tallyfinance.com
LINK_ACCOUNT_URL=https://app.tallyfinance.com/link

# Flags
DISABLE_AI=0  # Poner 1 para modo mantenimiento
```

---

## 10. COMANDOS ÚTILES

```bash
# Build
npm run build

# Desarrollo
npm run start:dev

# Lint
npm run lint

# Tests
npm run test

# Test del bot (script)
./scripts/test-bot.sh
./scripts/test-bot.sh http://localhost:3000 mi-user-id
```

---

## 11. PATRONES DE RESILIENCIA IMPLEMENTADOS

### 11.1 Rate Limiting ✅ IMPLEMENTADO

**Ubicación:** `bot.controller.ts`

```typescript
RateLimiter(30, 60_000) // 30 mensajes por minuto por usuario
```

**Características:**
- Algoritmo: Sliding window
- Límite: 30 mensajes/minuto por usuario (identificado por externalId)
- Respuesta: HTTP 429 cuando se excede
- Limpieza automática: cada 5 minutos

### 11.2 Circuit Breaker ✅ IMPLEMENTADO

**Ubicación:** `orchestrator.client.ts`

```typescript
CircuitBreaker('ai-service', {
  failureThreshold: 5,      // 5 fallos → abrir circuito
  resetTimeoutMs: 30_000,   // 30 segundos en estado OPEN
  halfOpenMaxAttempts: 2    // 2 intentos exitosos para cerrar
})
```

**Estados:**
- `CLOSED`: Funcionamiento normal
- `OPEN`: Después de 5 fallos consecutivos, rechaza requests por 30s
- `HALF_OPEN`: Prueba con requests limitados para verificar recuperación

**Fallback:** Cuando el circuito está abierto, usa modo stub automáticamente.

### 11.3 Retry con Backoff Exponencial

**Ubicación:** `common/utils/resilience.ts`

```typescript
withRetry(fn, {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 2000
})
```

---

## 12. PRÓXIMOS PASOS (Post-V1)

| Feature | Sprint | Descripción |
|---------|--------|-------------|
| FastAPI `/orchestrate` real | V1.1 | Conectar a servicio de IA real |
| Tabla `accounts` | V1.1 | Habilitar feature de balance |
| Multi-turn memory | V1.2 | Mantener últimos 3 mensajes en contexto |
| Redis cache | V1.2 | Reemplazar Map in-memory |

---

## 13. TABLAS DE BASE DE DATOS UTILIZADAS

| Tabla | Uso en Bot |
|-------|------------|
| `users` | Perfil de usuario, timezone, locale |
| `user_prefs` | Preferencias (notification_level, unified_balance) |
| `personality_snapshot` | Personalidad del bot (tone, mood, intensity) |
| `channel_accounts` | Vinculación canal ↔ usuario |
| `channel_link_codes` | Códigos temporales para vincular canales |
| `categories` | Categorías de gastos del usuario |
| `transactions` | Transacciones registradas |
| `goals` | Metas de ahorro |
| `spending_expectations` | Presupuestos activos |
| `payment_method` | Métodos de pago (crédito/débito) |
| `user_emotional_log` | Registro de emociones detectadas (para análisis) |

---

**Documento generado:** Diciembre 2024
**Última actualización:** Enero 2025
**Versión:** Hybrid Bot V1.0.1 - Sprints 1-5 + ask_app_info + Patrones de Resiliencia

### Changelog V1.0.1:
- Añadido `ask_app_info` tool handler con knowledge base completo
- Añadido `unknown` tool handler como fallback
- Documentado Rate Limiting (ya implementado)
- Documentado Circuit Breaker (ya implementado)
- Documentado Retry con Backoff Exponencial
- Actualizado modo stub con todos los patterns
