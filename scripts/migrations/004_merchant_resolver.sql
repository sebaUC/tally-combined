-- Migration: Merchant Resolver — Layer 1 foundation
-- Date: 2026-04-21
-- Description:
--   Creates merchants_global (system-wide merchant catalog) and
--   user_merchant_preferences (per-user category override), wires
--   transactions.merchant_id as a real FK, and adds resolver_source
--   for per-layer hit-rate metrics.
--
--   Non-destructive: no columns are dropped. transactions.merchant_name
--   stays until migration 005 after the backfill job completes.
--
-- Prerequisites:
--   - pgvector and pg_trgm available in the Supabase project (both are
--     present in free and pro tiers by default).
--   - transactions.merchant_id is expected to be UUID. If it is TEXT
--     with only NULL values (verified at migration time), it is cast
--     safely in step 4.
--
-- Verified before writing:
--   - No code path writes transactions.merchant_id (grep in backend/src).
--   - users.id and categories.id are UUID.
--   - transactions.id is BIGINT (not touched by this migration).

-- ============================================================================
-- 1. Extensions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- 2. merchants_global — system-wide merchant catalog
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.merchants_global (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  aliases           TEXT[] NOT NULL DEFAULT '{}',
  logo_url          TEXT,
  default_category  TEXT,
  embedding         vector(768),
  verified          BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.merchants_global IS
  'System-wide merchant catalog. One row per merchant in the world. '
  'Shared across all users. Written only by service_role.';

COMMENT ON COLUMN public.merchants_global.aliases IS
  'Alternate surface forms observed in raw bank descriptions '
  '(e.g. "LIDER PROVIDENCIA", "Lider Las Condes"). '
  'Matched by exact array containment (aliases @> ARRAY[$1]) in the trgm resolver.';

COMMENT ON COLUMN public.merchants_global.verified IS
  'true when a human admin or >=3 user edits have confirmed this row. '
  'LLM-generated rows start with verified=false.';

CREATE UNIQUE INDEX IF NOT EXISTS merchants_name_ci
  ON public.merchants_global (LOWER(name));

-- Fuzzy similarity on the canonical name (gin_trgm_ops requires TEXT).
CREATE INDEX IF NOT EXISTS merchants_name_trgm
  ON public.merchants_global USING gin (name gin_trgm_ops);

-- Exact array-containment lookup on aliases (aliases @> ARRAY[$1]).
-- Uses the default GIN operator class for TEXT[] (array_ops), NOT gin_trgm_ops.
CREATE INDEX IF NOT EXISTS merchants_aliases_gin
  ON public.merchants_global USING gin (aliases);

CREATE INDEX IF NOT EXISTS merchants_embedding_hnsw
  ON public.merchants_global USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.merchants_global ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS merchants_global_service_role ON public.merchants_global;
DROP POLICY IF EXISTS merchants_global_read         ON public.merchants_global;

CREATE POLICY merchants_global_service_role ON public.merchants_global
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY merchants_global_read ON public.merchants_global
  FOR SELECT TO authenticated USING (true);

-- ============================================================================
-- 3. user_merchant_preferences — per-user category override
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_merchant_preferences (
  user_id      UUID NOT NULL REFERENCES public.users(id)            ON DELETE CASCADE,
  merchant_id  UUID NOT NULL REFERENCES public.merchants_global(id) ON DELETE CASCADE,
  category_id  UUID NOT NULL REFERENCES public.categories(id)       ON DELETE CASCADE,
  times_used   INT NOT NULL DEFAULT 1,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, merchant_id)
);

COMMENT ON TABLE public.user_merchant_preferences IS
  'Per-user learned preference: which category this user applies to this merchant. '
  'Upserted every time the user confirms/edits the category of a transaction.';

CREATE INDEX IF NOT EXISTS user_merchant_prefs_user
  ON public.user_merchant_preferences (user_id, last_used_at DESC);

ALTER TABLE public.user_merchant_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_merchant_prefs_service_role ON public.user_merchant_preferences;
DROP POLICY IF EXISTS user_merchant_prefs_owner_select ON public.user_merchant_preferences;

CREATE POLICY user_merchant_prefs_service_role ON public.user_merchant_preferences
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY user_merchant_prefs_owner_select ON public.user_merchant_preferences
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ============================================================================
-- 4. transactions — wire merchant_id FK and add resolver_source
-- ============================================================================

-- 4a. If merchant_id is not UUID, cast it. Safe because no rows are non-NULL today.
DO $$
DECLARE
  current_type TEXT;
BEGIN
  SELECT data_type INTO current_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'transactions'
    AND column_name  = 'merchant_id';

  IF current_type IS NOT NULL AND current_type <> 'uuid' THEN
    EXECUTE 'ALTER TABLE public.transactions
             ALTER COLUMN merchant_id TYPE UUID USING merchant_id::uuid';
  END IF;
END $$;

-- 4b. Add FK if not present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name        = 'transactions'
      AND constraint_name   = 'transactions_merchant_id_fkey'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_merchant_id_fkey
      FOREIGN KEY (merchant_id) REFERENCES public.merchants_global(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 4c. Add resolver_source column (per-transaction metric).
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS resolver_source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name        = 'transactions'
      AND constraint_name   = 'transactions_resolver_source_check'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_resolver_source_check
      CHECK (resolver_source IN ('catalog','trgm','embedding','llm','user_edit','none'));
  END IF;
END $$;

COMMENT ON COLUMN public.transactions.resolver_source IS
  'Which resolver layer produced the merchant_id for this transaction. '
  'Used for hit-rate analytics per layer. NULL on rows created before this migration.';

-- 4d. Index on merchant_id for JOIN performance.
CREATE INDEX IF NOT EXISTS transactions_merchant
  ON public.transactions (merchant_id)
  WHERE merchant_id IS NOT NULL;

-- ============================================================================
-- 5. updated_at trigger for merchants_global
-- ============================================================================

CREATE OR REPLACE FUNCTION public.touch_merchants_global()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS merchants_global_touch ON public.merchants_global;

CREATE TRIGGER merchants_global_touch
  BEFORE UPDATE ON public.merchants_global
  FOR EACH ROW EXECUTE FUNCTION public.touch_merchants_global();

-- ============================================================================
-- 6. Verification — run these after applying
-- ============================================================================
--
-- Extensions installed:
--   SELECT extname FROM pg_extension WHERE extname IN ('vector','pg_trgm');
--   -- expect 2 rows
--
-- Tables created:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--     AND table_name IN ('merchants_global','user_merchant_preferences');
--   -- expect 2 rows
--
-- FK wired:
--   SELECT constraint_name FROM information_schema.table_constraints
--   WHERE table_name = 'transactions'
--     AND constraint_name = 'transactions_merchant_id_fkey';
--   -- expect 1 row
--
-- resolver_source column exists with CHECK:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'transactions' AND column_name = 'resolver_source';
--   -- expect 1 row
--
-- RLS active:
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE tablename IN ('merchants_global','user_merchant_preferences');
--   -- both should report rowsecurity = true
