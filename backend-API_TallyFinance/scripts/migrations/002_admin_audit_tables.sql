-- Migration: Bot Message Log
-- Date: 2025-01-29
-- Description: Creates bot_message_log for chat debugging and AI flow inspection

-- ============================================================================
-- Create bot_message_log table
-- ============================================================================
-- Stores messages to recreate chat flow and debug AI decisions

CREATE TABLE IF NOT EXISTS public.bot_message_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  channel VARCHAR(20), -- telegram, whatsapp, test

  -- The conversation
  user_message TEXT NOT NULL,
  bot_response TEXT,

  -- Handler used
  tool_name VARCHAR(50), -- register_transaction, ask_balance, greeting, etc.

  -- AI Debug (full JSON for detailed inspection)
  phase_a_debug JSONB, -- Full Phase A: response_type, tool_call, clarification, etc.
  phase_b_debug JSONB, -- Full Phase B: final_message, new_summary, did_nudge, etc.

  -- Errors (when things go wrong)
  error TEXT, -- Error message if something failed

  -- When
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bot_message_log_user_id ON public.bot_message_log(user_id);
CREATE INDEX IF NOT EXISTS idx_bot_message_log_created_at ON public.bot_message_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_message_log_tool_name ON public.bot_message_log(tool_name);
CREATE INDEX IF NOT EXISTS idx_bot_message_log_has_error ON public.bot_message_log(created_at DESC) WHERE error IS NOT NULL;

COMMENT ON TABLE public.bot_message_log IS
'Simple log of bot conversations for debugging.
Use phase_a_debug and phase_b_debug to see full AI decision flow.';

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

ALTER TABLE public.bot_message_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bot_message_log_service_role ON public.bot_message_log;

CREATE POLICY bot_message_log_service_role ON public.bot_message_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);
