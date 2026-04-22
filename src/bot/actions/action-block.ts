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
