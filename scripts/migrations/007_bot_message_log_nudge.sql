-- Migration: Add nudge_trigger column to bot_message_log
-- Date: 2026-04-22
-- Description:
--   The `nudge` module sends server-initiated messages to users (first
--   consumer: the post-Fintoc-sync debug summary). Every outbound nudge is
--   logged into `bot_message_log` with `nudge_trigger` set to the originating
--   trigger ('sync_debug' | 'nightly_summary' | 'anomaly' | ...), so admin
--   queries can filter proactive vs reactive messages cleanly.
--
--   NULL for all user-initiated (reactive) rows — fully backward compatible.
--
-- Prerequisites:
--   - bot_message_log table exists (confirmed in database.types.ts).
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_bot_message_log_nudge;
--   ALTER TABLE public.bot_message_log DROP COLUMN IF EXISTS nudge_trigger;

ALTER TABLE public.bot_message_log
  ADD COLUMN IF NOT EXISTS nudge_trigger TEXT;

COMMENT ON COLUMN public.bot_message_log.nudge_trigger IS
  'Non-NULL when this row records a server-initiated outbound message. '
  'Values: sync_debug | nightly_summary | anomaly | welcome_report | '
  'category_assist | subscription_detected. NULL for reactive messages.';

-- Partial index: only indexes rows where the column is set, so admin queries
-- filtering proactive history are fast without bloating the base table.
CREATE INDEX IF NOT EXISTS idx_bot_message_log_nudge
  ON public.bot_message_log (user_id, nudge_trigger, created_at DESC)
  WHERE nudge_trigger IS NOT NULL;

-- Verification:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='bot_message_log' AND column_name='nudge_trigger';
--   -- expect 1 row
