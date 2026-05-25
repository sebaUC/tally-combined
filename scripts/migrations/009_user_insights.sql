-- ============================================================
-- Migration 009 — User Insights + Commitments + tone migration
-- ============================================================
-- Fecha: 2026-05-18
-- Contexto: PR 1 del refactor PLAN_USER_INSIGHTS.md
--   - Fusiona insights con personality (mata mood + intensity)
--   - Migra tone de personality_snapshot a user_prefs.bot_tone
--   - Crea las 3 tablas del motor narrativo
--   - Verifica columnas de transferencias en transactions (futuro provider)
--
-- IMPORTANTE — Ejecutar en orden, dentro del mismo BEGIN/COMMIT.
-- Backup de personality_snapshot antes de correr (la tabla se elimina).
--
-- Pre-flight check (correr manualmente antes):
--   SELECT count(*) FROM personality_snapshot;
--   SELECT count(*) FROM user_prefs;
--   -- Verificar columnas de transactions:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='transactions'
--     AND column_name IN ('is_internal_transfer','paired_transaction_id');
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- PARTE 1 — Migrar tone a user_prefs, dropear personality_snapshot
-- ------------------------------------------------------------

-- 1.1. Agregar bot_tone a user_prefs (4 tonos: decisión cerrada #2)
ALTER TABLE public.user_prefs
  ADD COLUMN IF NOT EXISTS bot_tone text NOT NULL DEFAULT 'friendly'
    CHECK (bot_tone IN ('neutral','friendly','strict','toxic'));

-- 1.2. Migrar tone existente desde personality_snapshot
-- Asume que personality_snapshot.user_id matchea user_prefs.id (que es el user_id)
--
-- Nota: ps.tone es un enum (bot_tone_enum) — castear a text antes de comparar
-- con literales para evitar que Postgres intente coercionarlos al enum.
-- Si en el futuro un enum legacy desconocido aparece, cae al ELSE.
UPDATE public.user_prefs up
SET bot_tone = CASE ps.tone::text
  WHEN 'neutral'      THEN 'neutral'
  WHEN 'friendly'     THEN 'friendly'
  WHEN 'strict'       THEN 'strict'
  WHEN 'toxic'        THEN 'toxic'
  WHEN 'motivational' THEN 'friendly'  -- legacy → mapeo
  WHEN 'serious'      THEN 'strict'    -- legacy → mapeo
  ELSE 'friendly'
END
FROM public.personality_snapshot ps
WHERE up.id = ps.user_id
  AND ps.tone IS NOT NULL;

-- 1.3. Drop personality_snapshot (mood, intensity, tone, mood_updated_at quedan eliminados)
DROP TABLE IF EXISTS public.personality_snapshot CASCADE;

-- ------------------------------------------------------------
-- PARTE 2 — Verificar/agregar columnas de transferencias en transactions
-- (Reservadas para el próximo provider bancario. Stub devuelve false.)
-- ------------------------------------------------------------

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS is_internal_transfer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paired_transaction_id bigint NULL
    REFERENCES public.transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer
  ON public.transactions(user_id, is_internal_transfer)
  WHERE is_internal_transfer = true;

-- ------------------------------------------------------------
-- PARTE 3 — user_insights (estado actual del user)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_insights (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,

  -- === IDENTIDAD (slow-changing) ===
  spender_archetype text
    CHECK (spender_archetype IN ('ant','whale','mixed','unknown')),
  primary_category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
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
    -- per cat_id: { share_pct, freq_per_week, avg_per_tx, p90_per_tx,
    --              last_tx_at, trend_30d, drift_pct }
  category_baselines jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- per cat_id: { avg, stddev, count, max } — para anomaly detector

  -- === RITMOS ===
  weekday_pattern jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- per dow (0-6): { avg_spend, tx_count, top_cats }
  day_of_month_pattern jsonb NOT NULL DEFAULT '{}'::jsonb,
  peak_day_of_week int,
  peak_week_of_month int,

  -- === ESTADO ACTUAL ===
  current_month jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_week jsonb NOT NULL DEFAULT '{}'::jsonb,
  budget_state jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- === ANCLAS HISTÓRICAS ===
  first_month jsonb,
  best_month jsonb,
  worst_month jsonb,
  monthly_trajectory jsonb,  -- últimos 6m

  -- === HECHOS DESTACABLES ===
  largest_expense jsonb,
  ant_expense_count int NOT NULL DEFAULT 0,
  ant_expense_total numeric NOT NULL DEFAULT 0,

  -- === LAYER 2: front page de observations ===
  observations jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- === LAYER 3: money diary ===
  money_diary jsonb,

  -- === FLAGS DE CAPACIDAD ===
  has_sufficient_data boolean NOT NULL DEFAULT false,
  has_temporal_patterns boolean NOT NULL DEFAULT false,
  has_anomaly_baselines boolean NOT NULL DEFAULT false,
  has_diary boolean NOT NULL DEFAULT false,

  -- === META ===
  source text NOT NULL DEFAULT 'incremental'
    CHECK (source IN ('incremental','batch_weekly','manual_recompute','onboarding_proxy')),
  tx_count_at_compute int NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  stale boolean NOT NULL DEFAULT false,
  schema_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_insights_self ON public.user_insights;
CREATE POLICY user_insights_self ON public.user_insights
  FOR SELECT USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_user_insights_stale
  ON public.user_insights(stale, computed_at) WHERE stale = true;

CREATE INDEX IF NOT EXISTS idx_user_insights_maturity
  ON public.user_insights(data_maturity)
  WHERE data_maturity != 'empty';

-- ------------------------------------------------------------
-- PARTE 4 — user_commitments (la pieza única)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  kind text NOT NULL CHECK (kind IN (
    'avoid_category',      -- "no más X"
    'cap_per_period',      -- "máximo $X por semana en Y"
    'save_target',         -- "voy a ahorrar $X para Z"
    'reduce_vs_baseline'   -- "voy a bajar mi gasto en X"
  )),
  category_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  amount numeric,
  period text CHECK (period IN ('daily','weekly','monthly')),
  target_date date,

  -- Trazabilidad (lo que permite la cita textual)
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

ALTER TABLE public.user_commitments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commitments_self ON public.user_commitments;
CREATE POLICY commitments_self ON public.user_commitments
  FOR SELECT USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_commitments_active
  ON public.user_commitments(user_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_commitments_category
  ON public.user_commitments(user_id, category_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_commitments_expires
  ON public.user_commitments(expires_at) WHERE status = 'active' AND expires_at IS NOT NULL;

-- ------------------------------------------------------------
-- PARTE 5 — user_insights_history (snapshots para trends)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_insights_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  trigger_source text NOT NULL CHECK (trigger_source IN (
    'maturity_promotion',
    'monthly_archive',
    'manual_recompute',
    'milestone'
  ))
);

ALTER TABLE public.user_insights_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS insights_history_self ON public.user_insights_history;
CREATE POLICY insights_history_self ON public.user_insights_history
  FOR SELECT USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_insights_history_user
  ON public.user_insights_history(user_id, computed_at DESC);

-- ------------------------------------------------------------
-- PARTE 6 — trigger para updated_at
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_insights_updated_at ON public.user_insights;
CREATE TRIGGER trg_user_insights_updated_at
  BEFORE UPDATE ON public.user_insights
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_user_commitments_updated_at ON public.user_commitments;
CREATE TRIGGER trg_user_commitments_updated_at
  BEFORE UPDATE ON public.user_commitments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;

-- ============================================================
-- Verificación post-migración (correr manualmente):
-- ============================================================
-- 1. Confirmar que personality_snapshot ya no existe:
--    SELECT tablename FROM pg_tables WHERE tablename = 'personality_snapshot';
--    -- Debe devolver 0 filas
--
-- 2. Confirmar que todos los users tienen bot_tone:
--    SELECT count(*) FROM user_prefs WHERE bot_tone IS NULL;
--    -- Debe ser 0
--
-- 3. Confirmar tablas nuevas:
--    SELECT tablename FROM pg_tables
--    WHERE tablename IN ('user_insights','user_commitments','user_insights_history');
--    -- Debe devolver 3 filas
--
-- 4. Confirmar columnas de transferencias:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name='transactions'
--      AND column_name IN ('is_internal_transfer','paired_transaction_id');
--    -- Debe devolver 2 filas
