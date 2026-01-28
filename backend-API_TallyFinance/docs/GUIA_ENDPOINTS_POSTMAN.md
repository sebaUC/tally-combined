# GUÍA DE ENDPOINTS Y TESTING — TallyFinance API

**Fecha:** Diciembre 2024
**Base URL Local:** `http://localhost:3000`
**Base URL Producción:** `https://api.tallyfinance.com`

---

## ÍNDICE

1. [Configuración de Postman](#1-configuración-de-postman)
2. [Endpoints de Autenticación](#2-endpoints-de-autenticación)
3. [Endpoints del Bot](#3-endpoints-del-bot)
4. [Endpoints de Usuario](#4-endpoints-de-usuario)
5. [Flujos Completos](#5-flujos-completos)
6. [Variables de Entorno Postman](#6-variables-de-entorno-postman)
7. [Colección Postman (JSON)](#7-colección-postman-json)

---

## 1. CONFIGURACIÓN DE POSTMAN

### Variables de Entorno

Crear un environment en Postman con estas variables:

| Variable | Valor Inicial | Descripción |
|----------|---------------|-------------|
| `base_url` | `http://localhost:3000` | URL base del servidor |
| `access_token` | (vacío) | Se llena automáticamente al hacer login |
| `refresh_token` | (vacío) | Se llena automáticamente al hacer login |
| `test_user_id` | (tu UUID de Supabase) | ID de usuario para testing |

### Headers Comunes

Para endpoints protegidos (requieren autenticación):

```
Authorization: Bearer {{access_token}}
Content-Type: application/json
```

---

## 2. ENDPOINTS DE AUTENTICACIÓN

### 2.1 Registro de Usuario

**Endpoint:** `POST /auth/signup`
**Autenticación:** No requerida

**Request Body:**
```json
{
  "email": "usuario@ejemplo.com",
  "password": "miPassword123",
  "fullName": "Juan Pérez"
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

**Script Post-Response (guardar tokens):**
```javascript
if (pm.response.code === 201) {
    const json = pm.response.json();
    pm.environment.set("access_token", json.session.accessToken);
    pm.environment.set("refresh_token", json.session.refreshToken);
}
```

---

### 2.2 Login de Usuario

**Endpoint:** `POST /auth/signin`
**Autenticación:** No requerida

**Request Body:**
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
      "full_name": "Juan Pérez",
      "nickname": null,
      "timezone": "America/Santiago",
      "locale": "es-CL",
      "onboarding_completed": false
    }
  }
}
```

**Script Post-Response:**
```javascript
if (pm.response.code === 200) {
    const json = pm.response.json();
    pm.environment.set("access_token", json.session.accessToken);
    pm.environment.set("refresh_token", json.session.refreshToken);
    pm.environment.set("test_user_id", json.user.id);
}
```

---

### 2.3 Login con OAuth (Google, GitHub, etc.)

**Paso 1 - Obtener URL de OAuth:**

**Endpoint:** `POST /auth/provider`
**Autenticación:** No requerida

**Request Body:**
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

**Uso:** Abrir la URL en el navegador para completar OAuth.

---

**Paso 2 - Callback (automático):**

**Endpoint:** `GET /auth/callback?access_token=xxx&refresh_token=yyy`
**Autenticación:** No requerida

Este endpoint es llamado automáticamente por el frontend después del OAuth.

---

### 2.4 Refrescar Token

**Endpoint:** `POST /auth/refresh`
**Autenticación:** No requerida (usa cookies)

**Headers:**
```
Cookie: refresh_token={{refresh_token}}
```

**Response (200):**
```json
{
  "message": "Session refreshed",
  "session": {
    "accessToken": "eyJ...(nuevo)...",
    "refreshToken": "abc123...(nuevo o igual)...",
    "expiresAt": 1703678400,
    "expiresIn": 3600,
    "tokenType": "bearer"
  }
}
```

---

### 2.5 Logout

**Endpoint:** `POST /auth/logout`
**Autenticación:** No requerida

**Response (200):**
```json
{
  "message": "Logged out"
}
```

---

### 2.6 Obtener Perfil Actual

**Endpoint:** `GET /auth/me`
**Autenticación:** Requerida

**Headers:**
```
Authorization: Bearer {{access_token}}
```

**Response (200):**
```json
{
  "id": "uuid-del-usuario",
  "email": "usuario@ejemplo.com",
  "profile": {
    "full_name": "Juan Pérez",
    "nickname": "Juanito",
    "timezone": "America/Santiago",
    "locale": "es-CL",
    "onboarding_completed": true,
    "package": "basic"
  }
}
```

---

### 2.7 Estado de Vinculación de Canales

**Endpoint:** `GET /auth/link-status`
**Autenticación:** Requerida

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

---

### 2.8 Crear Token de Vinculación

**Endpoint:** `POST /auth/create-link-token`
**Autenticación:** Requerida

**Request Body:**
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

---

### 2.9 Vincular Canal (desde código)

**Endpoint:** `POST /auth/link-channel`
**Autenticación:** Requerida

**Request Body (opción 1 - con código):**
```json
{
  "linkCode": "ABC123"
}
```

**Request Body (opción 2 - con token):**
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

---

### 2.10 Completar Onboarding

**Endpoint:** `POST /auth/onboarding`
**Autenticación:** Requerida

**Request Body:**
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

## 3. ENDPOINTS DEL BOT

### 3.1 Webhook de Telegram

**Endpoint:** `POST /telegram/webhook`
**Autenticación:** No requerida (verificado por Telegram)

**Request Body (ejemplo de Telegram):**
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
    "text": "gasté 15 lucas en comida"
  }
}
```

**Response (200):**
```
OK
```

---

### 3.2 Webhook de WhatsApp

**Endpoint:** `POST /whatsapp/webhook`
**Autenticación:** No requerida (verificado por Meta)

**Request Body (ejemplo de WhatsApp):**
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
                "profile": { "name": "Juan Pérez" },
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

**Response (200):**
```
EVENT_RECEIVED
```

---

### 3.3 Endpoint de Testing (MUY ÚTIL)

**Endpoint:** `POST /bot/test`
**Autenticación:** No requerida

Este endpoint permite probar el bot sin necesidad de Telegram/WhatsApp.

**Request Body (básico):**
```json
{
  "message": "gasté 15 lucas en comida",
  "userId": "uuid-del-usuario"
}
```

**Request Body (con opciones):**
```json
{
  "message": "gasté 15 lucas en comida",
  "userId": "uuid-del-usuario",
  "channel": "test",
  "verbose": true
}
```

**Response (200) - Modo Normal:**
```json
{
  "ok": true,
  "reply": "¡Listo! Registré $15.000 en comida.",
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

**Response (200) - Modo Verbose:**
```json
{
  "ok": true,
  "reply": "¡Listo! Registré $15.000 en comida.",
  "metrics": {
    "correlationId": "abc12345",
    "totalMs": 250,
    "contextMs": 45,
    "phaseAMs": 120,
    "toolMs": 60,
    "phaseBMs": 25
  },
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
      "platformMessageId": "test-1703673600",
      "text": "gasté 15 lucas en comida",
      "timestamp": "2024-12-27T10:00:00Z"
    }
  },
  "context": {
    "userId": "uuid-del-usuario",
    "displayName": "Juanito",
    "personality": {
      "tone": "friendly",
      "intensity": 3,
      "mood": "normal"
    },
    "prefs": {
      "timezone": "America/Santiago",
      "locale": "es-CL",
      "notificationLevel": "medium",
      "unifiedBalance": true
    },
    "activeBudget": {
      "period": "monthly",
      "amount": 800000
    },
    "goalsCount": 1
  }
}
```

---

### 3.4 Casos de Prueba para /bot/test

#### Saludo
```json
{ "message": "hola", "userId": "{{test_user_id}}" }
```
**Respuesta esperada:** "¡Hola! ¿En qué te puedo ayudar hoy?"

#### Transacción Completa
```json
{ "message": "gasté 15 lucas en comida", "userId": "{{test_user_id}}" }
```
**Respuesta esperada:** "¡Listo! Registré $15.000 en comida."

#### Transacción - Falta Monto
```json
{ "message": "gasté en transporte", "userId": "{{test_user_id}}" }
```
**Respuesta esperada:** "¿Cuánto fue el gasto exactamente?"

#### Transacción - Falta Categoría
```json
{ "message": "gasté 5000", "userId": "{{test_user_id}}" }
```
**Respuesta esperada:** "¿En qué categoría lo registro? (ej: comida, transporte, salud…)"

#### Consultar Presupuesto
```json
{ "message": "cómo voy con mi presupuesto", "userId": "{{test_user_id}}" }
```
**Respuesta esperada:** "Tu presupuesto monthly es de $800.000." (o mensaje de no configurado)

#### Consultar Metas
```json
{ "message": "cómo van mis metas", "userId": "{{test_user_id}}" }
```
**Respuesta esperada:** "Tus metas: Vacaciones: 0%" (o mensaje de no configurado)

#### Consultar Saldo (deshabilitado)
```json
{ "message": "cuánto tengo", "userId": "{{test_user_id}}" }
```
**Respuesta esperada:** "La consulta de saldos estará disponible muy pronto..."

#### Mensaje Desconocido
```json
{ "message": "asdfghjkl", "userId": "{{test_user_id}}" }
```
**Respuesta esperada:** "¡Hola! ¿En qué te puedo ayudar hoy?" (greeting por defecto)

---

## 4. ENDPOINTS DE USUARIO

### 4.1 Obtener Perfil (desde Users Module)

**Endpoint:** `GET /api/users/me`
**Autenticación:** Requerida

**Response (200):**
```json
{
  "id": "uuid-del-usuario",
  "email": "usuario@ejemplo.com",
  "full_name": "Juan Pérez",
  "nickname": "Juanito",
  "timezone": "America/Santiago",
  "locale": "es-CL",
  "package": "basic",
  "onboarding_completed": true
}
```

---

### 4.2 Obtener Contexto Completo

**Endpoint:** `GET /api/users/context`
**Autenticación:** Requerida

**Response (200):**
```json
{
  "userId": "uuid-del-usuario",
  "displayName": "Juanito",
  "personality": {
    "tone": "friendly",
    "intensity": 3,
    "mood": "normal"
  },
  "prefs": {
    "timezone": "America/Santiago",
    "locale": "es-CL",
    "notificationLevel": "medium",
    "unifiedBalance": true
  },
  "activeBudget": {
    "period": "monthly",
    "amount": 800000
  },
  "goalsCount": 1
}
```

---

## 5. FLUJOS COMPLETOS

### 5.1 Flujo de Registro + Onboarding + Vincular Telegram

```
1. POST /auth/signup
   → Guardar access_token y refresh_token

2. POST /auth/onboarding
   → Configurar perfil, categorías, metas

3. POST /auth/create-link-token
   Body: { "channel": "telegram" }
   → Obtener linkUrl

4. Usuario abre linkUrl en Telegram
   → Bot recibe /start ABC123

5. GET /auth/link-status
   → Verificar que telegram.linked = true

6. Usuario envía mensaje en Telegram
   → Bot procesa y responde
```

### 5.2 Flujo de Login + Usar Bot

```
1. POST /auth/signin
   → Guardar access_token

2. POST /bot/test
   Body: { "message": "hola", "userId": "uuid" }
   → Verificar respuesta

3. POST /bot/test
   Body: { "message": "gasté 10 lucas en uber", "userId": "uuid" }
   → Verificar transacción registrada
```

### 5.3 Flujo Híbrido del Bot (detallado)

```
Usuario: "gasté 15 lucas en comida"
           │
           ▼
┌─────────────────────────────────┐
│ 1. Adapter convierte a          │
│    DomainMessage                │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│ 2. BotChannelService verifica   │
│    vinculación → OK             │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│ 3. UserContextService carga     │
│    contexto (cache hit/miss)    │
│    contextMs: 45ms              │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│ 4. Phase A: IA decide           │
│    → tool_call: register_trans  │
│    → args: {amount:15000,       │
│             category:"comida"}  │
│    phaseAMs: 120ms              │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│ 5. GuardrailsService valida     │
│    → valid: true                │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│ 6. ToolRegistry obtiene handler │
│    → RegisterTransactionHandler │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│ 7. Handler ejecuta:             │
│    - Busca categoría "comida"   │
│    - Obtiene payment_method     │
│    - INSERT en transactions     │
│    toolMs: 60ms                 │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│ 8. Phase B: IA genera mensaje   │
│    → "¡Listo! Registré $15.000  │
│       en comida."               │
│    phaseBMs: 25ms               │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│ 9. Adapter envía respuesta      │
│    al canal                     │
│    totalMs: 250ms               │
└─────────────────────────────────┘
```

---

## 6. VARIABLES DE ENTORNO POSTMAN

```json
{
  "id": "tallyfinance-env",
  "name": "TallyFinance Local",
  "values": [
    {
      "key": "base_url",
      "value": "http://localhost:3000",
      "enabled": true
    },
    {
      "key": "access_token",
      "value": "",
      "enabled": true
    },
    {
      "key": "refresh_token",
      "value": "",
      "enabled": true
    },
    {
      "key": "test_user_id",
      "value": "",
      "enabled": true
    }
  ]
}
```

---

## 7. COLECCIÓN POSTMAN (JSON)

Puedes importar esta colección directamente en Postman:

```json
{
  "info": {
    "name": "TallyFinance API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Auth",
      "item": [
        {
          "name": "Signup",
          "request": {
            "method": "POST",
            "header": [{"key": "Content-Type", "value": "application/json"}],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"email\": \"test@ejemplo.com\",\n  \"password\": \"Test123456\",\n  \"fullName\": \"Usuario Test\"\n}"
            },
            "url": "{{base_url}}/auth/signup"
          }
        },
        {
          "name": "Signin",
          "request": {
            "method": "POST",
            "header": [{"key": "Content-Type", "value": "application/json"}],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"email\": \"test@ejemplo.com\",\n  \"password\": \"Test123456\"\n}"
            },
            "url": "{{base_url}}/auth/signin"
          },
          "event": [
            {
              "listen": "test",
              "script": {
                "exec": [
                  "if (pm.response.code === 200) {",
                  "    const json = pm.response.json();",
                  "    pm.environment.set('access_token', json.session.accessToken);",
                  "    pm.environment.set('refresh_token', json.session.refreshToken);",
                  "    pm.environment.set('test_user_id', json.user.id);",
                  "}"
                ]
              }
            }
          ]
        },
        {
          "name": "Get Me",
          "request": {
            "method": "GET",
            "header": [{"key": "Authorization", "value": "Bearer {{access_token}}"}],
            "url": "{{base_url}}/auth/me"
          }
        },
        {
          "name": "Link Status",
          "request": {
            "method": "GET",
            "header": [{"key": "Authorization", "value": "Bearer {{access_token}}"}],
            "url": "{{base_url}}/auth/link-status"
          }
        },
        {
          "name": "Create Link Token",
          "request": {
            "method": "POST",
            "header": [
              {"key": "Authorization", "value": "Bearer {{access_token}}"},
              {"key": "Content-Type", "value": "application/json"}
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"channel\": \"telegram\"\n}"
            },
            "url": "{{base_url}}/auth/create-link-token"
          }
        },
        {
          "name": "Onboarding",
          "request": {
            "method": "POST",
            "header": [
              {"key": "Authorization", "value": "Bearer {{access_token}}"},
              {"key": "Content-Type", "value": "application/json"}
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"nickname\": \"TestUser\",\n  \"timezone\": \"America/Santiago\",\n  \"locale\": \"es-CL\",\n  \"package\": \"basic\",\n  \"categories\": [\n    {\"name\": \"Comida\"},\n    {\"name\": \"Transporte\"}\n  ],\n  \"paymentMethods\": [\n    {\n      \"name\": \"Tarjeta Test\",\n      \"paymentType\": \"debito\",\n      \"currency\": \"CLP\"\n    }\n  ]\n}"
            },
            "url": "{{base_url}}/auth/onboarding"
          }
        },
        {
          "name": "Logout",
          "request": {
            "method": "POST",
            "url": "{{base_url}}/auth/logout"
          }
        }
      ]
    },
    {
      "name": "Bot",
      "item": [
        {
          "name": "Test - Saludo",
          "request": {
            "method": "POST",
            "header": [{"key": "Content-Type", "value": "application/json"}],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"message\": \"hola\",\n  \"userId\": \"{{test_user_id}}\"\n}"
            },
            "url": "{{base_url}}/bot/test"
          }
        },
        {
          "name": "Test - Transacción Completa",
          "request": {
            "method": "POST",
            "header": [{"key": "Content-Type", "value": "application/json"}],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"message\": \"gasté 15 lucas en comida\",\n  \"userId\": \"{{test_user_id}}\"\n}"
            },
            "url": "{{base_url}}/bot/test"
          }
        },
        {
          "name": "Test - Falta Monto",
          "request": {
            "method": "POST",
            "header": [{"key": "Content-Type", "value": "application/json"}],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"message\": \"gasté en transporte\",\n  \"userId\": \"{{test_user_id}}\"\n}"
            },
            "url": "{{base_url}}/bot/test"
          }
        },
        {
          "name": "Test - Presupuesto",
          "request": {
            "method": "POST",
            "header": [{"key": "Content-Type", "value": "application/json"}],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"message\": \"cómo voy con mi presupuesto\",\n  \"userId\": \"{{test_user_id}}\"\n}"
            },
            "url": "{{base_url}}/bot/test"
          }
        },
        {
          "name": "Test - Metas",
          "request": {
            "method": "POST",
            "header": [{"key": "Content-Type", "value": "application/json"}],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"message\": \"cómo van mis metas\",\n  \"userId\": \"{{test_user_id}}\"\n}"
            },
            "url": "{{base_url}}/bot/test"
          }
        },
        {
          "name": "Test - Verbose Mode",
          "request": {
            "method": "POST",
            "header": [{"key": "Content-Type", "value": "application/json"}],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"message\": \"gasté 20 lucas en uber\",\n  \"userId\": \"{{test_user_id}}\",\n  \"verbose\": true\n}"
            },
            "url": "{{base_url}}/bot/test"
          }
        }
      ]
    },
    {
      "name": "Users",
      "item": [
        {
          "name": "Get Me",
          "request": {
            "method": "GET",
            "header": [{"key": "Authorization", "value": "Bearer {{access_token}}"}],
            "url": "{{base_url}}/api/users/me"
          }
        },
        {
          "name": "Get Context",
          "request": {
            "method": "GET",
            "header": [{"key": "Authorization", "value": "Bearer {{access_token}}"}],
            "url": "{{base_url}}/api/users/context"
          }
        }
      ]
    }
  ]
}
```

---

## RESUMEN DE ENDPOINTS

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/` | No | Health check |
| `POST` | `/auth/signup` | No | Registro de usuario |
| `POST` | `/auth/signin` | No | Login |
| `POST` | `/auth/provider` | No | Iniciar OAuth |
| `GET` | `/auth/callback` | No | Callback OAuth |
| `POST` | `/auth/refresh` | Cookie | Refrescar token |
| `POST` | `/auth/logout` | No | Cerrar sesión |
| `GET` | `/auth/me` | Sí | Perfil actual |
| `GET` | `/auth/sessions` | Sí | Sesiones activas |
| `GET` | `/auth/link-status` | Sí | Estado de canales |
| `POST` | `/auth/link-channel` | Sí | Vincular canal |
| `POST` | `/auth/create-link-token` | Sí | Crear token de vinculación |
| `POST` | `/auth/onboarding` | Sí | Completar onboarding |
| `POST` | `/telegram/webhook` | No* | Webhook Telegram |
| `POST` | `/whatsapp/webhook` | No* | Webhook WhatsApp |
| `POST` | `/bot/test` | No | Testing del bot |
| `GET` | `/api/users/me` | Sí | Perfil usuario |
| `GET` | `/api/users/context` | Sí | Contexto completo |

*Verificados por la plataforma (Telegram/Meta)

---

**Documento generado:** Diciembre 2024
**Versión:** API v1.0
