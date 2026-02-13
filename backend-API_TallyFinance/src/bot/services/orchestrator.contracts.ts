import { ToolSchema } from '../tools/tool-schemas';
import { ActionResult } from '../actions/action-result';

export interface AiUserContextPayload {
  user_id: string;
  personality: {
    tone: string | null;
    intensity: number | null;
    mood: string | null;
  } | null;
  prefs: {
    notification_level: string | null;
    unified_balance: boolean | null;
  } | null;
  active_budget: {
    period: string | null;
    amount: number | null;
    spent?: number | null;
  } | null;
  goals_summary: string[];
}

// ============ Pending Slot-Fill State ============

export interface PendingSlotContext {
  tool: string;
  collected_args: Record<string, unknown>;
  missing_args: string[];
  asked_at: string; // ISO timestamp
}

// ============ Conversation History ============

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ============ Phase A ============

export interface PhaseARequest {
  phase: 'A';
  user_id?: string;
  user_text: string;
  user_context: AiUserContextPayload;
  tools: ToolSchema[];
  // NEW: Pending slot-fill context for multi-turn completion
  pending?: PendingSlotContext | null;
  // NEW: Available categories for matching
  available_categories?: string[];
  // Tier 1: Conversation history (last N exchanges)
  conversation_history?: ConversationMessage[];
}

export type PhaseAResponseType = 'tool_call' | 'clarification' | 'direct_reply';

export interface ToolCall {
  name: string;
  args: Record<string, any>;
}

export interface PhaseAResponse {
  phase: 'A';
  response_type: PhaseAResponseType;
  tool_call?: ToolCall;
  clarification?: string;
  direct_reply?: string;
}

// ============ Phase B ============

export interface UserMetrics {
  tx_streak_days: number;
  week_tx_count: number;
  budget_percent?: number | null; // spent/amount (0.0-1.0+)
}

export interface UserStyle {
  uses_lucas: boolean;
  uses_chilenismos: boolean;
  emoji_level: 'none' | 'light' | 'moderate';
  is_formal: boolean;
}

export interface RuntimeContext {
  // Conversation memory
  summary?: string | null; // Natural language recap from previous messages

  // Metrics for AI mood calculation
  metrics?: UserMetrics | null;

  // Mood hint from backend (-1, 0, +1), AI computes final mood
  mood_hint?: number | null; // -1 | 0 | 1

  // Cooldown flags (for nudge decisions)
  can_nudge: boolean;
  can_budget_warning: boolean;

  // Variability (for opening rotation)
  last_opening?: string | null;

  // User style (regex detected)
  user_style?: UserStyle | null;
}

export interface PhaseBRequest {
  phase: 'B';
  tool_name: string;
  action_result: ActionResult;
  user_context: AiUserContextPayload;
  runtime_context?: RuntimeContext | null; // NEW: Extended context
  // Tier 1: User's original text for natural continuation
  user_text?: string;
  // Tier 1: Conversation history (last N exchanges)
  conversation_history?: ConversationMessage[];
}

export type NudgeType = 'budget' | 'goal' | 'streak';

export interface PhaseBResponse {
  phase: 'B';
  final_message: string;
  // NEW: Metadata for backend to persist
  new_summary?: string | null;
  did_nudge?: boolean;
  nudge_type?: NudgeType | null;
}

// ============ Helper Functions ============

/**
 * Convert internal PendingSlot to AI-friendly PendingSlotContext.
 */
export function toPendingSlotContext(
  pending: {
    tool: string;
    collectedArgs: Record<string, unknown>;
    missingArgs: string[];
    askedAt: string;
  } | null,
): PendingSlotContext | null {
  if (!pending) return null;
  return {
    tool: pending.tool,
    collected_args: pending.collectedArgs,
    missing_args: pending.missingArgs,
    asked_at: pending.askedAt,
  };
}

// ============ Error Codes ============

export type OrchestratorErrorCode =
  | 'INVALID_PHASE'
  | 'MISSING_USER_TEXT'
  | 'MISSING_ACTION_RESULT'
  | 'LLM_ERROR'
  | 'LLM_TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'COLD_START';

export class OrchestratorError extends Error {
  constructor(
    public readonly code: OrchestratorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OrchestratorError';
  }
}
