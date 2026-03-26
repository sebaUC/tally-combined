export type Channel = 'telegram' | 'whatsapp' | 'test';

export type MediaType = 'image' | 'audio' | 'document';

export interface MediaAttachment {
  type: MediaType;
  mimeType: string; // image/jpeg, audio/ogg, application/pdf
  data: string; // base64-encoded bytes
  fileName?: string; // for documents
}

export interface DomainMessage {
  channel: Channel;
  externalId: string; // chat_id (TG) o phone (WA)
  platformMessageId: string; // message_id (TG) o wamid (WA)
  text: string;
  timestamp: string; // ISO-8601
  profileHint?: { displayName?: string; username?: string };
  media?: MediaAttachment[];
}
