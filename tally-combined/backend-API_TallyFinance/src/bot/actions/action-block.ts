import { ActionResult } from './action-result';

export type ActionStatus =
  | 'ready'
  | 'needs_info'
  | 'depends_on'
  | 'executed'
  | 'failed'
  | 'abandoned';

export type ItemType = 'action' | 'query' | 'quick' | 'direct';

export interface ActionItem {
  id: number;
  tool: string;
  type: ItemType;
  args: Record<string, any>;
  status: ActionStatus;
  missing?: string[];
  question?: string;
  dependsOn?: number;
  result?: ActionResult;
  attempts: number;
}

export interface ActionBlock {
  id: string;
  items: ActionItem[];
  createdAt: string;
  maxAttempts: number; // 2 — after this, item is abandoned
  maxItems: number;    // 3 — maximum items per block
}

export interface BotButton {
  text: string;
  callbackData: string;
  expiresIn?: number; // seconds — Telegram removes button after this
}

export interface BotReply {
  text: string;
  buttons?: BotButton[];
  parseMode?: 'HTML';
  skipSend?: boolean; // Internal flag — do not send to user (e.g. dedup markers)
}
