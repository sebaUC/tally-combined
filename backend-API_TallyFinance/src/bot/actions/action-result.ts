export type ActionType =
  | 'none'
  | 'register_transaction'
  | 'ask_balance'
  | 'ask_budget_status'
  | 'ask_goal_status'
  | 'ask_app_info';

/**
 * Pending slot-fill state for multi-turn tool completion.
 * Returned by handlers when they need more info from the user.
 */
export interface PendingData {
  collectedArgs: Record<string, unknown>;
  missingArgs: string[];
}

export interface ActionResult {
  ok: boolean;
  action: ActionType;
  data?: Record<string, any>;
  userMessage?: string;
  errorCode?: string;
  /**
   * When userMessage is set and handler needs more info,
   * this contains what was collected so far.
   */
  pending?: PendingData;
}
