-- ============================================================
-- Migration 008 — Drop Fintoc tables
-- ============================================================
-- Fecha: 2026-05-17
-- Contexto: Fintoc fue removido del MVP. Esta migración elimina las
--           tablas exclusivas de Fintoc.
--
-- IMPORTANTE — Ejecutar manualmente en Supabase SQL Editor SÓLO después
-- de confirmar que no se necesita rollback. Tras correr este script, los
-- datos de fintoc_links (link_tokens cifrados, account ids) y
-- fintoc_access_log (audit trail) se pierden de forma irrecuperable.
--
-- Antes de ejecutar:
--   1. Verificar en Supabase que ningún backup pendiente referencia estas tablas.
--   2. Confirmar que las API keys de Fintoc ya fueron revocadas en el
--      dashboard de Fintoc (sk_live_*, pk_live_*, webhook secret).
--   3. Tomar snapshot del schema actual desde Supabase Dashboard
--      (Settings → Database → Backups).
--
-- Lo que NO se elimina:
--   - Columnas en `transactions`: external_id, raw_description,
--     merchant_name, auto_categorized, is_internal_transfer,
--     paired_transaction_id. Estas se mantienen reservadas para el
--     próximo provider bancario. En modo manual quedan NULL/false.
--   - Tabla `merchants_global` y `user_merchant_preferences`. La capa L2
--     del merchant resolver sigue activa para aprender categorías desde
--     chat manual.
--   - Tabla `accounts` y FK `account_id` en payment_method/transactions.
--     Multi-cuenta es útil incluso sin sync automático.
-- ============================================================

BEGIN;

-- 1. Drop tabla de auditoría Fintoc
-- (registraba: link_created, link_refreshed, webhook_received, sync_run, etc.)
DROP TABLE IF EXISTS public.fintoc_access_log CASCADE;

-- 2. Drop tabla de links Fintoc
-- (almacenaba: link_token cifrado, fintoc_link_id, status, last_sync_at)
DROP TABLE IF EXISTS public.fintoc_links CASCADE;

-- 3. (Si existieran) drop tablas auxiliares
DROP TABLE IF EXISTS public.fintoc_webhook_events CASCADE;
DROP TABLE IF EXISTS public.fintoc_sync_runs CASCADE;

COMMIT;

-- Verificación post-migración (correr manualmente):
-- SELECT tablename FROM pg_tables WHERE tablename LIKE 'fintoc%';
-- Debe devolver 0 filas.
