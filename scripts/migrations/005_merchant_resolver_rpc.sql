-- Migration: Merchant Resolver — RPC functions for Layer 1b/1c
-- Date: 2026-04-21
-- Description:
--   PostgREST does not expose pg_trgm's `%` operator or pgvector's `<=>`
--   operator directly. This migration adds two RPC functions the resolver
--   layers call via supabase.rpc():
--
--     match_merchant_trgm(query_text, threshold)
--     match_merchant_embedding(query_embedding, threshold)
--
--   Both return at most one row, the best match above the threshold.
--   SECURITY INVOKER (default): caller's RLS applies — merchants_global
--   is readable by `authenticated` per migration 004, so this works for
--   both service_role and user-scoped callers.

-- ============================================================================
-- Layer 1b — pg_trgm fuzzy similarity
-- ============================================================================

CREATE OR REPLACE FUNCTION public.match_merchant_trgm(
  query_text TEXT,
  threshold  NUMERIC DEFAULT 0.5
)
RETURNS TABLE (
  id               UUID,
  name             TEXT,
  logo_url         TEXT,
  default_category TEXT,
  similarity_score NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    m.id,
    m.name,
    m.logo_url,
    m.default_category,
    similarity(m.name, query_text)::NUMERIC AS similarity_score
  FROM public.merchants_global m
  WHERE m.name % query_text
    AND similarity(m.name, query_text) >= threshold
  ORDER BY similarity(m.name, query_text) DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.match_merchant_trgm IS
  'Returns the merchant whose name is most similar to query_text via pg_trgm, '
  'above the given threshold (default 0.5). At most one row.';

GRANT EXECUTE ON FUNCTION public.match_merchant_trgm(TEXT, NUMERIC)
  TO service_role, authenticated;

-- ============================================================================
-- Layer 1c — pgvector cosine similarity
-- ============================================================================

CREATE OR REPLACE FUNCTION public.match_merchant_embedding(
  query_embedding vector(768),
  threshold       NUMERIC DEFAULT 0.85
)
RETURNS TABLE (
  id               UUID,
  name             TEXT,
  logo_url         TEXT,
  default_category TEXT,
  similarity_score NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    m.id,
    m.name,
    m.logo_url,
    m.default_category,
    (1 - (m.embedding <=> query_embedding))::NUMERIC AS similarity_score
  FROM public.merchants_global m
  WHERE m.embedding IS NOT NULL
    AND (1 - (m.embedding <=> query_embedding)) >= threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.match_merchant_embedding IS
  'Returns the merchant whose embedding is closest (cosine) to query_embedding, '
  'above the given similarity threshold (default 0.85). At most one row.';

GRANT EXECUTE ON FUNCTION public.match_merchant_embedding(vector, NUMERIC)
  TO service_role, authenticated;

-- ============================================================================
-- Verification
-- ============================================================================
--
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('match_merchant_trgm', 'match_merchant_embedding');
--   -- expect 2 rows
