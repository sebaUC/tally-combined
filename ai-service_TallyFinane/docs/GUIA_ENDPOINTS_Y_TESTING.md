# Guía de Endpoints y Testing - AI Service TallyFinance

**Versión:** 1.0.0
**Fecha:** 27 de Diciembre, 2024
**Idioma:** Español

---

## Tabla de Contenidos

1. [Resumen del Servicio](#1-resumen-del-servicio)
2. [Cómo Ejecutar el Servicio](#2-cómo-ejecutar-el-servicio)
3. [Endpoints Disponibles](#3-endpoints-disponibles)
4. [Flujo Completo del Sistema](#4-flujo-completo-del-sistema)
5. [Guía de Testing con Postman](#5-guía-de-testing-con-postman)
6. [Ejemplos de Requests y Responses](#6-ejemplos-de-requests-y-responses)
7. [Manejo de Errores](#7-manejo-de-errores)
8. [Referencia de Schemas](#8-referencia-de-schemas)

---

## 1. Resumen del Servicio

El **AI Service** es un microservicio FastAPI que proporciona inteligencia artificial para el chatbot financiero TallyFinance.

### Principio Central
> "Backend ejecuta, IA entiende/decide/comunica"

El servicio NO accede a la base de datos. Solo:
- **Entiende** lo que el usuario quiere (Phase A)
- **Decide** qué herramienta usar (Phase A)
- **Comunica** el resultado de forma personalizada (Phase B)

### Tecnologías
- **Framework:** FastAPI
- **LLM:** OpenAI GPT-4o-mini
- **Puerto por defecto:** 8000

---

## 2. Cómo Ejecutar el Servicio

### Paso a Paso Completo

```bash
# ============================================
# PASO 1: Ir al directorio del proyecto
# ============================================
cd /Users/sebaderpsch/ai-service_TallyFinane

# ============================================
# PASO 2: Activar el entorno virtual
# ============================================
source .venv/bin/activate
# Tu prompt debería cambiar a: (.venv) $

# ============================================
# PASO 3: Verificar que .env tiene la API key
# ============================================
cat .env
# Deberías ver algo como:
# OPENAI_API_KEY=sk-proj-xxxxxxxxx

# Si no existe o está vacío, créalo:
echo "OPENAI_API_KEY=tu-api-key-aqui" > .env

# ============================================
# PASO 4: Instalar dependencias (solo primera vez)
# ============================================
pip install -r requirements.txt

# ============================================
# PASO 5: Ejecutar el servicio
# ============================================
uvicorn app:app --reload --host 0.0.0.0 --port 8000

# Deberías ver:
# INFO:     Uvicorn running on http://0.0.0.0:8000
# INFO:     Application startup complete.

# ============================================
# PASO 6: Verificar que funciona (en otra terminal)
# ============================================
curl http://localhost:8000/health
# Respuesta: {"status":"healthy","model":"gpt-4o-mini","version":"1.0.0"}
```

### Comandos Rápidos (Resumen)

```bash
# Ejecutar en desarrollo (una sola línea)
cd /Users/sebaderpsch/ai-service_TallyFinane && source .venv/bin/activate && uvicorn app:app --reload --port 8000

# Ejecutar en producción
uvicorn app:app --host 0.0.0.0 --port 8000 --workers 4
```

### Detener el Servicio

```bash
# Presiona Ctrl+C en la terminal donde está corriendo
# O desde otra terminal:
pkill -f "uvicorn app:app"
```

### Variables de Entorno (.env)

| Variable | Requerida | Default | Descripción |
|----------|-----------|---------|-------------|
| `OPENAI_API_KEY` | ✅ Sí | - | Tu API key de OpenAI |
| `OPENAI_MODEL` | No | gpt-4o-mini | Modelo a usar |
| `OPENAI_TIMEOUT` | No | 25.0 | Timeout en segundos |
| `OPENAI_TEMPERATURE_PHASE_A` | No | 0.3 | Temperatura Phase A |
| `OPENAI_TEMPERATURE_PHASE_B` | No | 0.7 | Temperatura Phase B |

### Ejemplo de .env completo

```env
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-4o-mini
OPENAI_TIMEOUT=25.0
OPENAI_TEMPERATURE_PHASE_A=0.3
OPENAI_TEMPERATURE_PHASE_B=0.7
```

### Troubleshooting

| Problema | Solución |
|----------|----------|
| `ModuleNotFoundError` | Ejecuta `pip install -r requirements.txt` |
| `OPENAI_API_KEY not set` | Verifica que `.env` existe y tiene la key |
| `Port 8000 already in use` | Ejecuta `pkill -f uvicorn` o usa otro puerto: `--port 8001` |
| `Permission denied` | Verifica que estás en el entorno virtual: `source .venv/bin/activate` |

---

## 3. Endpoints Disponibles

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/` | Información básica del servicio |
| GET | `/health` | Health check con modelo y versión |
| POST | `/orchestrate` | Endpoint principal de orquestación IA |

### 3.1 GET /

**Descripción:** Retorna información básica del servicio.

**Response:**
```json
{
  "status": "ok",
  "service": "ai-service",
  "version": "1.0.0"
}
```

### 3.2 GET /health

**Descripción:** Health check para monitoreo y load balancers.

**Response:**
```json
{
  "status": "healthy",
  "model": "gpt-4o-mini",
  "version": "1.0.0"
}
```

### 3.3 POST /orchestrate

**Descripción:** Endpoint principal que maneja dos fases:

- **Phase A:** Analiza texto del usuario → Decide qué hacer
- **Phase B:** Genera mensaje personalizado → Respuesta final

---

## 4. Flujo Completo del Sistema

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FLUJO COMPLETO                                 │
└─────────────────────────────────────────────────────────────────────────┘

Usuario                 Telegram/WA           NestJS              AI-Service
   │                        │                    │                     │
   │ "gasté 15 lucas        │                    │                     │
   │  en comida"            │                    │                     │
   ├───────────────────────►│                    │                     │
   │                        │────webhook────────►│                     │
   │                        │                    │                     │
   │                        │                    │──── PHASE A ───────►│
   │                        │                    │  {                  │
   │                        │                    │   phase: "A",       │
   │                        │                    │   user_text: "...", │
   │                        │                    │   user_context,     │
   │                        │                    │   tools             │
   │                        │                    │  }                  │
   │                        │                    │                     │
   │                        │                    │◄─────────────────────│
   │                        │                    │  {                  │
   │                        │                    │   response_type:    │
   │                        │                    │     "tool_call",    │
   │                        │                    │   tool_call: {      │
   │                        │                    │     name: "register_│
   │                        │                    │       transaction", │
   │                        │                    │     args: {         │
   │                        │                    │       amount: 15000,│
   │                        │                    │       category:     │
   │                        │                    │         "comida"    │
   │                        │                    │     }               │
   │                        │                    │   }                 │
   │                        │                    │  }                  │
   │                        │                    │                     │
   │                        │                    │                     │
   │                        │                    │──── EJECUTA TOOL ──►│
   │                        │                    │    (Supabase)       │
   │                        │                    │    INSERT INTO      │
   │                        │                    │    transactions     │
   │                        │                    │◄─────────────────────│
   │                        │                    │                     │
   │                        │                    │──── PHASE B ───────►│
   │                        │                    │  {                  │
   │                        │                    │   phase: "B",       │
   │                        │                    │   tool_name: "...", │
   │                        │                    │   action_result,    │
   │                        │                    │   user_context      │
   │                        │                    │  }                  │
   │                        │                    │                     │
   │                        │                    │◄─────────────────────│
   │                        │                    │  {                  │
   │                        │                    │   final_message:    │
   │                        │                    │   "¡Listo! Registré │
   │                        │                    │    $15.000 en       │
   │                        │                    │    Comida 🎉"       │
   │                        │                    │  }                  │
   │                        │                    │                     │
   │                        │◄───────────────────│                     │
   │◄───────────────────────│                    │                     │
   │ "¡Listo! Registré      │                    │                     │
   │  $15.000 en Comida 🎉" │                    │                     │
   │                        │                    │                     │
```

### Casos Especiales

#### Caso: Clarificación (falta información)
```
Usuario: "gasté en algo"
         ↓
Phase A: { response_type: "clarification",
           clarification: "¿Cuál fue el monto y la categoría?" }
         ↓
NestJS: Retorna clarification directamente (NO llama Phase B)
         ↓
Usuario: "15 lucas en comida"
         ↓
Nuevo ciclo Phase A → Tool → Phase B
```

#### Caso: Saludo Simple
```
Usuario: "hola!"
         ↓
Phase A: { response_type: "tool_call",
           tool_call: { name: "greeting", args: {} } }
         ↓
NestJS: Ejecuta GreetingHandler (retorna ok: true)
         ↓
Phase B: { final_message: "¡Hola! ¿En qué puedo ayudarte hoy? 👋" }
```

---

## 5. Guía de Testing con Postman

### Configuración Inicial

1. **Crear nuevo Environment** llamado "TallyFinance AI Local"
2. **Agregar variable:**
   - `base_url` = `http://localhost:8000`

### Colección de Requests

#### 5.1 Health Check

```
GET {{base_url}}/health
```

**Expected Response (200):**
```json
{
  "status": "healthy",
  "model": "gpt-4o-mini",
  "version": "1.0.0"
}
```

---

#### 5.2 Phase A - Registrar Transacción

```
POST {{base_url}}/orchestrate
Content-Type: application/json
```

**Body:**
```json
{
  "phase": "A",
  "user_text": "gasté 25000 pesos en uber ayer",
  "user_context": {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
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
      "amount": 500000,
      "spent": 120000
    },
    "goals_summary": ["Viaje a Europa (45%)", "Fondo emergencia (80%)"]
  },
  "tools": [
    {
      "name": "register_transaction",
      "description": "Registra un gasto o ingreso del usuario",
      "parameters": {
        "type": "object",
        "properties": {
          "amount": {"type": "number", "description": "Monto en CLP"},
          "category": {"type": "string", "description": "Categoría del gasto"},
          "posted_at": {"type": "string", "description": "Fecha ISO-8601"},
          "payment_method": {"type": "string", "description": "Método de pago"},
          "description": {"type": "string", "description": "Descripción"}
        },
        "required": ["amount", "category"]
      }
    },
    {
      "name": "ask_balance",
      "description": "Consulta el saldo actual",
      "parameters": {"type": "object", "properties": {}, "required": []}
    },
    {
      "name": "greeting",
      "description": "Responde saludos",
      "parameters": {"type": "object", "properties": {}, "required": []}
    }
  ]
}
```

**Expected Response (200):**
```json
{
  "phase": "A",
  "response_type": "tool_call",
  "tool_call": {
    "name": "register_transaction",
    "args": {
      "amount": 25000,
      "category": "transporte",
      "posted_at": "2024-12-26",
      "description": "Gasto en uber"
    }
  },
  "clarification": null,
  "direct_reply": null
}
```

---

#### 5.3 Phase A - Saludo

```
POST {{base_url}}/orchestrate
Content-Type: application/json
```

**Body:**
```json
{
  "phase": "A",
  "user_text": "hola! buenos días",
  "user_context": {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "personality": {"tone": "friendly", "intensity": 0.7},
    "prefs": null,
    "active_budget": null,
    "goals_summary": []
  },
  "tools": [
    {
      "name": "greeting",
      "description": "Responde saludos simples",
      "parameters": {"type": "object", "properties": {}, "required": []}
    }
  ]
}
```

**Expected Response (200):**
```json
{
  "phase": "A",
  "response_type": "tool_call",
  "tool_call": {
    "name": "greeting",
    "args": {}
  },
  "clarification": null,
  "direct_reply": null
}
```

---

#### 5.4 Phase A - Clarificación (Falta Info)

```
POST {{base_url}}/orchestrate
Content-Type: application/json
```

**Body:**
```json
{
  "phase": "A",
  "user_text": "gasté en algo",
  "user_context": {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "personality": null,
    "prefs": null,
    "active_budget": null,
    "goals_summary": []
  },
  "tools": [
    {
      "name": "register_transaction",
      "description": "Registra gasto",
      "parameters": {
        "type": "object",
        "properties": {
          "amount": {"type": "number", "description": "Monto"},
          "category": {"type": "string", "description": "Categoría"}
        },
        "required": ["amount", "category"]
      }
    }
  ]
}
```

**Expected Response (200):**
```json
{
  "phase": "A",
  "response_type": "clarification",
  "tool_call": null,
  "clarification": "¿Cuál fue el monto y la categoría del gasto?",
  "direct_reply": null
}
```

---

#### 5.5 Phase B - Generar Mensaje (Éxito)

```
POST {{base_url}}/orchestrate
Content-Type: application/json
```

**Body:**
```json
{
  "phase": "B",
  "tool_name": "register_transaction",
  "action_result": {
    "ok": true,
    "action": "register_transaction",
    "data": {
      "amount": 25000,
      "category": "Transporte",
      "posted_at": "2024-12-26",
      "transaction_id": "tx-12345"
    }
  },
  "user_context": {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "personality": {
      "tone": "motivational",
      "intensity": 0.8,
      "mood": "proud"
    },
    "prefs": null,
    "active_budget": {
      "period": "monthly",
      "amount": 500000,
      "spent": 145000
    },
    "goals_summary": ["Viaje a Europa (45%)", "Fondo emergencia (80%)"]
  }
}
```

**Expected Response (200):**
```json
{
  "phase": "B",
  "final_message": "¡Excelente! Has registrado $25.000 en Transporte. Cada peso que controlas te acerca más a tu viaje a Europa. ¡Sigue así, campeón! 💪✈️"
}
```

---

#### 5.6 Phase B - Tono Serio (Sin Emojis)

```
POST {{base_url}}/orchestrate
Content-Type: application/json
```

**Body:**
```json
{
  "phase": "B",
  "tool_name": "register_transaction",
  "action_result": {
    "ok": true,
    "action": "register_transaction",
    "data": {
      "amount": 150000,
      "category": "Arriendo",
      "posted_at": "2024-12-27"
    }
  },
  "user_context": {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "personality": {
      "tone": "serious",
      "intensity": 0.3
    },
    "prefs": null,
    "active_budget": null,
    "goals_summary": []
  }
}
```

**Expected Response (200):**
```json
{
  "phase": "B",
  "final_message": "Transacción registrada: $150.000 en categoría Arriendo. Si necesitas gestionar más operaciones, estoy disponible."
}
```

---

#### 5.7 Phase B - Consulta de Presupuesto

```
POST {{base_url}}/orchestrate
Content-Type: application/json
```

**Body:**
```json
{
  "phase": "B",
  "tool_name": "ask_budget_status",
  "action_result": {
    "ok": true,
    "action": "ask_budget_status",
    "data": {
      "period": "monthly",
      "amount": 500000,
      "spent": 480000,
      "remaining": 20000,
      "percentage_used": 96
    }
  },
  "user_context": {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "personality": {
      "tone": "friendly",
      "intensity": 0.6,
      "mood": "disappointed"
    },
    "prefs": null,
    "active_budget": {
      "period": "monthly",
      "amount": 500000,
      "spent": 480000
    },
    "goals_summary": []
  }
}
```

**Expected Response (200):**
```json
{
  "phase": "B",
  "final_message": "Entiendo que puede ser frustrante, pero lo importante es que estás pendiente de tus finanzas. De tu presupuesto mensual de $500.000, has usado $480.000, quedándote $20.000. ¡Ánimo, el próximo mes será mejor! 💪"
}
```

---

#### 5.8 Phase B - ask_app_info (Pregunta sobre la App)

```
POST {{base_url}}/orchestrate
Content-Type: application/json
```

**Body:**
```json
{
  "phase": "B",
  "tool_name": "ask_app_info",
  "action_result": {
    "ok": true,
    "action": "ask_app_info",
    "data": {
      "userQuestion": "qué puedes hacer?",
      "appKnowledge": {
        "currentFeatures": [
          "Registrar gastos e ingresos por chat",
          "Consultar saldo",
          "Ver estado del presupuesto",
          "Revisar progreso de metas"
        ],
        "comingSoon": [
          "OCR de comprobantes",
          "Notificaciones proactivas"
        ]
      },
      "aiInstruction": "Lista las funciones actuales y menciona algo que viene pronto"
    }
  },
  "user_context": {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "personality": {
      "tone": "friendly",
      "intensity": 0.7,
      "mood": "normal"
    },
    "prefs": null,
    "active_budget": null,
    "goals_summary": []
  }
}
```

**Expected Response (200):**
```json
{
  "phase": "B",
  "final_message": "¡Hola! Puedo ayudarte a registrar gastos e ingresos, consultar tu saldo, ver cómo va tu presupuesto y revisar el progreso de tus metas de ahorro. Pronto también podré leer tus comprobantes con solo una foto 📸"
}
```

---

## 6. Ejemplos de Requests y Responses

### Tabla de Ejemplos Phase A

| Input Usuario | response_type | Resultado |
|---------------|---------------|-----------|
| "gasté 15 lucas en comida" | tool_call | register_transaction(amount=15000, category="comida") |
| "cuánto tengo?" | tool_call | ask_balance() |
| "cómo voy con mi presupuesto?" | tool_call | ask_budget_status() |
| "cómo van mis metas?" | tool_call | ask_goal_status() |
| "hola!" | tool_call | greeting() |
| "qué puedes hacer?" | tool_call | ask_app_info(userQuestion="qué puedes hacer?", suggestedTopic="capabilities") |
| "cómo registro un gasto?" | tool_call | ask_app_info(userQuestion="cómo registro un gasto?", suggestedTopic="how_to") |
| "es seguro usar la app?" | tool_call | ask_app_info(userQuestion="es seguro usar la app?", suggestedTopic="security") |
| "gasté en algo" | clarification | "¿Cuál fue el monto y la categoría?" |
| "asdfghjk" | clarification | "No entendí tu mensaje. ¿Puedes dar más detalles?" |

### Tabla de Ejemplos Phase B por Personalidad

| Tone | Mood | Ejemplo de Respuesta |
|------|------|----------------------|
| friendly | normal | "¡Listo! Registré $15.000 en Comida. 😊" |
| friendly | proud | "¡Excelente trabajo! $15.000 en Comida registrados. ¡Sigue así! 🎉" |
| friendly | disappointed | "Entiendo, $15.000 en Comida registrados. ¡Ánimo, mañana será mejor! 💪" |
| serious | normal | "Transacción registrada: $15.000 en Comida." |
| motivational | happy | "¡Genial! $15.000 en Comida. ¡Cada registro te acerca a tus metas! 🚀" |
| strict | normal | "$15.000 en Comida. Revisa tu presupuesto regularmente." |

---

## 7. Manejo de Errores

### Códigos de Error

| Código | HTTP | Cuándo Ocurre |
|--------|------|---------------|
| `INVALID_PHASE` | 400 | phase no es "A" ni "B" |
| `MISSING_USER_TEXT` | 400 | Phase A sin user_text |
| `MISSING_ACTION_RESULT` | 400 | Phase B sin action_result |
| `LLM_ERROR` | 500 | Error en llamada a OpenAI |
| `LLM_TIMEOUT` | 503 | Timeout de OpenAI (>25s) |

### Ejemplo de Error Response

```json
{
  "detail": {
    "detail": "Phase A requires user_text",
    "code": "MISSING_USER_TEXT"
  }
}
```

### Test de Error - Phase Inválida

```
POST {{base_url}}/orchestrate
Content-Type: application/json

{
  "phase": "C",
  "user_text": "test"
}
```

**Response (422):**
```json
{
  "detail": [
    {
      "type": "literal_error",
      "loc": ["body", "...", "phase"],
      "msg": "Input should be 'A'",
      "input": "C"
    }
  ]
}
```

---

## 8. Referencia de Schemas

### MinimalUserContext

```json
{
  "user_id": "string (UUID)",
  "personality": {
    "tone": "neutral|friendly|serious|motivational|strict",
    "intensity": 0.0-1.0,
    "mood": "normal|happy|disappointed|tired|hopeful|frustrated|proud"
  },
  "prefs": {
    "notification_level": "none|light|medium|intense",
    "unified_balance": true|false
  },
  "active_budget": {
    "period": "daily|weekly|monthly",
    "amount": 500000,
    "spent": 120000
  },
  "goals_summary": ["Viaje a Europa (45%)", "Fondo emergencia (80%)"]
}
```

### ActionResult

```json
{
  "ok": true|false,
  "action": "register_transaction|ask_balance|ask_budget_status|ask_goal_status|greeting|ask_app_info",
  "data": { ... },
  "userMessage": "string (solo para slot-filling)",
  "errorCode": "string (solo si ok=false)"
}
```

### ActionResult para ask_app_info

```json
{
  "ok": true,
  "action": "ask_app_info",
  "data": {
    "userQuestion": "string - pregunta original del usuario",
    "appKnowledge": {
      "currentFeatures": ["..."],
      "comingSoon": ["..."],
      "limitations": ["..."],
      "security": { ... },
      "channels": ["telegram", "whatsapp"],
      "pricing": { ... }
    },
    "aiInstruction": "string - instrucción adicional para el AI"
  }
}
```

### ToolSchema

```json
{
  "name": "string",
  "description": "string",
  "parameters": {
    "type": "object",
    "properties": {
      "field_name": {
        "type": "string|number|boolean",
        "description": "string"
      }
    },
    "required": ["field1", "field2"]
  }
}
```

---

## Checklist de Testing

- [ ] GET /health retorna 200
- [ ] GET / retorna 200
- [ ] Phase A con saludo → tool_call greeting
- [ ] Phase A con gasto completo → tool_call register_transaction con args
- [ ] Phase A con info faltante → clarification
- [ ] Phase A con pregunta sobre la app → tool_call ask_app_info con userQuestion
- [ ] Phase B con éxito → final_message personalizado
- [ ] Phase B con tone "serious" → sin emojis
- [ ] Phase B con mood "proud" → celebratorio
- [ ] Phase B con mood "disappointed" → empático
- [ ] Phase B ask_app_info → respuesta informativa sobre la app
- [ ] Error con phase inválida → 422

---

## Importar Colección a Postman

1. Crear nueva colección "TallyFinance AI Service"
2. Agregar los 8 requests de la sección 5
3. Configurar environment con `base_url`
4. Ejecutar en orden para verificar funcionamiento

---

**¿Preguntas?** Revisa el archivo `CLAUDE.md` para más detalles de integración.
