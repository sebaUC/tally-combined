# Plan — User Insights: Motor narrativo + Commitments

**Estado:** activo · MVP manual (sin Fintoc) · fusión con sistema de personalidad
**Última actualización:** 2026-05-18
**Reemplaza:** versión anterior basada en Fintoc (archivada en historial git)

---

## Resumen ejecutivo

`user_insights` deja de ser una tabla de métricas para convertirse en la **front page del
periódico personal del user** — un estado siempre fresco que el bot lee en cada turn y
que alimenta los reportes proactivos. La novedad no son los promedios; son tres cosas:

1. **Magnitudes en escala personal** (percentiles, no medias) → el bot sabe si $20k es
   mucho o poco *para este user*, no para "el chileno promedio".
2. **Commitments detectados en chat** → cuando el user dice "no más delivery", queda
   registrado, se evalúa contra cada tx posterior, y el bot puede citarlo textual.
3. **Observations pre-redactadas en 4 tonos** → el engine no entrega datos sueltos al
   LLM, entrega frases listas con evidencia adjunta. Eso evita alucinaciones de
   magnitud y baja el costo de Gemini en hot path.

El mismo dataset que ve el user en el reporte nocturno es el que lee el bot al
calibrar reactividad. Coherencia narrativa por construcción.

---

## Diagnóstico del plan anterior

El plan original computaba `avg_monthly_spend`, `top_categories`, `category_baselines`.
Todo correcto, pero es lo que hace **toda** app de finanzas. Si nos quedamos ahí
terminamos con un dashboard más entre cien dashboards.

La pregunta correcta no es *"qué métricas computo"* sino: **¿qué hace que un humano
sienta que el bot le entiende su plata?**

Un humano se siente entendido cuando alguien:

- Le pone el dato en escala personal ("ese gasto está en tu top 5% de transacciones")
- Recuerda lo que prometió ("hace 5 días dijiste menos delivery, van 3 esta semana")
- Le cuenta su propia historia ("llevas 14 días registrando — mejor racha")
- Comenta lo raro, no lo obvio ("Suscripciones subió 40% sin que agregaras servicios")
- Conecta hechos ("cada vez que hay día >$30k, al siguiente bajas a la mitad")

Ninguna de esas frases sale de `avg = $X`. Salen de un engine que **busca historias**
en los datos.

---

## La idea de fondo: tres capas

`user_insights` se organiza en tres capas que se alimentan en cascada:

```
┌─────────────────────────────────────────────────────────────┐
│ LAYER 1 — MÉTRICAS                                          │
│ Distribuciones, fingerprint por categoría, ritmos, estado   │
│ actual, anclas históricas.                                  │
│                                                             │
│ ↓ alimenta                                                  │
│                                                             │
│ LAYER 2 — OBSERVATIONS                                      │
│ 7 beats escanean métricas y producen frases pre-redactadas  │
│ en 4 tonos, con importance, evidencia y expiración.         │
│                                                             │
│ ↓ alimenta                                                  │
│                                                             │
│ LAYER 3 — MONEY DIARY                                       │
│ Párrafos narrativos del user, regenerados semanalmente.     │
│ Quién eres financieramente, qué compras, cuándo, progreso.  │
└─────────────────────────────────────────────────────────────┘

Consumo:
• Bot turn-time → lee layer 1 (escala) + layer 2 (qué mencionar)
• Reportes proactivos → leen layer 2 (titulares) + layer 3 (contexto)
• Tool on-demand → arma respuesta con layer 2 + layer 3 según pregunta
```

---

## La pieza única: Commitments

Esta es la jugada que ninguna app de finanzas hace y donde la naturaleza
conversacional de Tally se convierte en moat defendible.

### Qué son

Promesas que el user hace en chat:

- "no quiero gastar tanto en delivery"
- "voy a ahorrar $200k al mes para Brasil"
- "máximo $50k a la semana en comida"
- "no más Uber este mes"

Hoy Gus las escucha y se olvida. Es estúpido. Con commitments, queda registrado con
**cita textual** del mensaje original.

### Cómo se detectan

Function nueva `track_commitment` que Gemini llama cuando reconoce una promesa en
el mensaje del user. Args:

```typescript
{
  kind: 'avoid_category' | 'cap_per_period' | 'save_target' | 'reduce_vs_baseline',
  category_id?: string,
  amount?: number,
  period?: 'daily' | 'weekly' | 'monthly',
  target_date?: string,  // YYYY-MM-DD
  source_quote: string,  // la frase tal cual la dijo el user
  expires_at?: string,
}
```

### Cómo se evalúan

Cada vez que el user registra una tx, el engine corre `testCommitments(tx)`:

- Tx en categoría que prometió evitar → `fail++`, produce Observation crítica
- Tx que lo lleva sobre el cap semanal → `fail++`, observation alta importance
- Día sin romper commitment → `pass++` (al cierre del período), observation positiva
- Target_date alcanzado con éxito → status='completed', observation milestone

### Por qué cambia todo

El bot puede decir cosas que **ningún chatbot financiero dice**:

> "Cuarta vez en Uber esta semana. Habíamos hablado de bajarlo el martes pasado."

Con cita textual de la promesa original. Eso es lo "nunca hecho".

---

## Los 7 beats

Cada beat es una función pura que escanea las métricas de un user y produce
Observations candidatas. El engine consolida, deduplica, rankea y trim a top ~15.

| Beat | Detecta | Ejemplo de observation |
|---|---|---|
| **Magnitude** | Tx fuera de escala personal | "esa compra entra en tu top 5% de tx del año" |
| **Rhythm** | Patrones temporales | "tercer viernes seguido con gasto >$40k" |
| **Drift** | Categorías que cambian de peso | "Suscripciones pasó de 8% a 14% en 60 días" |
| **Commitment** | Promesas testeadas (pass o fail) | "11 días sin caer en ropa, primera ruptura" |
| **Progress** | Comparación temporal | "vas 18% bajo tu promedio, mejor mes desde marzo" |
| **Health** | Estados accionables | "12 días sin ingreso y gasto al ritmo de siempre" |
| **Milestone** | Hitos del user | "primer mes sin sobrepasar Comida desde que registras" |

### Shape de Observation

```typescript
interface Observation {
  id: string;
  beat: 'magnitude' | 'rhythm' | 'drift' | 'commitment'
      | 'progress' | 'health' | 'milestone';
  kind: string;  // 'tx_above_p95', 'consecutive_friday_overspend', etc.
  importance: number;  // 0-100, decae si no se usa

  // Hechos que respaldan (anti-alucinación)
  evidence: {
    metric_refs: Array<{ field: string; value: any }>;
    tx_ids?: string[];
    commitment_id?: string;
    period?: { start: string; end: string };
  };

  // Texto pre-renderizado en cada tono (engine, no Gemini)
  text: {
    neutral: string;
    friendly: string;
    strict: string;
    toxic: string;
  };

  detected_at: string;
  expires_at: string | null;
  last_surfaced_at: string | null;
  surfaced_count: number;
}
```

**Pre-render en 4 tonos por template + slots** — no llama a Gemini para generar el
texto. Eso garantiza:

- El dato citado existe (template solo consume `evidence`)
- Tono consistente entre observations
- Costo Gemini en hot path = 0 para esta parte
- El LLM puede *reescribir* la observation en turn si quiere, pero parte de una base

---

## Schema

### Tabla 1 — `user_insights`

```sql
CREATE TABLE user_insights (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- === IDENTIDAD (slow-changing, define quién es como spender) ===
  spender_archetype text,
    -- 'ant' (muchas chicas), 'whale' (pocas grandes), 'mixed', 'unknown'
  primary_category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  category_concentration numeric,  -- HHI 0-1
  data_maturity text NOT NULL DEFAULT 'empty'
    CHECK (data_maturity IN ('empty','seeding','partial','mature')),

  -- === ESCALA PERSONAL (percentiles, no promedios) ===
  daily_spend_dist jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- { p25, p50, p75, p90, p95, mean, stddev }
  tx_amount_dist jsonb NOT NULL DEFAULT '{}'::jsonb,
  monthly_spend_dist jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- === FINGERPRINT POR CATEGORÍA ===
  category_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- per cat_id: {
    --   share_pct, freq_per_week, avg_per_tx, p90_per_tx, last_tx_at,
    --   trend_30d ('up'|'flat'|'down'), drift_pct (vs 60d atrás)
    -- }
  category_baselines jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- per cat_id: { avg, stddev, count, max } — para anomaly detector

  -- === RITMOS ===
  weekday_pattern jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- por dow (0-6): { avg_spend, tx_count, top_cats }
  day_of_month_pattern jsonb NOT NULL DEFAULT '{}'::jsonb,
  peak_day_of_week int,
  peak_week_of_month int,

  -- === ESTADO ACTUAL ===
  current_month jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- { spent, days_in, days_left, pace_per_day, projected_total,
    --   vs_last_month_pct, vs_avg_pct }
  current_week jsonb NOT NULL DEFAULT '{}'::jsonb,
  budget_state jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- per budget_id: { spent_pct, days_left, projected_overrun, break_eta }

  -- === ANCLAS HISTÓRICAS ===
  first_month jsonb,         -- inmutable después de set
  best_month jsonb,
  worst_month jsonb,
  monthly_trajectory jsonb,  -- últimos 6m: [{ month, spent, vs_budget, top_cat }]

  -- === HECHOS DESTACABLES ===
  largest_expense jsonb,
  ant_expense_count int NOT NULL DEFAULT 0,
  ant_expense_total numeric NOT NULL DEFAULT 0,

  -- === FRONT PAGE: layer 2 vigente ===
  observations jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- top ~15 observations con texto pre-renderizado, ordenadas por importance

  -- === MONEY DIARY: layer 3 ===
  money_diary jsonb,
    -- {
    --   who_you_are: "...",
    --   what_you_buy: "...",
    --   when_you_spend: "...",
    --   how_you_progress: "...",
    --   last_updated_at
    -- }

  -- === FLAGS DE CAPACIDAD ===
  has_sufficient_data boolean NOT NULL DEFAULT false,    -- ≥20 tx
  has_temporal_patterns boolean NOT NULL DEFAULT false,  -- ≥6 semanas activas
  has_anomaly_baselines boolean NOT NULL DEFAULT false,  -- ≥30 tx en top cat
  has_diary boolean NOT NULL DEFAULT false,              -- ≥30 días registrando

  -- === META ===
  source text NOT NULL DEFAULT 'incremental'
    CHECK (source IN ('incremental','batch_weekly','manual_recompute')),
  tx_count_at_compute int NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  stale boolean NOT NULL DEFAULT false,
  schema_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_insights_self ON user_insights
  FOR SELECT USING (user_id = auth.uid());
-- Escritura solo service_role

CREATE INDEX idx_user_insights_stale
  ON user_insights(stale, computed_at) WHERE stale = true;
```

### Tabla 2 — `user_commitments` (la pieza única)

```sql
CREATE TABLE user_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  kind text NOT NULL CHECK (kind IN (
    'avoid_category',      -- "no más X"
    'cap_per_period',      -- "máximo $X por semana en Y"
    'save_target',         -- "voy a ahorrar $X para Z"
    'reduce_vs_baseline'   -- "voy a bajar mi gasto en X"
  )),
  category_id uuid REFERENCES categories(id) ON DELETE CASCADE,
  amount numeric,
  period text CHECK (period IN ('daily','weekly','monthly')),
  target_date date,

  -- Trazabilidad (lo que hace que el bot pueda citar textualmente)
  source_message_id uuid,
  source_quote text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,

  -- Estado
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed','broken','expired','dismissed')),

  -- Tracking
  test_count int NOT NULL DEFAULT 0,
  pass_count int NOT NULL DEFAULT 0,
  fail_count int NOT NULL DEFAULT 0,
  last_test_at timestamptz,
  last_outcome text CHECK (last_outcome IN ('pass','fail')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY commitments_self ON user_commitments
  FOR SELECT USING (user_id = auth.uid());

CREATE INDEX idx_commitments_active
  ON user_commitments(user_id, status) WHERE status = 'active';
CREATE INDEX idx_commitments_category
  ON user_commitments(user_id, category_id) WHERE status = 'active';
```

### Tabla 3 — `user_insights_history`

Snapshots de `user_insights` en eventos relevantes. Para trends futuros y
"muéstrame mi evolución de 6 meses".

```sql
CREATE TABLE user_insights_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  trigger_source text NOT NULL CHECK (trigger_source IN (
    'maturity_promotion',  -- cruzó empty→seeding→partial→mature
    'monthly_archive',     -- primer día del mes
    'manual_recompute',
    'milestone'            -- mejor mes, primer commitment cumplido, etc.
  ))
);

CREATE INDEX idx_insights_history_user
  ON user_insights_history(user_id, computed_at DESC);

-- pg_cron semanal: DELETE WHERE computed_at < now() - interval '18 months'
```

### Cambios paralelos (limpieza de estado anterior)

```sql
-- Decisión cerrada: tone va a user_prefs, drop personality_snapshot
ALTER TABLE user_prefs
  ADD COLUMN bot_tone text NOT NULL DEFAULT 'friendly'
    CHECK (bot_tone IN ('neutral','friendly','strict','toxic'));

-- Migrar tone existente desde personality_snapshot antes del drop
UPDATE user_prefs up
SET bot_tone = ps.tone
FROM personality_snapshot ps
WHERE up.id = ps.user_id AND ps.tone IS NOT NULL;

DROP TABLE personality_snapshot;
```

### Verificación previa (decisión #6)

Antes de la migration, chequear si estas columnas ya existen en `transactions`:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'transactions'
  AND column_name IN ('is_internal_transfer','paired_transaction_id');
```

Si no existen, agregar (preparación para futuro provider bancario):

```sql
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS is_internal_transfer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paired_transaction_id uuid NULL
    REFERENCES transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer
  ON transactions(user_id, is_internal_transfer)
  WHERE is_internal_transfer = true;
```

---

## Arquitectura del módulo

```
backend/src/insights/
├── insights.module.ts
│
├── engine/
│   ├── insights-engine.service.ts        # Orquestador: tx[] → InsightResult
│   ├── layer1-metrics.service.ts         # Distribuciones, fingerprint, ritmos
│   ├── layer2-beats.service.ts           # Corre los 7 beats sobre metrics
│   ├── layer3-diary.service.ts           # Compone money_diary
│   └── detectors/
│       ├── magnitude-beat.ts
│       ├── rhythm-beat.ts
│       ├── drift-beat.ts
│       ├── commitment-beat.ts
│       ├── progress-beat.ts
│       ├── health-beat.ts
│       └── milestone-beat.ts
│
├── observations/
│   ├── observation.types.ts              # Shape de Observation
│   ├── observation-templates.ts          # Templates por kind, 4 tonos cada uno
│   ├── observation-renderer.ts           # Template + evidence → text
│   └── observation-ranker.ts             # Importance scoring + dedup + trim
│
├── commitments/
│   ├── commitments.service.ts            # CRUD + evaluador
│   ├── commitment-evaluator.ts           # testCommitments(tx) → results
│   └── commitment-tracker.ts             # Marca pass/fail al evaluar
│
├── triggers/
│   ├── incremental.service.ts            # Trigger #2: hook en mutaciones
│   ├── batch.service.ts                  # Trigger #3: cron semanal
│   └── on-demand.controller.ts           # Trigger #4: endpoint interno
│
├── io/
│   ├── insights-writer.service.ts        # Upsert user_insights + history
│   └── insights-reader.service.ts        # Queries para consumers
│
├── reports/
│   ├── report-sender.service.ts          # Cron daily/weekly/monthly
│   ├── report-templates.ts               # Plantillas por tono y periodicidad
│   └── report-composer.ts                # Observations + diary → mensaje final
│
└── contracts/
    ├── insight-input.ts
    ├── insight-result.ts
    └── transfer-detector.ts              # Stub: siempre devuelve false
```

---

## Triggers (cómo se mantiene la tabla fresca)

### Trigger #2 — Incremental (el motor principal en MVP manual)

Cada mutación de transacción dispara `updateIncremental` o `removeIncremental`.

```typescript
// register-expense.fn.ts (final del handler)
await insightsEngine.updateIncremental(userId, newTx);

// delete-transaction.fn.ts
await insightsEngine.removeIncremental(userId, deletedTx);

// edit-transaction.fn.ts
await insightsEngine.applyDelta(userId, oldTx, newTx);
```

Implementación: Welford online para baselines, running counters para todo lo demás,
promoción automática de `data_maturity` al cruzar thresholds (20, 50, 30 días).

**Beats:** después de actualizar layer 1, corre los 7 beats y reescribe
`observations` (idempotente, no acumula).

**Commitments:** después del incremental, corre `testCommitments(newTx)`. Si
hay pass/fail, agrega Observation al beat `commitment`.

### Trigger #3 — Batch semanal (failsafe)

`@Cron('0 3 * * 0')` — domingo 03:00 CLT. Para cada user activo:

1. Cargar todas las txs de los últimos 90 días
2. Recomputar layer 1 desde cero (corrige drift de Welford)
3. Correr beats sobre layer 1 fresco
4. Si pasaron 7+ días desde último diary, regenerar layer 3
5. Upsert `user_insights` + archivar a `user_insights_history`

Lock: `SETNX insights:batch:{YYYY-MM-DD}` TTL 1h.

### Trigger #4 — On-demand

```
POST /internal/insights/recompute
  Authorization: Bearer <service-token>
  body: { userId: uuid, forceLayer3?: boolean }
```

Rate limit 3/hora/user. Usos: admin manual, "re-analizá mis datos" desde UI, Gus
detecta inconsistencia.

### ~~Trigger #1~~ — Eliminado

No hay pull histórico inicial sin Fintoc. El user arranca con `data_maturity='empty'`
y madura gradualmente.

---

## Onboarding seed (opcional)

Si el user declara budgets en onboarding (`spending_expectations`), usar esos
montos como **proxy initial** para que Gus tenga algo con qué trabajar el día 1:

```typescript
// onboarding.service.ts, paso final
const proxy = buildProxyInsights({
  budgetDaily, budgetWeekly, budgetMonthly,
  declaredCategories,
});
await insightsWriter.upsert(userId, {
  ...proxy,
  data_maturity: 'empty',
  source: 'onboarding_proxy',
  has_sufficient_data: false,
});
```

Sin números reales, sin top categorías reales. Solo el "yo declarado" del user.
Cuando llega la primera tx real, el incremental empieza a sobrescribir esos valores
con datos medidos.

---

## Cómo lo usa el bot

### Escenario 1 — Reactive (turn-time)

```
User: "gasté 35 lucas en zapatillas"

UserContextService.getContext(userId)
  └─ ya cargaba (users, prefs, categories, accounts, ...)
  └─ AGREGAR: JOIN user_insights ui ON ui.user_id = u.id

systemPrompt recibe:
  - tone (de user_prefs.bot_tone)
  - daily_spend_dist (p25/p50/p75/p90/p95)
  - tx_amount_dist
  - category_profile[ropa] (share, freq, avg, trend)
  - budget_state[ropa]
  - observations: top 5 con texto en el tono del user
  - active_commitments: las relevantes

register_expense.fn.ts:
  1. INSERT tx (como hoy)
  2. updateIncremental → reescribe observations
  3. testCommitments(newTx) → posibles fails
  4. Construye reactive_context para devolver al LLM:
     {
       tx_percentile_in_amount: 92,
       category_percentile: 85,
       budget_status: { ... },
       observations_triggered: [
         { kind: 'commitment_broken', text: { ... }, importance: 92 }
       ]
     }

Gemini compone respuesta leyendo observations y reactive_context.
```

### Escenario 2 — Proactive (reporte nocturno)

`@Cron('0 21 * * *')` para users con `notification_level != 'none'` y
`has_sufficient_data = true`.

**Decisión cerrada (#3):** template fijo + comentario corto de Gemini al final.

Mensaje compuesto por `ReportSenderService`:

```
Sábado 21:00, tono strict, user mature:

  Semana cerrada.
  - Gastaste $187k. Tu promedio semanal es $164k (+14%).
  - Top: Comida $54k, Transporte $38k, Ropa $35k.
  - Tu compromiso "menos delivery" tuvo 2 tropiezos esta semana
    (martes y viernes, $22k total).
  - Vas 8 días seguidos registrando — racha personal.

  Ojo con Ropa: viene subiendo 3 semanas seguidas.
```

Las 4 primeras líneas son template + slots desde `user_insights`. La última es
comentario Gemini sobre la observation top.

### Escenario 3 — On-demand (tool nueva)

`get_user_insights(question?)` — el LLM la llama cuando user pregunta "cómo voy",
"resumen", "muéstrame mis patrones", etc.

Devuelve subset "público" de `user_insights` (sin `category_baselines` que es infra
interna): current_month, monthly_trajectory, top observations, money_diary.

---

## Fases

| Fase | Scope | Riesgo | Tiempo |
|---|---|---|---|
| **F0** | Limpieza prompt actual: drop bloque MOOD, sustitución `{mood}`, `intensity` del DTO. Migration: drop `personality_snapshot`, add `user_prefs.bot_tone` | Bajo | 1-2h |
| **F1** | Migration tablas + Layer 1 (distribuciones, fingerprint, ritmos, estado actual, anclas) + writer + reader | Medio | 2d |
| **F2** | Triggers incremental + batch + on-demand sobre layer 1 | Medio | 1d |
| **F3** | Layer 2: los 7 beats + observation-templates en 4 tonos + ranker + dedup | Alto | 2d |
| **F4** | Commitments: tabla + tool `track_commitment` + evaluator + commitment-beat | Alto | 1.5d |
| **F5** | Layer 3: money_diary generator + plantillas | Medio | 1d |
| **F6** | Prompt rewrite: ángulos por tono + regla de cómo leer observations y commitments. Quitar excepción del toxic. Rebalancear emojis | Medio | 4-6h |
| **F7** | Reportes proactivos daily/weekly/monthly: cron + ReportSender + plantillas | Medio | 1.5d |
| **F8** | Tool `get_user_insights()` + declaration + router | Bajo | 0.5d |

**Total: ~10-11 días.**

### Distribución en PRs

- **PR 1:** F0 + F1 — limpieza + schema + layer 1 + IO
- **PR 2:** F2 + F3 — triggers + beats (es el corazón, sale junto)
- **PR 3:** F4 — commitments (autocontenido, alto valor)
- **PR 4:** F5 + F8 — diary + tool on-demand
- **PR 5:** F6 + F7 — prompt rewrite + reportes proactivos

F0+F1+F2+F6 ya entrega un bot meaningfully mejor. F3+F4 es lo "nuevo".
F5+F7 es premium.

---

## Decisiones cerradas

| # | Decisión | Resolución | Razón |
|---|---|---|---|
| 1 | ¿Dónde vive `tone`? | `user_prefs.bot_tone`, drop `personality_snapshot` | Es preferencia, no snapshot. Tabla con un solo campo no se justifica. |
| 2 | Tonos: ¿4 o 5? | **4: neutral, friendly, strict, toxic** | Motivational se solapa con friendly. Menos tonos = más diferenciación real. Revisable si hay objeción fundamentada. |
| 3 | Reportes: ¿Gemini full o template? | **Template + comentario Gemini al final** | Empieza barato y consistente. Subir a Gemini-full para strict/toxic si se siente plano. |
| 4 | Threshold `has_sufficient_data` | **20 txs** | Suficiente para top-categories estables. Si se ve drift en baselines, subimos. |
| 5 | `user_insights_history` en MVP | **Sí** | Snapshots casi gratis. Abre "evolución 6 meses" sin migración futura. |
| 6 | Columnas `is_internal_transfer` + `paired_transaction_id` | **Verificar y agregar en F1 si no existen** | Preparación para futuro provider bancario. Stub en `transfer-detector.ts` siempre devuelve false. |
| 7 | Observations: pre-render o LLM-render | **Pre-render por template en 4 tonos, LLM puede reescribir en turn** | Costo cero en hot path + anti-alucinación + consistencia. |
| 8 | Commitments en MVP | **Sí (F4)** | Es la pieza más diferenciadora. Sacarla deja el plan equivalente a una app de finanzas más. |

---

## Integración con otros planes

### `PLAN_GUS_PROACTIVO.md`

- **Fase 1 (nightly summary):** desaparece el SQL inline. El cron lee
  `user_insights.observations` + `current_month` + `money_diary` y compone con
  template. Costo: ~5ms por user vs SQL agregado de ~50ms.
- **Fase 2 (anomaly detector):** usa `category_baselines` y `daily_spend_dist`
  directamente. Threshold ahora es percentil (>p95) en vez de stddev arbitrario.
- **Fase 4 (subscription detector):** sigue como query SQL 25-35d separada.
  Confirmed subscriptions aparecen en `category_profile` con peso correcto.

### `PLAN_MERCHANT_RESOLVER.md`

L1 pausado (sin Fintoc). L2 activo: cuando merchants canónicos estén disponibles,
`category_profile` agrupa por `merchant_id` mejor (sub-fingerprint por
merchant dentro de cada categoría).

### `PLAN_ACCOUNT_TRANSFERS.md` (futuro)

Engine ya filtra `is_internal_transfer = false` en todas las queries. Stub en
`transfer-detector.ts` siempre devuelve false. El día que se active, los insights
se auto-corrigen sin tocar el engine.

### Sistema de personalidad (este plan absorbe partes)

- `personality_snapshot.mood` → eliminado, no se reemplaza. El bot lee
  observations para juzgar el "humor de la conversación".
- `personality_snapshot.intensity` → eliminado, deprecated.
- `personality_snapshot.tone` → migrado a `user_prefs.bot_tone`.
- La reactividad del bot ya no necesita mood — lee escala personal de
  `user_insights` y commitments.

---

## Testing strategy

Bash integration scripts (sin unit tests, per convención del proyecto):

```
backend/scripts/insights/
├── test-layer1-empty.sh           # user con 0 tx, data_maturity='empty'
├── test-layer1-seeding.sh         # user con 5 tx, métricas básicas
├── test-layer1-mature.sh          # user con 100 tx en 60 días
├── test-incremental-update.sh     # registrar tx → verifica delta
├── test-incremental-delete.sh     # borrar tx → verifica reversa
├── test-batch-corrects-drift.sh   # seed Welford-skewed → batch → recompute correcto
├── test-on-demand-rate-limit.sh   # 4 calls/hora → 4ta falla
├── test-beat-magnitude.sh         # tx en p95 → observation correcta
├── test-beat-commitment-fail.sh   # commit "no más X" + tx en X → fail observation
├── test-beat-commitment-pass.sh   # commit "máx $50k/sem" + tx que cumple → pass
├── test-commitments-tracking.sh   # detectar promesa → testear → status updates
├── test-diary-regeneration.sh     # batch semanal regenera diary
├── test-report-daily.sh           # cron 21:00 → mensaje compuesto correcto
├── test-report-weekly.sh
├── test-tool-get-insights.sh      # LLM llama tool → response correcta
└── test-onboarding-proxy.sh       # onboarding con budgets → proxy insights
```

Cada script:

1. Seed data vía SQL directo
2. Llamar hook/endpoint relevante
3. Query `user_insights` o `user_commitments` y verificar shape + valores
4. Verificar `bot_message_log` si aplica

---

## Riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Welford drift acumulado en incrementales | Media | Batch semanal corrige. Monitorear delta entre incremental y batch; >5% → alertar |
| Commitments detectados con falso positivo (LLM cree que es promesa cuando no) | Alta | Status `dismissed` accesible vía mensaje "olvida eso". Cap de 5 active commitments/user. Confirmación opcional en turn de creación |
| Commitments quedan eternos | Media | Default `expires_at = detected_at + 30d`. Cron diario expira los vencidos |
| Observations repetitivas (bot las cita varias veces seguidas) | Media | `last_surfaced_at` + cooldown 24h por kind. Decay de importance al usar |
| Pre-render en 4 tonos = 4x el costo de template | Baja | Templates son strings con slots, costo trivial. Solo 15 observations × 4 tonos = 60 strings/user |
| Money diary suena genérico ("eres alguien que gasta en X") | Media | Templates por archetype + concentration + maturity. ≥10 variantes por slot |
| `track_commitment` mal usado por el LLM (lo llama para todo) | Media | Description estricta en function declaration + ejemplos en system prompt + monitoreo en bot_message_log |
| Transferencias contaminan métricas pre-fix de transfers | Alta | Esperado. Documentar en reporte: "incluye transferencias entre cuentas si las registraste". Filtros listos día 1 de PLAN_ACCOUNT_TRANSFERS |
| Performance: 7 beats × 1000 users en cron domingo | Media | Beats son JS puro sobre arrays, ~50ms por user. 1000 users = 50s. OK |
| Schema change futuro a `observations`/`category_profile` | Media | `schema_version` int. Migrations idempotentes con DEFAULT |

---

## Criterio de done

- **F0-F1:** migration corre, layer 1 produce output correcto sobre fixture de 100 txs
- **F2:** incremental + batch + on-demand verificables con bash integration
- **F3:** los 7 beats producen observations correctas en fixtures dedicados
- **F4:** commitments se detectan, evalúan y trackean correctamente
- **F5:** diary se regenera semanal con plantillas variantes
- **F6:** prompt nuevo en prod, smoke tests verifican reactividad correcta
- **F7:** los 3 reportes corren en prod, formato verificado
- **F8:** tool callable desde LLM, response correcta
- **Métricas baseline capturadas:** % de turns donde bot cita observation, %
  donde cita commitment, drift incremental vs batch, tamaño promedio de
  `observations`, distribución de `data_maturity` en user base

---

## Dependencias futuras

- **`PLAN_ACCOUNT_TRANSFERS.md`** — bloqueante para insights 100% limpios. Sin él,
  transferencias entre cuentas propias del user contaminan métricas
- **`PLAN_MERCHANT_RESOLVER.md` L2** — mejora granularidad del `category_profile`
  agrupando por merchant canónico
- **`PLAN_GUS_PROACTIVO.md`** — consumidor directo de layers 2 y 3

---

## Log de cambios

- `2026-04-21` — Documento inicial basado en Fintoc (Sebastián + Claude)
- `2026-05-18` — Refactor mayor: motor narrativo + commitments + 3 capas. Fusión
  con sistema de personalidad. Drop de toda la maquinaria Fintoc. Versión
  anterior queda en historial git
