export type Channel = 'telegram' | 'whatsapp' | 'test';

export interface DomainMessage {
  channel: Channel;
  externalId: string; // chat_id (TG) o phone (WA)
  platformMessageId: string; // message_id (TG) o wamid (WA)
  text: string;
  timestamp: string; // ISO-8601
  profileHint?: { displayName?: string; username?: string };
}
