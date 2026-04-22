import {
  Injectable,
  Logger,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { Agent } from 'https';
import { DomainMessage, MediaAttachment, MediaType } from '../contracts';
import { BotButton } from '../actions/action-block';

// Force IPv4 to avoid timeout issues in Docker
const httpsAgent = new Agent({ family: 4 });

@Injectable()
export class TelegramAdapter {
  private readonly log = new Logger(TelegramAdapter.name);
  constructor(private readonly cfg: ConfigService) {}

  fromIncoming(body: any): DomainMessage | null {
    const msg = body?.message ?? body?.edited_message ?? body?.channel_post;
    if (!msg) {
      this.log.debug('Telegram update sin mensaje procesable');
      return null;
    }

    // Accept messages with text, photo, voice, audio, or document
    const hasText = Boolean(msg.text || msg.caption);
    const hasMedia = Boolean(
      msg.photo || msg.voice || msg.audio || msg.document,
    );

    if (!hasText && !hasMedia) {
      this.log.debug('Telegram update sin contenido procesable');
      return null;
    }

    const domainMessage: DomainMessage = {
      channel: 'telegram',
      externalId: String(msg.chat?.id),
      platformMessageId: String(msg.message_id),
      text: String(msg.text ?? msg.caption ?? '').trim(),
      timestamp: new Date((msg.date ?? Date.now() / 1000) * 1000).toISOString(),
      profileHint: {
        displayName: msg.from?.first_name,
        username: msg.from?.username,
      },
    };
    this.log.debug(
      `[fromIncoming] TG message ${domainMessage.platformMessageId} text="${domainMessage.text}" hasMedia=${hasMedia}`,
    );
    return domainMessage;
  }

  /**
   * Download media from a Telegram message and attach as base64.
   * Call this after fromIncoming() to enrich the DomainMessage.
   */
  async downloadMedia(body: any, dm: DomainMessage): Promise<void> {
    const msg = body?.message ?? body?.edited_message ?? body?.channel_post;
    if (!msg) return;

    const token = this.cfg.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) return;

    const media: MediaAttachment[] = [];

    // Photo: array of sizes, pick the largest
    if (msg.photo?.length) {
      const largest = msg.photo[msg.photo.length - 1];
      const attachment = await this.downloadTelegramFile(
        token,
        largest.file_id,
        'image',
        'image/jpeg',
      );
      if (attachment) media.push(attachment);
    }

    // Voice message (ogg/opus)
    if (msg.voice) {
      const attachment = await this.downloadTelegramFile(
        token,
        msg.voice.file_id,
        'audio',
        msg.voice.mime_type || 'audio/ogg',
      );
      if (attachment) media.push(attachment);
    }

    // Audio file (mp3, etc.)
    if (msg.audio) {
      const attachment = await this.downloadTelegramFile(
        token,
        msg.audio.file_id,
        'audio',
        msg.audio.mime_type || 'audio/mpeg',
      );
      if (attachment) media.push(attachment);
    }

    // Document (PDF, etc.)
    if (msg.document) {
      const mime = msg.document.mime_type || 'application/octet-stream';
      const attachment = await this.downloadTelegramFile(
        token,
        msg.document.file_id,
        'document',
        mime,
        msg.document.file_name,
      );
      if (attachment) media.push(attachment);
    }

    if (media.length) {
      dm.media = media;
      this.log.log(
        `[downloadMedia] Downloaded ${media.length} attachment(s): ${media.map((m) => m.type).join(', ')}`,
      );
    }
  }

  private async downloadTelegramFile(
    token: string,
    fileId: string,
    type: MediaType,
    mimeType: string,
    fileName?: string,
  ): Promise<MediaAttachment | null> {
    try {
      // Step 1: Get file path from Telegram
      const fileInfo = await axios.get(
        `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`,
        { timeout: 10_000, httpsAgent },
      );
      const filePath = fileInfo.data?.result?.file_path;
      if (!filePath) return null;

      // Step 2: Download file bytes
      const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
      const response = await axios.get(fileUrl, {
        responseType: 'arraybuffer',
        timeout: 30_000,
        httpsAgent,
      });

      const base64 = Buffer.from(response.data).toString('base64');

      // Limit: skip files > 10MB
      if (base64.length > 10 * 1024 * 1024 * 1.37) {
        this.log.warn(
          `[downloadTelegramFile] File too large, skipping: ${filePath}`,
        );
        return null;
      }

      return { type, mimeType, data: base64, fileName };
    } catch (err) {
      this.log.warn(
        `[downloadTelegramFile] Failed to download ${type}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Send a message with optional inline keyboard buttons.
   * Returns the sent message_id (for later editing).
   */
  async sendReplyWithButtons(
    dm: DomainMessage,
    text: string,
    buttons: BotButton[],
    parseMode?: 'HTML',
  ): Promise<number | null> {
    const token = this.cfg.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token)
      throw new UnauthorizedException('TELEGRAM_BOT_TOKEN no configurado');

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const inlineKeyboard = [
      buttons.map((b) => ({ text: b.text, callback_data: b.callbackData })),
    ];

    const payload: any = {
      chat_id: dm.externalId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
      reply_markup: { inline_keyboard: inlineKeyboard },
    };

    try {
      const res = await axios.post(url, payload, {
        timeout: 15_000,
        httpsAgent,
      });
      const messageId: number = res.data?.result?.message_id;

      // Schedule button removal after expiresIn seconds
      const expiresIn = buttons[0]?.expiresIn;
      if (expiresIn && messageId) {
        setTimeout(() => {
          this.editMessageRemoveButtons(dm.externalId, messageId).catch(
            () => {},
          );
        }, expiresIn * 1000);
      }

      return messageId ?? null;
    } catch (err) {
      this.log.warn(`[sendReplyWithButtons] Failed: ${String(err)}`);
      // Fallback: send without buttons
      await this.sendReply(dm, text, { parseMode });
      return null;
    }
  }

  /**
   * Remove inline keyboard buttons from a message (after undo/expiry).
   */
  async editMessageRemoveButtons(
    chatId: string,
    messageId: number,
  ): Promise<void> {
    const token = this.cfg.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) return;

    const url = `https://api.telegram.org/bot${token}/editMessageReplyMarkup`;
    try {
      await axios.post(
        url,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [] },
        },
        { timeout: 5_000, httpsAgent },
      );
    } catch {
      // Silently ignore — message may have already been edited or deleted
    }
  }

  /**
   * Edit the text of a message (used after undo to strikethrough).
   */
  async editMessageText(
    chatId: string,
    messageId: number,
    newText: string,
    parseMode?: 'HTML',
  ): Promise<void> {
    const token = this.cfg.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) return;

    const url = `https://api.telegram.org/bot${token}/editMessageText`;
    try {
      await axios.post(
        url,
        {
          chat_id: chatId,
          message_id: messageId,
          text: newText,
          ...(parseMode ? { parse_mode: parseMode } : {}),
          reply_markup: { inline_keyboard: [] },
        },
        { timeout: 5_000, httpsAgent },
      );
    } catch {
      // Silently ignore
    }
  }

  /**
   * Show "typing..." indicator in Telegram. Lasts ~5s.
   * Returns a stop function — call it when the reply is sent.
   * Automatically repeats every 4s so long processing stays visible.
   */
  startTyping(dm: DomainMessage): () => void {
    const chatId = dm.externalId;
    this.sendChatAction(chatId).catch(() => {});
    const interval = setInterval(() => {
      this.sendChatAction(chatId).catch(() => {});
    }, 4_000);
    return () => clearInterval(interval);
  }

  private async sendChatAction(chatId: string): Promise<void> {
    const token = this.cfg.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) return;
    try {
      await axios.post(
        `https://api.telegram.org/bot${token}/sendChatAction`,
        { chat_id: chatId, action: 'typing' },
        { timeout: 3_000, httpsAgent },
      );
    } catch {
      // Silently ignore — typing is best-effort
    }
  }

  async sendReply(
    dm: DomainMessage,
    text: string,
    opts?: { replyTo?: string; parseMode?: 'MarkdownV2' | 'HTML' },
  ) {
    const token = this.cfg.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token)
      throw new UnauthorizedException('TELEGRAM_BOT_TOKEN no configurado');

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload: any = {
      chat_id: dm.externalId,
      text,
      ...(opts?.replyTo && { reply_to_message_id: opts.replyTo }),
      ...(opts?.parseMode && { parse_mode: opts.parseMode }),
    };

    // Retry logic for network issues (especially in Docker/Colima)
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await axios.post(url, payload, { timeout: 15_000, httpsAgent });
        this.log.log(`TG message sent to ${dm.externalId}`);
        return; // Success - exit
      } catch (e) {
        const err = e as AxiosError<any>;
        const status = err.response?.status;
        const data = err.response?.data;
        lastError = err;

        this.log.warn(
          `Telegram attempt ${attempt}/${maxRetries} failed: ${err.code || err.message}`,
        );

        // If rate limited or server error, wait and retry
        if (status && (status === 429 || status >= 500)) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }

        // Network timeout - retry with backoff
        if (
          !err.response ||
          err.code === 'ETIMEDOUT' ||
          err.code === 'ECONNRESET'
        ) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }

        // Other errors - don't retry
        throw new InternalServerErrorException(
          `Telegram API error (${status}): ${data?.description ?? err.message}`,
        );
      }
    }

    // All retries failed
    this.log.error(`Telegram send failed after ${maxRetries} attempts`);
    throw new InternalServerErrorException(
      `Network error after ${maxRetries} retries: ${lastError?.message}`,
    );
  }
}
