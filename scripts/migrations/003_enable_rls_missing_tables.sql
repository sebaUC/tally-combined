-- Migration: Enable RLS on tables exposed without row-level security
-- Date: 2026-04-20
-- Description:
--   spending_expectations and user_prefs had rowsecurity = false.
--   Any authenticated request with a valid JWT could read or mutate
--   another user's rows. This migration enables RLS and adds
--   user-scoped policies plus a service_role bypass policy for the
--   backend, which connects with the service-role key.
--
-- Schema notes (verified against code):
--   - spending_expectations matches rows by column user_id
--   - user_prefs uses id as the FK to auth.users.id (no user_id col)

-- ============================================================================
-- spending_expectations
-- ============================================================================

ALTER TABLE public.spending_expectations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spending_expectations_service_role ON public.spending_expectations;
DROP POLICY IF EXISTS spending_expectations_owner_select ON public.spending_expectations;
DROP POLICY IF EXISTS spending_expectations_owner_insert ON public.spending_expectations;
DROP POLICY IF EXISTS spending_expectations_owner_update ON public.spending_expectations;
DROP POLICY IF EXISTS spending_expectations_owner_delete ON public.spending_expectations;

CREATE POLICY spending_expectations_service_role ON public.spending_expectations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY spending_expectations_owner_select ON public.spending_expectations
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY spending_expectations_owner_insert ON public.spending_expectations
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY spending_expectations_owner_update ON public.spending_expectations
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY spending_expectations_owner_delete ON public.spending_expectations
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============================================================================
-- user_prefs
-- ============================================================================

ALTER TABLE public.user_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_prefs_service_role ON public.user_prefs;
DROP POLICY IF EXISTS user_prefs_owner_select ON public.user_prefs;
DROP POLICY IF EXISTS user_prefs_owner_insert ON public.user_prefs;
DROP POLICY IF EXISTS user_prefs_owner_update ON public.user_prefs;
DROP POLICY IF EXISTS user_prefs_owner_delete ON public.user_prefs;

CREATE POLICY user_prefs_service_role ON public.user_prefs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY user_prefs_owner_select ON public.user_prefs
  FOR SELECT TO authenticated USING (id = auth.uid());

CREATE POLICY user_prefs_owner_insert ON public.user_prefs
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

CREATE POLICY user_prefs_owner_update ON public.user_prefs
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY user_prefs_owner_delete ON public.user_prefs
  FOR DELETE TO authenticated USING (id = auth.uid());

-- ============================================================================
-- Verification query (run manually after apply):
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname = 'public'
--     AND tablename IN ('spending_expectations', 'user_prefs');
-- Both should report rowsecurity = true.
-- ============================================================================
