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
  | 'sync_debug'            // post-Fintoc-sync summary (current MVP)
  | 'nightly_summary'       // daily recap — PLAN_GUS_PROACTIVO F1
  | 'anomaly'               // outlier / budget breach — PLAN_GUS_PROACTIVO F2
  | 'category_assist'       // auto-categorization request — PLAN_GUS_PROACTIVO F3
  | 'subscription_detected' // recurring charge — PLAN_GUS_PROACTIVO F4
  | 'welcome_report';       // first-time after Fintoc exchange — PLAN_USER_INSIGHTS F4

export type NudgeSeverity = 'low' | 'medium' | 'high';

export interface NudgeSendParams {
  userId: string;
  trigger: NudgeTrigger;
  replies: BotReply[];
  /**
   * Used by future gate logic to decide defer vs skip. Today: recorded in
   * audit log, no behavioral effect.
   */
  severity?: NudgeSeverity;
  /**
   * MVP: when true, skip future gates (silence window, rate limit,
   * notification_level). `sync_debug` uses this today so the debug stream
   * is unconditional while we instrument the rest.
   */
  bypassGates?: boolean;
  /**
   * Optional link id — propagated into audit log detail for traceability.
   */
  linkId?: string | null;
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
