import type { BotReply } from '../bot/actions/action-block';

/**
 * Every server-initiated outbound message to a user flows through the
 * Nudge module. A trigger identifies WHY the message is being sent — used
 * for observability, deduplication, and future gating policies.
 *
 * Add new literals here when implementing new trigger types (see
 * PLAN_GUS_PROACTIVO, PLAN_USER_INSIGHTS).
 */
export type NudgeTrigger =
  | 'nightly_summary'       // daily recap — PLAN_GUS_PROACTIVO F1
  | 'anomaly'               // outlier / budget breach — PLAN_GUS_PROACTIVO F2
  | 'category_assist'       // auto-categorization request — PLAN_GUS_PROACTIVO F3
  | 'subscription_detected' // recurring charge — PLAN_GUS_PROACTIVO F4
  | 'welcome_report';       // first-time insights after onboarding — PLAN_USER_INSIGHTS F4

export type NudgeSeverity = 'low' | 'medium' | 'high';

export interface NudgeSendParams {
  userId: string;
  trigger: NudgeTrigger;
  replies: BotReply[];
  /**
   * Used by future gate logic to decide defer vs skip.
   */
  severity?: NudgeSeverity;
  /**
   * When true, skip future gates (silence window, rate limit,
   * notification_level). Reserved for high-priority triggers.
   */
  bypassGates?: boolean;
}

export interface NudgeSendResult {
  sent: boolean;
  reason?: NudgeSkipReason;
}

export type NudgeSkipReason =
  | 'no_channel'
  | 'send_failed'
  | 'disabled_by_flag'
  | 'gated_by_silence'      // future
  | 'gated_by_rate_limit'   // future
  | 'gated_by_preference'   // future
  | 'empty_payload';
