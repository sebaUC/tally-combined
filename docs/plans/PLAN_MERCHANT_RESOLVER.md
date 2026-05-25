# Plan de Implementación — Motor de Merchant Resolver + Insights

> Documento interno · Abril 2026
> Contexto: mejorar la categorización, normalización de merchants y limpieza de nombres para gastos que llegan desde Fintoc, y agregar análisis inmediato post-onboarding.

## 1. Objetivo

Construir un pipeline que transforme el `raw_description` desordenado de Fintoc en una transacción limpia:

- **Merchant identificado y único** (`LIDER PROVIDENCIA 4521` → `Lider`)
- **Categoría correcta** según preferencia del usuario, con fallback a default global
- **Logo del merchant** para la UI
- **Nombre legible** para mostrar en cards y listas
- **Insights inmediatos** tras el primer sync de Fintoc (recurrentes, top categoría, semana pico, gastos hormiga)

Todo **retroalimentativo**: cada corrección del usuario mejora al sistema (y, en el caso de merchants, a todos los usuarios).

## 2. Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│  Fintoc movement → raw_description                          │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
         ┌─────────────────────────────────────┐
         │  LAYER 1 — Merchant Resolver        │
         │            (GLOBAL, compartido)     │
         │                                     │
         │  1a. Regex catalog (actual)         │  ~70% hits, 0 ms
         │  1b. pg_trgm fuzzy vs merchants_db  │  ~20% hits, ~10 ms
         │  1c. pgvector cosine similarity     │   ~5% hits, ~20 ms
         │  1d. LLM fallback → INSERT merchant │   ~5% hits, ~500 ms
         │                                     │    (una vez por merchant nuevo)
         │                                     │
         │  Output: merchant_id, canonical,    │
         │          logo_url, default_category │
         └──────────────────┬──────────────────┘
                            ▼
         ┌─────────────────────────────────────┐
         │  LAYER 2 — Category Personalizer    │
         │            (PER-USER, heurística)   │
         │                                     │
         │  SELECT category FROM               │
         │    user_merchant_preferences        │
         │  WHERE user_id = ? AND              │
         │        merchant_id = ?              │
         │                                     │
         │  Fallback: merchant.default_category│
         └──────────────────┬──────────────────┘
                            ▼
         ┌─────────────────────────────────────┐
         │  LAYER 3 — Insight Engine (async)   │
         │                                     │
         │  Post-sync inicial → BullMQ job     │
         │  Análisis determinista (SQL)        │
         │  LLM solo para narrativa            │
         │  → Mensaje proactivo de Gus         │
         └─────────────────────────────────────┘
```

## 3. Base de datos

### 3.1 Extensiones requeridas

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
```

### 3.2 Tabla `merchants_global`

```sql
CREATE TABLE merchants_global (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name    TEXT NOT NULL,
  aliases           TEXT[] NOT NULL DEFAULT '{}',
  default_category  TEXT,
  logo_url          TEXT,
  website           TEXT,
  country           TEXT NOT NULL DEFAULT 'CL',
  source            TEXT NOT NULL CHECK (source IN ('catalog','trgm','embedding','llm','user_edit')),
  confidence_score  NUMERIC(3,2) NOT NULL DEFAULT 0.50,
  verified          BOOLEAN NOT NULL DEFAULT false,
  verification_count INT NOT NULL DEFAULT 0,
  embedding         vector(768),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX merchants_canonical_ci ON merchants_global (LOWER(canonical_name), country);
CREATE INDEX merchants_aliases_trgm      ON merchants_global USING gin (aliases gin_trgm_ops);
CREATE INDEX merchants_canonical_trgm    ON merchants_global USING gin (canonical_name gin_trgm_ops);
CREATE INDEX merchants_embedding_hnsw    ON merchants_global USING hnsw (embedding vector_cosine_ops);
CREATE INDEX merchants_verified         ON merchants_global (verified, country);
```

**Reglas:**
- `verified=true` cuando `verification_count >= 3` (3 usuarios distintos confirmaron).
- RLS deshabilitado (tabla pública de solo-lectura para clientes; escritura solo `service_role`).
- `aliases` es array único case-insensitive gestionado desde la capa de aplicación.

### 3.3 Tabla `user_merchant_preferences`

```sql
CREATE TABLE user_merchant_preferences (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_id  UUID NOT NULL REFERENCES merchants_global(id) ON DELETE CASCADE,
  category_id  UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  times_used   INT NOT NULL DEFAULT 1,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, merchant_id)
);

CREATE INDEX user_merchant_prefs_user ON user_merchant_preferences (user_id, last_used_at DESC);
```

**RLS:** `user_id = auth.uid()` para SELECT; escritura solo `service_role`.

### 3.4 Extensiones en `transactions`

Ya existen (Fintoc integration): `external_id`, `raw_description`, `merchant_name`, `auto_categorized`.

Agregar:

```sql
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES merchants_global(id),
  ADD COLUMN IF NOT EXISTS merchant_logo_url TEXT,
  ADD COLUMN IF NOT EXISTS resolver_source TEXT
    CHECK (resolver_source IN ('catalog','trgm','embedding','llm','user_edit','none'));

CREATE INDEX transactions_merchant ON transactions (merchant_id) WHERE merchant_id IS NOT NULL;
```

### 3.5 Migración

Archivo: `backend/scripts/migrations/003_merchant_resolver.sql`

## 4. Código — estructura y servicios

### 4.1 Nuevo módulo `backend/src/merchants/`

```
merchants/
├── merchants.module.ts
├── merchant-resolver.service.ts         # Orquestador de las 4 capas
├── merchants-repository.ts              # DB ops sobre merchants_global
├── merchant-preferences.service.ts      # Lookup/upsert en user_merchant_preferences
├── resolvers/
│   ├── catalog-resolver.ts              # Layer 1a — migrar MERCHANT_CATALOG existente
│   ├── trgm-resolver.ts                 # Layer 1b — pg_trgm query
│   ├── embedding-resolver.ts            # Layer 1c — pgvector query
│   └── llm-resolver.ts                  # Layer 1d — Gemini + insert
├── logos/
│   ├── brandfetch.client.ts             # HTTP client con rate limit
│   └── logo-cache.service.ts            # Cache en Supabase Storage
├── contracts/
│   └── merchant-resolver.types.ts       # ResolverInput, ResolverOutput
└── tests/
    └── *.integration.test.ts
```

### 4.2 Contrato del resolver

```typescript
interface ResolverInput {
  rawDescription: string;
  amount: number;
  currency: string;
  country?: string;
}

interface ResolverOutput {
  merchantId: string | null;
  canonicalName: string;
  logoUrl: string | null;
  defaultCategory: string | null;
  confidence: number;            // 0.0 - 1.0
  source: 'catalog' | 'trgm' | 'embedding' | 'llm' | 'none';
  latencyMs: number;
}
```

### 4.3 Integración con Fintoc

Modificar `backend/src/fintoc/services/fintoc-sync.service.ts` → `movementToInsertRow()`:

```typescript
// Antes: normalizeTransactionFields() in-process
// Después:
const resolved = await this.merchantResolver.resolve({
  rawDescription: movement.description,
  amount: movement.amount,
  currency: movement.currency,
});

const category = await this.merchantPrefs.getCategoryFor(
  account.user_id,
  resolved.merchantId,
) ?? resolved.defaultCategory;
```

### 4.4 Integración con V3 functions

`register-expense.fn.ts` y `edit-transaction.fn.ts`:

- Al registrar/editar, llamar a `merchantResolver.resolve()` con el texto del usuario.
- Si el user cambia la categoría → `merchantPrefs.upsert(user_id, merchant_id, category_id)`.
- Si el user renombra el merchant → `merchantsRepo.addAlias(merchant_id, newName)` (si lo hacen ≥3 users, se marca `verified`).

## 5. Seed inicial

Archivo: `backend/scripts/seed/merchants_cl_seed.ts`

Contenido: ~500 merchants top chilenos con `canonical_name`, `aliases`, `default_category`, `website` y `logo_url`.

**Fuentes:**
- Migrar el `MERCHANT_CATALOG` actual de `transaction-normalizer.ts`.
- Complementar con top merchants por volumen: Falabella, Paris, Ripley, Copec, Shell, Enel, VTR, GTD, Banco Estado, Banco de Chile, Santander, BCI, SII, etc.
- Scraping ético de Wikipedia CL y Google Maps (categorías de negocios).

**Ejecutar con:** `npm run seed:merchants`

## 6. Logos — pipeline

1. Al insertar un merchant nuevo, job BullMQ `fetch-logo` con `merchant_id`.
2. Prioridad:
   - Si `website` conocido → `https://logo.clearbit.com/{domain}` o Brandfetch.
   - Si no, buscar por `canonical_name` en Brandfetch Search API.
   - Si falla → `logo_url = null` (frontend usa fallback emoji).
3. Logo descargado → `logos/{merchant_id}.png` en Supabase Storage.
4. `merchants_global.logo_url` apunta a la URL pública de Supabase Storage (no al CDN externo).

**Motivo:** Brandfetch/Clearbit pueden cambiar URLs o cortar free tier. Tener el archivo controlado evita refactorear después.

## 7. Layer 3 — Insights post-onboarding

### 7.1 Trigger

En `fintoc-link.service.ts`, al completar `/exchange` exitoso:

```typescript
await this.insightsQueue.add('initial-analysis', {
  userId,
  triggeredBy: 'fintoc_exchange',
});
```

### 7.2 Job `initial-analysis.job.ts`

```typescript
async run({ userId }: { userId: string }) {
  // 1. Cargar últimas 90 días de tx
  const txs = await this.loadTransactions(userId, 90);
  if (txs.length < 20) return; // no tiene data suficiente

  // 2. Análisis determinista (SQL / in-memory)
  const stats = {
    totalSpent: sumExpenses(txs),
    totalIncome: sumIncome(txs),
    topCategory: topBy(txs, 'category', 'amount'),
    peakWeek: topBy(txs, 'isoWeek', 'amount'),
    avgDaily: sumExpenses(txs) / daysSpan(txs),
    recurring: detectRecurring(txs),          // merchants con ≥3 occur, CV<0.2, cadencia 28-35 días
    antExpenses: countAnts(txs, 5000),        // < $5.000 CLP
  };

  // 3. Narrative con Gemini (con tono del user)
  const narrative = await this.gemini.generateInsightNarrative(stats, userContext);

  // 4. Insertar como mensaje proactivo
  await this.botMessageLog.insertProactiveMessage(userId, narrative);
  await this.pushToChannels(userId, narrative); // Telegram/WhatsApp

  // 5. Cachear stats en Redis (7 días) para que Gus los consulte
  await this.redis.setex(`insights:initial:${userId}`, 604800, JSON.stringify(stats));
}
```

### 7.3 Detección de recurrentes (SQL)

```sql
WITH ordered AS (
  SELECT
    merchant_id,
    amount,
    posted_at,
    LAG(posted_at) OVER (PARTITION BY merchant_id ORDER BY posted_at) AS prev_date
  FROM transactions
  WHERE user_id = $1
    AND merchant_id IS NOT NULL
    AND posted_at > NOW() - INTERVAL '90 days'
    AND type = 'expense'
),
stats AS (
  SELECT
    merchant_id,
    COUNT(*)                              AS occurrences,
    AVG(amount)                           AS avg_amount,
    STDDEV(amount) / NULLIF(AVG(amount),0) AS coef_variation,
    AVG(EXTRACT(EPOCH FROM (posted_at - prev_date)) / 86400) AS avg_cadence_days
  FROM ordered
  WHERE prev_date IS NOT NULL
  GROUP BY merchant_id
)
SELECT
  m.canonical_name,
  s.occurrences,
  s.avg_amount,
  s.avg_cadence_days
FROM stats s
JOIN merchants_global m ON m.id = s.merchant_id
WHERE s.occurrences >= 3
  AND s.coef_variation < 0.2
  AND s.avg_cadence_days BETWEEN 25 AND 35; -- mensual
```

### 7.4 Ejemplo de narrativa generada

> Revisé tus últimos 3 meses. Gastaste $1.240.000, principalmente en **Alimentación** ($320k). Detecté **3 suscripciones mensuales**: Netflix, Spotify y Smart Fit ($35k/mes). La última semana de marzo fue la más cara ($180k). Desde ahora tus gastos se cargan solos — sigue así.

## 8. Feedback loop

### 8.1 Cuando el usuario edita una transacción

En `edit-transaction.fn.ts` y en la API REST `/api/users/transactions/:id`:

```typescript
// Si cambió la categoría
if (newCategoryId !== oldCategoryId && tx.merchant_id) {
  await merchantPrefs.upsert(userId, tx.merchant_id, newCategoryId);
}

// Si cambió el merchant_name (renombró)
if (newMerchantName && newMerchantName !== tx.merchant_name) {
  await merchantsRepo.proposeAlias(tx.merchant_id, newMerchantName);
  // Si ≥3 users distintos proponen el mismo alias → se agrega al array
}
```

### 8.2 Admin review queue

Endpoint admin: `GET /admin/merchants/pending` — lista merchants `source='llm' AND verified=false` para revisión manual. Admin puede:

- Confirmar → `verified=true`, `verification_count=10` (manual override)
- Merge con otro merchant → mueve aliases y transactions al `merchant_id` canónico
- Rechazar → elimina el merchant

## 9. Métricas y observabilidad

### 9.1 Tabla `merchant_resolver_metrics` (append-only)

```sql
CREATE TABLE merchant_resolver_metrics (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source      TEXT NOT NULL,       -- catalog/trgm/embedding/llm/none
  latency_ms  INT NOT NULL,
  confidence  NUMERIC(3,2),
  matched     BOOLEAN NOT NULL,
  user_id     UUID                 -- opcional, para debug
);
```

Insertar fire-and-forget en cada `resolve()`.

### 9.2 Dashboard admin

Nuevo endpoint: `GET /admin/merchants/stats?window=7d`

Retorna:
- Hit rate por capa (% catalog / trgm / embedding / llm / none)
- Latencia p50, p95, p99 por capa
- Costo LLM estimado del período
- Top 20 merchants creados por LLM (ordenados por uso)
- Merchants pending verification count

## 10. Fases y entregables

### Fase 1 — Fundación (1.5 semanas)

- [ ] Migration `003_merchant_resolver.sql` (tablas + índices + extensiones)
- [ ] Seed de ~500 merchants CL + logos iniciales
- [ ] Módulo `merchants/` con `MerchantResolverService` orquestando las 4 capas
- [ ] Integración en `FintocSyncService`
- [ ] Tests de integración con fixtures de raw_descriptions reales de Fintoc
- [ ] Métricas tabla + fire-and-forget logging

**Criterio de aceptación:** Sync de Fintoc llena `merchant_id`, `merchant_logo_url`, `resolver_source` en todas las nuevas transactions.

### Fase 2 — Logos (0.5 semana)

- [ ] Cliente Brandfetch/Clearbit
- [ ] Job BullMQ `fetch-logo`
- [ ] Cache en Supabase Storage
- [ ] Frontend: componente `MerchantLogo` con fallback emoji

**Criterio de aceptación:** 80% de los merchants seedeados tienen logo válido.

### Fase 3 — Feedback loop (1 semana)

- [ ] Upsert en `user_merchant_preferences` al editar categoría
- [ ] `proposeAlias` al editar merchant_name
- [ ] Endpoints admin para verificación/merge
- [ ] Layer 2 activo en V3 functions

**Criterio de aceptación:** al corregir una categoría, la siguiente tx del mismo merchant propone la corregida.

### Fase 4 — Insight post-onboarding (1 semana)

- [ ] BullMQ worker + `initial-analysis.job.ts`
- [ ] Trigger post-`/exchange`
- [ ] Narrative Gemini con tono del user
- [ ] Push a Telegram/WhatsApp como mensaje proactivo de Gus
- [ ] Cache Redis 7 días para consulta de Gus

**Criterio de aceptación:** al conectar Fintoc, el user recibe el mensaje de insight en ≤60s.

### Fase 5 — Observabilidad y tuning (ongoing)

- [ ] Dashboard admin de métricas
- [ ] Admin queue de merchants pending
- [ ] Tuning de thresholds pg_trgm / pgvector según data real
- [ ] Expansión del seed con merchants del long tail que aparezcan

## 11. Variables de entorno nuevas

```bash
# Brandfetch
BRANDFETCH_API_KEY=bf_...
BRANDFETCH_RATE_LIMIT_PER_MIN=100

# Resolver thresholds (con defaults en código)
RESOLVER_TRGM_THRESHOLD=0.70
RESOLVER_EMBEDDING_THRESHOLD=0.85
RESOLVER_LLM_BATCH_SIZE=20

# BullMQ
REDIS_URL=redis://...  # ya existe
INSIGHTS_QUEUE_CONCURRENCY=5
```

## 12. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Latencia de Gemini en sync inicial (3 meses = 300-500 tx, 5% → LLM) | Batching de 20 raw_descriptions por prompt + inserción optimista con refinamiento async |
| Brandfetch corta free tier | Logos cacheados en Supabase Storage; fallback emoji en frontend |
| `merchants_global` con data sucia del LLM (ej. alucinaciones) | Todo merchant con `source='llm'` nace `verified=false` y requiere ≥3 corroboraciones antes de verificarse |
| Usuarios creando aliases maliciosos | `proposeAlias` requiere ≥3 users distintos; admin queue visible para review |
| pgvector lento en tablas grandes | Índice HNSW (no IVFFlat) + filtro previo por country + monitoreo p95 |
| Merchants ambiguos (dos negocios con mismo nombre) | `country` en el índice único; si aparece colisión dentro del mismo país, admin merge manual |

## 13. Fuera de alcance (para más adelante)

- Categorización per-user con ML real (actualmente se resuelve con lookup determinista)
- Detección de anomalías / fraude
- Weekly/monthly insights recurrentes (tipo Money Assistant de Copilot)
- Sugerencias de rebalanceo de presupuesto
- Soporte multi-país (hoy hardcodeado a CL)

## 14. Referencias

- Integración Fintoc actual: `docs/FINTOC_INTEGRATION.md`
- Normalizador actual (migrar): `backend/src/bot/v3/functions/shared/transaction-normalizer.ts`
- Sync Fintoc actual: `backend/src/fintoc/services/fintoc-sync.service.ts`
- Supabase pgvector: https://supabase.com/docs/guides/ai/vector-columns
- Brandfetch API: https://docs.brandfetch.com/
