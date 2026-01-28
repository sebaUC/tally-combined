# 🧠 Blueprint integral de Fine‑tuning Multiusuario (2025)

Este documento extiende tu arquitectura actual para incorporar **fine‑tuning basado en conversaciones reales por usuario**, manteniendo **conocimiento de dominio financiero** (RAG) y añadiendo **evaluación continua, despliegue controlado y dashboards web**. Mantiene NestJS (backend orquestador) + FastAPI (IA) y añade un **Trainer Service** para FT/Eval.

---

## 0) Diagrama de arquitectura (alto nivel)

```
Usuario (Telegram/Web) ─► Telegram API (Webhook)
      │                         │
      ▼                         ▼
  BotController (NestJS) ◄──────┘  (HTTP POST)
      ▼
  TelegramAdapter → DomainMessage
      ▼
  BotService  ─────────────────────────────────────────────────┐
      │                                                        │
      │  (A) Runtime RAG (experto finanzas)                    │
      │   ├─ QueryBuilder (intensidad/tono por usuario)        │
      │   ├─ VectorDB (pgvector/Supabase) ◄─ Dom. Finance KB   │
      │   └─ Context Builder → AiClient.styleReply / ask       │
      │                                                        │
      │  (B) Data Logging & Telemetry                          │
      │   ├─ messages, sessions, nlu_annotations               │
      │   └─ event_log (latencia, tokens, modelo, errores)     │
      │                                                        │
      ▼                                                        │
  AiClient  ─────────► FastAPI (IA Service) ───────────────────┤
      │                      │                                 │
      │                      ├─ /nlu/parse                     │
      │                      ├─ /style/reply                   │
      │                      └─ /ask                           │
      │                                                        │
      └────────────────► Trainer Service (FT/Eval API) ◄───────┘
                             │
                             ├─ /dataset/export (desde DB)
                             ├─ /finetune/start   (OpenAI FT)
                             ├─ /finetune/status
                             ├─ /eval/run (offline + canary)
                             └─ /models/rollout (gradual)

DB única (Postgres/Supabase) ── schemas: app, ml, analytics
                                ├─ app: users, sessions, messages, prefs
                                ├─ ml: finetune_examples, eval_sets, model_versions
                                └─ analytics: vistas/materialized_views, dashboards
```

---

## 1) Modelo de datos (DB única, 3 esquemas)

### **schema: app** (runtime conversacional)
- **users**(id, channel, external_id, locale, intensity NUMERIC(2,1), tone, created_at)
- **sessions**(id, user_id, started_at, ended_at, channel)
- **messages**(id, session_id, sender ENUM('user','bot'), text, raw JSONB, ts, platform_msg_id)
- **user_prefs**(user_id, budget_goal, categories_json, privacy_flags)
- **event_log**(id, session_id, model, tokens_in, tokens_out, latency_ms, ok BOOL, error_msg)

### **schema: ml** (entrenamiento y evaluación)
- **nlu_annotations**(message_id, intent, slots JSONB, confidence, reviewed_by, is_gold BOOL)
- **finetune_examples**(id, source_message_id, prompt, completion, meta JSONB, quality ENUM('low','med','high'))
- **eval_sets**(id, name, split ENUM('dev','test'), item JSONB, metric JSONB)
- **model_versions**(id, provider, base_model, finetune_id, status, created_at, deployed_at, notes)
- **eval_results**(model_version_id, eval_set_id, metrics JSONB, created_at)
- **message_embeddings**(message_id, embedding VECTOR, intent, meta)

### **schema: analytics** (dashboards)
- **vw_user_health** (materialized): sesiones, retención, satscore
- **vw_intent_quality**: F1 por intent, exact‑slot, fallos frecuentes
- **vw_tokens_cost**: costo por usuario/intent/modelo

> **Una sola base de datos es suficiente**. Separar por **schemas** aísla responsabilidades y facilita permisos.

---

## 2) RAG de dominio financiero (experto)

1. **Corpus**: manuales de categoría de gastos, políticas, mejores prácticas, glosario local (es‑CL), reglas de validación.
2. **Ingesta** (batch): PDF/Markdown → **chunks** (800‑1200 tokens) → **embeddings** (text‑embedding‑3-large) → `ml.message_embeddings` o tabla dedicada `ml.domain_chunks`.
3. **Runtime**: BotService hace **retrieval** (k=4‑6, MMR) por consulta del usuario; compone **Contexto** con *instructions + top‑chunks + estado de usuario*.
4. **Llama a** `/style/reply` con **contexto enriquecido**. Así garantizas respuestas de **calidad de experto** sin sobre‑entrenar.

---

## 3) Pipeline de Fine‑tuning (SFT) continuo

**Cadencia sugerida:** ETL diario, FT semanal, eval/rollout controlado.

**Etapas:**
1) **Recolección**: `messages` (pares user→bot estables) + `nlu_annotations` revisadas.
2) **Anonimización**: mascar CLP, RUT, tarjetas (policy regex + heurísticas). Marca `meta.pii_scrubbed=true`.
3) **Filtrado de calidad**: latencia<8s, sin errores, textos>6 tokens, intents más frecuentes.
4) **Equilibrado**: balance por intent y por intensidad (low/med/high).
5) **Construcción JSONL**:
   - `system`: "Eres **Gus** coach financiero. Respeta políticas, es‑CL. Usa intensidad=<x> cuando se proporcione."
   - `user`: texto original (scrubbed) + {locale,intensity,hints}
   - `assistant`: respuesta **ideal** (si hay corrección humana, usa esa).
6) **Entrenamiento**: `Trainer Service` crea el job (OpenAI FT) con **base_model** `gpt-4o-mini` (costo/latencia/quality) y hyperparams por defecto.
7) **Evaluación offline**: `eval_sets` (golden) → métricas: **Intent F1**, **Slot exact**, **Toxicity**, **Hallucination rate**, **Finance‑format compliance**.
8) **Canary A/B**: 10‑20% de tráfico real con `model_version` nuevo; compara **CSAT**, **recontact rate**, **cost/tokens**.
9) **Rollout**: si pasa umbrales, promover `model_versions.deployed_at` y elevar canary→100%.

---

## 4) Control de **intensidad** por usuario (sin modelos por usuario)

- Guarda `users.intensity` (0.0–1.0) y `tone` (coach|neutral|formal).
- **Prompt‑conditioner** en runtime: el `Context Builder` inserta instrucciones del estilo:

```
"Si intensity≥0.8: agrega refuerzo positivo y emojis moderados; si ≤0.3: sé sobrio y directo; nunca afectes exactitud financiera."
```

- Incluye ejemplos con distintos niveles en `finetune_examples` para que el modelo aprenda a seguirlo, pero el **valor actual** se pasa en cada request.

---

## 5) API propuesta (FastAPI + Trainer Service)

### FastAPI (IA Service)
- **POST /nlu/parse** → {intent, slots, confidence}
- **POST /style/reply** → body: {text, locale, **intensity**, tone, context, user_state}
- **POST /ask** → fallback libre

### Trainer Service (puede vivir en el mismo repo de IA)
- **POST /dataset/export** (filters: intents, min_confidence, date_range)
- **POST /finetune/start** (base_model, dataset_uri, notes)
- **GET  /finetune/status?id=**
- **POST /eval/run** (model_version, eval_set)
- **POST /models/rollout** (model_version, traffic_pct)

> NestJS `AiClient` agrega métodos espejo y roles/keys separados (prod vs trainer).

---

## 6) Frontend web mínimo (dashboards)

**Objetivo**: visión rápida por usuario y salud del modelo. Puede salir directo de la API (Next.js/Lovable) leyendo la **misma DB** con vistas `analytics` y endpoints read‑only.

**Vistas recomendadas**:
- **Home (admin)**: versión activa del modelo, canary %, costos diarios, latencia p95.
- **Usuarios**: lista, intensidad, sesiones, categorías más usadas, adherence a presupuesto.
- **Calidad NLU**: F1 por intent, confusión matrices, errores frecuentes.
- **Economía**: tokens y costo por intent/usuario/canal.

**Seguridad**: RBAC (admin vs user). Los usuarios finales solo ven sus propios datos; admin ve agregados.

---

## 7) Observabilidad & Guardrails

- **PII scrubbers** en ingreso + pre‑FT.
- **Policies** (e.g., no recomendaciones de inversión específicas; disclaimers).
- **Validadores financieros**: formatos CLP/UF, sumas, fecha/mes válido, categorías.
- **Tracing**: request_id encadenado desde webhook → respuesta, con `event_log`.
- **Alerts**: spikes de latencia, error rate, caída de F1.

---

## 8) Roadmap de implementación (8 pasos)

1. Crear **schemas** y tablas (app/ml/analytics) + pgvector.
2. Implementar **RAG ingestion** de dominio financiero.
3. Añadir **Context Builder** (intensidad + RAG + estado) en BotService.
4. Instrumentar **logging** (messages/event_log) y anonimización.
5. Construir **Trainer Service** (export, FT, eval, rollout).
6. Crear **eval_sets** (golden) y harness de métricas.
7. Desplegar **canary A/B** + métricas en dashboards.
8. Establecer **cadencias** (ETL diario, FT semanal, reporte quincenal).

---

## 9) Umbrales de aceptación sugeridos
- Intent F1 **≥ 0.92** en top‑10 intents
- Slot exact match **≥ 0.90**
- Hallucination/Off‑policy **≤ 1.5%**
- Latencia p95 **≤ 3.5 s** (RAG on) / **≤ 2.2 s** (sin RAG)
- CSAT **≥ 4.5/5**

---

### Notas finales
- Una **DB única** con separación por **schemas** es óptima para tu estadio actual.
- El **conocimiento de dominio** debe vivir en RAG; el fine‑tune se centra en **estilo, formato y decisiones**.
- El control por **intensidad** se maneja **en runtime** + ejemplos representativos en el dataset.

