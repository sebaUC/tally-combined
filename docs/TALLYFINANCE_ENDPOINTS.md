# TallyFinance — Complete Endpoint & Testing Reference

**Version:** 2.0
**Last Updated:** January 2026

---

## Table of Contents

1. [Endpoint Summary](#1-endpoint-summary)
2. [Authentication Endpoints (Backend)](#2-authentication-endpoints)
3. [Bot Endpoints (Backend)](#3-bot-endpoints)
4. [User Endpoints (Backend)](#4-user-endpoints)
5. [Channel Linking Endpoints (Backend)](#5-channel-linking-endpoints)
6. [AI Service Endpoints](#6-ai-service-endpoints)
7. [Schema Reference](#7-schema-reference)
8. [Testing Guide](#8-testing-guide)
9. [Complete Flows](#9-complete-flows)
10. [Postman Setup](#10-postman-setup)

---

## 1. Endpoint Summary

### Backend (NestJS — Port 3000)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/auth/signup` | No | Register new user |
| `POST` | `/auth/signin` | No | Login |
| `POST` | `/auth/provider` | No | Start OAuth flow |
| `GET` | `/auth/callback` | No | OAuth callback |
| `POST` | `/auth/refresh` | Cookie | Refresh token |
| `POST` | `/auth/logout` | No | Logout |
| `GET` | `/auth/me` | Yes | Get current profile |
| `GET` | `/auth/link-status` | Yes | Channel linking status |
| `POST` | `/auth/create-link-token` | Yes | Create channel link code |
| `POST` | `/auth/link-channel` | Yes | Link a channel |
| `POST` | `/auth/onboarding` | Yes | Complete onboarding |
| `POST` | `/telegram/webhook` | No* | Telegram webhook |
| `POST` | `/whatsapp/webhook` | No* | WhatsApp webhook |
| `POST` | `/bot/test` | No | Bot testing endpoint |
| `GET` | `/api/users/me` | Yes | User profile |
| `GET` | `/api/users/context` | Yes | User context (for debugging) |
| `GET` | `/connect/:code` | No | Channel linking redirect |
| `GET` | `/connect/:code/api` | No | Channel linking AJAX |

*Verified by platform (Telegram/Meta)

### AI Service (FastAPI — Port 8000)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/` | Service info |
| `GET` | `/health` | Health check |
| `POST` | `/orchestrate` | Two-phase AI orchestration |

---

## 2. Authentication Endpoints

### 2.1 POST /auth/signup

Register a new user.

**Request:**
```json
{
  "email": "usuario@ejemplo.com",
  "password": "miPassword123",
  "fullName": "Juan Perez"
}
```

**Response (201):**
```json
{
  "message": "Signup successful",
  "user": {
    "id": "uuid-del-usuario",
    "email": "usuario@ejemplo.com",
    "created_at": "2024-12-27T10:00:00Z"
  },
  "session": {
    "accessToken": "eyJ...",
    "refreshToken": "abc123...",
    "expiresAt": 1703674800,
    "expiresIn": 3600,
    "tokenType": "bearer"
  }
}
```

### 2.2 POST /auth/signin

Login with email and password.

**Request:**
```json
{
  "email": "usuario@ejemplo.com",
  "password": "miPassword123"
}
```

**Response (200):**
```json
{
  "message": "Login successful",
  "session": {
    "accessToken": "eyJ...",
    "refreshToken": "abc123...",
    "expiresAt": 1703674800,
    "expiresIn": 3600,
    "tokenType": "bearer"
  },
  "user": {
    "id": "uuid-del-usuario",
    "email": "usuario@ejemplo.com",
    "profile": {
      "full_name": "Juan Perez",
      "nickname": null,
      "timezone": "America/Santiago",
      "locale": "es-CL",
      "onboarding_completed": false
    }
  }
}
```

### 2.3 POST /auth/provider

Start an OAuth flow (Google, GitHub, etc.).

**Request:**
```json
{
  "provider": "google",
  "redirectTo": "http://localhost:3000/auth/callback"
}
```

**Response (200):**
```json
{
  "url": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

Open the returned URL in a browser to complete OAuth.

### 2.4 GET /auth/callback

OAuth callback — called automatically by the frontend after OAuth. Receives `access_token` and `refresh_token` as query params.

### 2.5 POST /auth/refresh

Refresh access token using cookie.

**Headers:** `Cookie: refresh_token={{refresh_token}}`

**Response (200):**
```json
{
  "message": "Session refreshed",
  "session": {
    "accessToken": "eyJ...(new)...",
    "refreshToken": "abc123...",
    "expiresAt": 1703678400,
    "expiresIn": 3600,
    "tokenType": "bearer"
  }
}
```

### 2.6 POST /auth/logout

**Response (200):**
```json
{
  "message": "Logged out"
}
```

### 2.7 GET /auth/me

Get current authenticated user profile.

**Headers:** `Authorization: Bearer {{access_token}}`

**Response (200):**
```json
{
  "id": "uuid-del-usuario",
  "email": "usuario@ejemplo.com",
  "profile": {
    "full_name": "Juan Perez",
    "nickname": "Juanito",
    "timezone": "America/Santiago",
    "locale": "es-CL",
    "onboarding_completed": true,
    "package": "basic"
  }
}
```

### 2.8 POST /auth/onboarding

Complete user onboarding with preferences, payment methods, categories, goals, and budget.

**Headers:** `Authorization: Bearer {{access_token}}`

**Request:**
```json
{
  "nickname": "Juanito",
  "timezone": "America/Santiago",
  "locale": "es-CL",
  "package": "basic",
  "botPersonality": {
    "tone": "friendly",
    "intensity": 3
  },
  "preferences": {
    "notificationLevel": "medium",
    "unifiedBalance": true
  },
  "paymentMethods": [
    {
      "name": "Tarjeta Principal",
      "paymentType": "debito",
      "institution": "Banco Estado",
      "numberMasked": "****1234",
      "currency": "CLP"
    }
  ],
  "categories": [
    { "name": "Comida" },
    { "name": "Transporte" },
    { "name": "Entretenimiento" },
    { "name": "Salud" }
  ],
  "goals": [
    {
      "name": "Vacaciones",
      "targetAmount": 500000,
      "targetDate": "2025-06-01"
    }
  ],
  "spendingExpectation": {
    "period": "monthly",
    "amount": 800000
  }
}
```

**Response (200):**
```json
{
  "success": true
}
```

---

## 3. Bot Endpoints

### 3.1 POST /telegram/webhook

Receives Telegram Bot API updates. Verified by Telegram, no auth required.

**Request (Telegram format):**
```json
{
  "update_id": 123456789,
  "message": {
    "message_id": 100,
    "from": {
      "id": 123456789,
      "is_bot": false,
      "first_name": "Juan",
      "username": "juanperez"
    },
    "chat": {
      "id": 123456789,
      "first_name": "Juan",
      "type": "private"
    },
    "date": 1703673600,
    "text": "gaste 15 lucas en comida"
  }
}
```

**Response:** `200 OK`

### 3.2 POST /whatsapp/webhook

Receives WhatsApp Cloud API updates. Verified by Meta, no auth required.

**Request (WhatsApp format):**
```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "123456789",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "56912345678",
              "phone_number_id": "123456789"
            },
            "contacts": [
              {
                "profile": { "name": "Juan Perez" },
                "wa_id": "56912345678"
              }
            ],
            "messages": [
              {
                "from": "56912345678",
                "id": "wamid.xxx",
                "timestamp": "1703673600",
                "text": { "body": "hola" },
                "type": "text"
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

**Response:** `200 EVENT_RECEIVED`

### 3.3 POST /bot/test

Debug endpoint — test the bot without Telegram/WhatsApp. No auth required.

**Request (basic):**
```json
{
  "message": "gaste 15 lucas en comida",
  "userId": "uuid-del-usuario"
}
```

**Request (with options):**
```json
{
  "message": "gaste 15 lucas en comida",
  "userId": "uuid-del-usuario",
  "channel": "test",
  "verbose": true
}
```

**Response (normal mode):**
```json
{
  "ok": true,
  "reply": "Listo! Registre $15.000 en comida.",
  "metrics": {
    "correlationId": "abc12345",
    "totalMs": 250,
    "contextMs": 45,
    "phaseAMs": 120,
    "toolMs": 60,
    "phaseBMs": 25
  }
}
```

**Response (verbose mode):**
```json
{
  "ok": true,
  "reply": "Listo! Registre $15.000 en comida.",
  "metrics": { "correlationId": "abc12345", "totalMs": 250, "..." : "..." },
  "debug": {
    "phaseA": {
      "phase": "A",
      "response_type": "tool_call",
      "tool_call": {
        "name": "register_transaction",
        "args": { "amount": 15000, "category": "comida" }
      }
    },
    "toolName": "register_transaction",
    "toolResult": {
      "ok": true,
      "action": "register_transaction",
      "data": {
        "transaction_id": 123,
        "amount": 15000,
        "category": "Comida",
        "posted_at": "2024-12-27T10:00:00Z"
      }
    },
    "input": {
      "channel": "test",
      "externalId": "test-uuid",
      "text": "gaste 15 lucas en comida"
    }
  },
  "context": {
    "userId": "uuid-del-usuario",
    "displayName": "Juanito",
    "personality": { "tone": "friendly", "intensity": 3, "mood": "normal" },
    "prefs": { "timezone": "America/Santiago", "locale": "es-CL", "notificationLevel": "medium", "unifiedBalance": true },
    "activeBudget": { "period": "monthly", "amount": 800000 },
    "goalsCount": 1
  }
}
```

---

## 4. User Endpoints

### 4.1 GET /api/users/me

**Headers:** `Authorization: Bearer {{access_token}}`

**Response (200):**
```json
{
  "id": "uuid-del-usuario",
  "email": "usuario@ejemplo.com",
  "full_name": "Juan Perez",
  "nickname": "Juanito",
  "timezone": "America/Santiago",
  "locale": "es-CL",
  "package": "basic",
  "onboarding_completed": true
}
```

### 4.2 GET /api/users/context

Returns the MinimalUserContext used by the bot. Useful for debugging.

**Headers:** `Authorization: Bearer {{access_token}}`

**Response (200):**
```json
{
  "userId": "uuid-del-usuario",
  "displayName": "Juanito",
  "personality": { "tone": "friendly", "intensity": 3, "mood": "normal" },
  "prefs": { "timezone": "America/Santiago", "locale": "es-CL", "notificationLevel": "medium", "unifiedBalance": true },
  "activeBudget": { "period": "monthly", "amount": 800000 },
  "goalsCount": 1
}
```

---

## 5. Channel Linking Endpoints

### 5.1 GET /auth/link-status

**Headers:** `Authorization: Bearer {{access_token}}`

**Response (200):**
```json
{
  "telegram": {
    "linked": true,
    "username": "@juanperez",
    "linkedAt": "2024-12-20T15:30:00Z"
  },
  "whatsapp": {
    "linked": false
  }
}
```

### 5.2 POST /auth/create-link-token

**Headers:** `Authorization: Bearer {{access_token}}`

**Request:**
```json
{
  "channel": "telegram"
}
```

**Response (200):**
```json
{
  "code": "ABC123",
  "token": "eyJ...",
  "expiresAt": 1703675400,
  "linkUrl": "https://t.me/TallyFinanceBot?start=ABC123"
}
```

### 5.3 POST /auth/link-channel

**Headers:** `Authorization: Bearer {{access_token}}`

**Request (with code):**
```json
{
  "linkCode": "ABC123"
}
```

**Request (with token):**
```json
{
  "linkToken": "eyJ..."
}
```

**Response (200):**
```json
{
  "message": "Channel linked",
  "channelAccount": {
    "id": "uuid",
    "channel": "telegram",
    "external_user_id": "123456789",
    "username": "@juanperez"
  }
}
```

### 5.4 GET /connect/:code

Main channel linking endpoint. Checks auth state and either auto-links or redirects to login.

### 5.5 GET /connect/:code/api

AJAX version of the linking endpoint for frontend use.

---

## 6. AI Service Endpoints

### 6.1 GET /

**Response (200):**
```json
{
  "status": "ok",
  "service": "ai-service",
  "version": "1.0.0"
}
```

### 6.2 GET /health

**Response (200):**
```json
{
  "status": "healthy",
  "model": "gpt-4o-mini",
  "version": "1.0.0"
}
```

### 6.3 POST /orchestrate — Phase A (Intent Analysis)

**Request:**
```json
{
  "phase": "A",
  "user_text": "gaste 25000 pesos en uber ayer",
  "user_context": {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "personality": { "tone": "friendly", "intensity": 0.7, "mood": "normal" },
    "prefs": { "notification_level": "medium", "unified_balance": true },
    "active_budget": { "period": "monthly", "amount": 500000, "spent": 120000 },
    "goals_summary": ["Viaje a Europa (45%)", "Fondo emergencia (80%)"]
  },
  "tools": [
    {
      "name": "register_transaction",
      "description": "Registra un gasto o ingreso del usuario",
      "parameters": {
        "type": "object",
        "properties": {
          "amount": { "type": "number", "description": "Monto en CLP" },
          "category": { "type": "string", "description": "Categoria del gasto" },
          "posted_at": { "type": "string", "description": "Fecha ISO-8601" },
          "payment_method": { "type": "string", "description": "Metodo de pago" },
          "description": { "type": "string", "description": "Descripcion" }
        },
        "required": ["amount", "category"]
      }
    },
    {
      "name": "ask_balance",
      "description": "Consulta el saldo actual",
      "parameters": { "type": "object", "properties": {}, "required": [] }
    },
    {
      "name": "ask_budget_status",
      "description": "Consulta el estado del presupuesto",
      "parameters": { "type": "object", "properties": {}, "required": [] }
    },
    {
      "name": "ask_goal_status",
      "description": "Consulta el progreso de metas",
      "parameters": { "type": "object", "properties": {}, "required": [] }
    },
    {
      "name": "ask_app_info",
      "description": "Responde preguntas sobre la app",
      "parameters": {
        "type": "object",
        "properties": {
          "userQuestion": { "type": "string", "description": "Pregunta del usuario" },
          "suggestedTopic": { "type": "string", "description": "Tema sugerido" }
        },
        "required": ["userQuestion"]
      }
    },
    {
      "name": "greeting",
      "description": "Responde saludos",
      "parameters": { "type": "object", "properties": {}, "required": [] }
    }
  ]
}
```

**Response — tool_call:**
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

**Response — clarification:**
```json
{
  "phase": "A",
  "response_type": "clarification",
  "tool_call": null,
  "clarification": "Cual fue el monto y la categoria del gasto?",
  "direct_reply": null
}
```

**Response — direct_reply:**
```json
{
  "phase": "A",
  "response_type": "direct_reply",
  "tool_call": null,
  "clarification": null,
  "direct_reply": "Hola! En que te puedo ayudar hoy?"
}
```

### 6.4 POST /orchestrate — Phase B (Response Generation)

**Request:**
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
    "personality": { "tone": "motivational", "intensity": 0.8, "mood": "proud" },
    "prefs": null,
    "active_budget": { "period": "monthly", "amount": 500000, "spent": 145000 },
    "goals_summary": ["Viaje a Europa (45%)", "Fondo emergencia (80%)"]
  }
}
```

**Response:**
```json
{
  "phase": "B",
  "final_message": "Excelente! Has registrado $25.000 en Transporte. Cada peso que controlas te acerca mas a tu viaje a Europa. Sigue asi!"
}
```

### 6.5 POST /orchestrate — Phase B with ask_app_info

**Request:**
```json
{
  "phase": "B",
  "tool_name": "ask_app_info",
  "action_result": {
    "ok": true,
    "action": "ask_app_info",
    "data": {
      "userQuestion": "que puedes hacer?",
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
    "personality": { "tone": "friendly", "intensity": 0.7, "mood": "normal" },
    "prefs": null,
    "active_budget": null,
    "goals_summary": []
  }
}
```

**Response:**
```json
{
  "phase": "B",
  "final_message": "Puedo ayudarte a registrar gastos e ingresos, consultar tu saldo, ver como va tu presupuesto y revisar el progreso de tus metas de ahorro. Pronto tambien podre leer tus comprobantes con solo una foto."
}
```

### 6.6 Error Responses

| Code | HTTP | When |
|------|------|------|
| `INVALID_PHASE` | 400 | Phase not "A" or "B" |
| `MISSING_USER_TEXT` | 400 | Phase A without user_text |
| `MISSING_ACTION_RESULT` | 400 | Phase B without action_result |
| `LLM_ERROR` | 500 | OpenAI API error |
| `LLM_TIMEOUT` | 503 | OpenAI timeout (>25s) |

**Error response format:**
```json
{
  "detail": {
    "detail": "Phase A requires user_text",
    "code": "MISSING_USER_TEXT"
  }
}
```

---

## 7. Schema Reference

### MinimalUserContext

```json
{
  "user_id": "string (UUID)",
  "personality": {
    "tone": "neutral | friendly | serious | motivational | strict",
    "intensity": "0.0 - 1.0",
    "mood": "normal | happy | disappointed | tired | hopeful | frustrated | proud"
  },
  "prefs": {
    "notification_level": "none | light | medium | intense",
    "unified_balance": "boolean"
  },
  "active_budget": {
    "period": "daily | weekly | monthly",
    "amount": "number",
    "spent": "number (optional)"
  },
  "goals_summary": ["string[]"]
}
```

### ActionResult

```json
{
  "ok": "boolean",
  "action": "register_transaction | ask_balance | ask_budget_status | ask_goal_status | greeting | ask_app_info | unknown",
  "data": "object (optional)",
  "userMessage": "string (optional — skip Phase B, return directly)",
  "errorCode": "string (optional — only if ok=false)"
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
      "field_name": { "type": "string | number | boolean", "description": "string" }
    },
    "required": ["field1"]
  }
}
```

---

## 8. Testing Guide

### 8.1 Phase A — Expected Mappings

| User Input | response_type | Tool / Result |
|------------|---------------|---------------|
| "gaste 15 lucas en comida" | tool_call | `register_transaction(amount=15000, category="comida")` |
| "cuanto tengo?" | tool_call | `ask_balance()` |
| "como voy con mi presupuesto?" | tool_call | `ask_budget_status()` |
| "como van mis metas?" | tool_call | `ask_goal_status()` |
| "hola!" | tool_call | `greeting()` |
| "que puedes hacer?" | tool_call | `ask_app_info(userQuestion="que puedes hacer?")` |
| "como registro un gasto?" | tool_call | `ask_app_info(userQuestion="...", suggestedTopic="how_to")` |
| "es seguro usar la app?" | tool_call | `ask_app_info(userQuestion="...", suggestedTopic="security")` |
| "gaste en algo" | clarification | "Cual fue el monto y la categoria?" |

### 8.2 Phase B — Personality Variations

| Tone | Mood | Example Response |
|------|------|-----------------|
| friendly | normal | "Listo! Registre $15.000 en Comida." |
| friendly | proud | "Excelente trabajo! $15.000 en Comida registrados. Sigue asi!" |
| friendly | disappointed | "Entiendo, $15.000 en Comida registrados. Animo, manana sera mejor!" |
| serious | normal | "Transaccion registrada: $15.000 en Comida." |
| motivational | happy | "Genial! $15.000 en Comida. Cada registro te acerca a tus metas!" |
| strict | normal | "$15.000 en Comida. Revisa tu presupuesto regularmente." |

### 8.3 Bot Test Cases (/bot/test)

**Greeting:**
```json
{ "message": "hola", "userId": "{{test_user_id}}" }
```

**Full transaction:**
```json
{ "message": "gaste 15 lucas en comida", "userId": "{{test_user_id}}" }
```

**Missing amount:**
```json
{ "message": "gaste en transporte", "userId": "{{test_user_id}}" }
```

**Missing category:**
```json
{ "message": "gaste 5000", "userId": "{{test_user_id}}" }
```

**Budget check:**
```json
{ "message": "como voy con mi presupuesto", "userId": "{{test_user_id}}" }
```

**Goals check:**
```json
{ "message": "como van mis metas", "userId": "{{test_user_id}}" }
```

**Unknown message:**
```json
{ "message": "asdfghjkl", "userId": "{{test_user_id}}" }
```

**Verbose mode:**
```json
{ "message": "gaste 20 lucas en uber", "userId": "{{test_user_id}}", "verbose": true }
```

### 8.4 Testing Checklist

**AI Service:**
- [ ] `GET /health` returns 200
- [ ] `GET /` returns 200
- [ ] Phase A: greeting → tool_call `greeting`
- [ ] Phase A: full expense → tool_call `register_transaction` with args
- [ ] Phase A: missing info → `clarification`
- [ ] Phase A: app question → tool_call `ask_app_info`
- [ ] Phase B: success → personalized `final_message`
- [ ] Phase B: tone "serious" → no emojis
- [ ] Phase B: mood "proud" → celebratory
- [ ] Phase B: mood "disappointed" → empathetic
- [ ] Phase B: ask_app_info → informative response
- [ ] Error: invalid phase → 422

**Backend Bot:**
- [ ] `/bot/test` greeting → personalized reply
- [ ] `/bot/test` full transaction → transaction registered
- [ ] `/bot/test` missing amount → clarification
- [ ] `/bot/test` budget query → budget status
- [ ] `/bot/test` goals query → goals progress
- [ ] `/bot/test` verbose mode → includes debug info

---

## 9. Complete Flows

### 9.1 Registration + Onboarding + Telegram Linking

```
1. POST /auth/signup          → Save access_token and refresh_token
2. POST /auth/onboarding      → Configure profile, categories, goals
3. POST /auth/create-link-token { "channel": "telegram" }
                               → Get linkUrl
4. User opens linkUrl in Telegram
                               → Bot receives /start ABC123
5. GET /auth/link-status       → Verify telegram.linked = true
6. User sends message in Telegram
                               → Bot processes and responds
```

### 9.2 Login + Bot Testing

```
1. POST /auth/signin           → Save access_token
2. POST /bot/test { "message": "hola", "userId": "uuid" }
                               → Verify greeting response
3. POST /bot/test { "message": "gaste 10 lucas en uber", "userId": "uuid" }
                               → Verify transaction registered
```

### 9.3 Full Bot Flow (detailed)

```
User: "gaste 15 lucas en comida"
  │
  ▼
┌─────────────────────────────────┐
│ 1. Adapter → DomainMessage      │
│    contextMs: ~45ms             │
└───────────────┬─────────────────┘
                ▼
┌─────────────────────────────────┐
│ 2. Check linking → OK           │
└───────────────┬─────────────────┘
                ▼
┌─────────────────────────────────┐
│ 3. Load UserContext (cache)     │
└───────────────┬─────────────────┘
                ▼
┌─────────────────────────────────┐
│ 4. Phase A: AI decides          │
│    → tool_call: register_trans  │
│    phaseAMs: ~120ms             │
└───────────────┬─────────────────┘
                ▼
┌─────────────────────────────────┐
│ 5. Guardrails validate args     │
└───────────────┬─────────────────┘
                ▼
┌─────────────────────────────────┐
│ 6. Handler executes:            │
│    - Lookup category            │
│    - INSERT transactions        │
│    toolMs: ~60ms                │
└───────────────┬─────────────────┘
                ▼
┌─────────────────────────────────┐
│ 7. Phase B: AI generates reply  │
│    → "Listo! Registre $15.000   │
│       en comida."               │
│    phaseBMs: ~25ms              │
└───────────────┬─────────────────┘
                ▼
┌─────────────────────────────────┐
│ 8. Send response to channel     │
│    totalMs: ~250ms              │
└─────────────────────────────────┘
```

---

## 10. Postman Setup

### Environment Variables

| Variable | Initial Value | Description |
|----------|---------------|-------------|
| `backend_url` | `http://localhost:3000` | Backend base URL |
| `ai_url` | `http://localhost:8000` | AI service base URL |
| `access_token` | (empty) | Auto-filled on login |
| `refresh_token` | (empty) | Auto-filled on login |
| `test_user_id` | (your Supabase UUID) | User ID for testing |

### Auto-Save Tokens Script

Add this as a Post-Response script on login/signup requests:

```javascript
if (pm.response.code === 200 || pm.response.code === 201) {
    const json = pm.response.json();
    pm.environment.set("access_token", json.session.accessToken);
    pm.environment.set("refresh_token", json.session.refreshToken);
    if (json.user) pm.environment.set("test_user_id", json.user.id);
}
```

### Quick Health Checks

```bash
# Backend
curl http://localhost:3000/

# AI Service
curl http://localhost:8000/health

# Bot test
curl -X POST http://localhost:3000/bot/test \
  -H "Content-Type: application/json" \
  -d '{"message":"hola","userId":"your-uuid"}'
```

### AI Service Troubleshooting

| Problem | Solution |
|---------|----------|
| `ModuleNotFoundError` | Run `pip install -r requirements.txt` |
| `OPENAI_API_KEY not set` | Check `.env` in ai-service directory |
| `Port 8000 already in use` | `pkill -f uvicorn` or use `--port 8001` |
| `Permission denied` | Activate venv: `source .venv/bin/activate` |

---

**Consolidated from:** GUIA_ENDPOINTS_POSTMAN.md (backend), GUIA_ENDPOINTS_Y_TESTING.md (AI service)
