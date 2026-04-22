-- Migration: Merchant Resolver — word_similarity RPC for Layer 1a
-- Date: 2026-04-21
-- Description:
--   Layer 1a (CatalogResolver) hoy hace exact match (aliases @> + name ILIKE),
--   lo cual es frágil: el banco manda strings con ruido alrededor del nombre
--   (ej. "COMPRA NAC 05/04 LIDER PROVIDENCIA"). Con exact match pegaba
--   prácticamente ningún caso real de Fintoc.
--
--   Esta migración agrega `match_merchant_word_trgm`, que usa la función
--   `word_similarity` de pg_trgm. A diferencia de `similarity` (que compara
--   strings enteros y se diluye con ruido), `word_similarity` mide cuán bien
--   un string aparece COMO PALABRA dentro de otro — equivalente al
--   comportamiento del regex `\bword\b` del sistema viejo, pero respaldado
--   por el índice GIN trigram ya existente.
--
--   Ejemplos de comportamiento:
--     word_similarity('Lider', 'COMPRA NAC 05/04 LIDER PROVIDENCIA') ≈ 1.0
--     word_similarity('Lider', 'LIDEER')                            ≈ 0.71
--     word_similarity('Lider', 'Jumbo Las Condes')                  ≈ 0.14
--
--   El operador `<%` ("is contained as a word within") usa el índice GIN
--   existente sobre `name` (merchants_name_trgm de migración 004). Para
--   los aliases iteramos con `unnest` (son <5 por merchant, overhead mínimo).

CREATE OR REPLACE FUNCTION public.match_merchant_word_trgm(
  query_text TEXT,
  threshold  NUMERIC DEFAULT 0.85
)
RETURNS TABLE (
  id               UUID,
  name             TEXT,
  logo_url         TEXT,
  default_category TEXT,
  score            NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH candidates AS (
    SELECT
      m.id,
      m.name,
      m.logo_url,
      m.default_category,
      GREATEST(
        word_similarity(m.name, query_text),
        COALESCE(
          (SELECT MAX(word_similarity(a, query_text))
           FROM unnest(m.aliases) AS a),
          0
        )
      ) AS score
    FROM public.merchants_global m
    WHERE m.name <% query_text
       OR EXISTS (
         SELECT 1 FROM unnest(m.aliases) a
         WHERE a <% query_text
       )
  )
  SELECT id, name, logo_url, default_category, score::NUMERIC
  FROM candidates
  WHERE score >= threshold
  ORDER BY score DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.match_merchant_word_trgm IS
  'Returns the merchant whose name or aliases appear as a word within query_text '
  'above the given threshold (default 0.85). Uses word_similarity (pg_trgm). '
  'Replaces exact-match lookup in Layer 1a — more robust against bank noise.';

GRANT EXECUTE ON FUNCTION public.match_merchant_word_trgm(TEXT, NUMERIC)
  TO service_role, authenticated;

-- ============================================================================
-- Verification
-- ============================================================================
--
--   SELECT proname FROM pg_proc WHERE proname = 'match_merchant_word_trgm';
--   -- expect 1 row
--
--   -- Smoke test (requires at least one seeded merchant):
--   SELECT * FROM public.match_merchant_word_trgm('COMPRA NAC 05/04 LIDER PROVIDENCIA', 0.85);
--   -- expect Lider if seed ran, else 0 rows
