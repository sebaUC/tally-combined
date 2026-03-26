import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DomainMessage, MediaAttachment, MediaType } from '../contracts';
import { BotButton } from '../actions/action-block';

@Injectable()
export class WhatsappAdapter {
  private readonly log = new Logger(WhatsappAdapter.name);
  constructor(private readonly cfg: ConfigService) {}

  // --- VERIFICATION (opcional dejar igual que hoy en un controller GET) ---

  fromIncoming(body: any): DomainMessage | null {
    const change = body?.entry?.[0]?.changes?.[0];
    const msg = change?.value?.messages?.[0];
    if (!msg) return null;

    // Accept text, image, audio, or document messages
    const hasText = Boolean(msg.text?.body);
    const hasMedia = Boolean(msg.image || msg.audio || msg.voice || msg.document);

    if (!hasText && !hasMedia) return null;

    const domainMessage: DomainMessage = {
      channel: 'whatsapp',
      externalId: msg.from, // phone
      platformMessageId: msg.id, // wamid
      text: msg.text?.body ?? msg.image?.caption ?? '',
      timestamp: new Date(Number(msg.timestamp) * 1000).toISOString(),
      profileHint: { displayName: change?.value?.contacts?.[0]?.profile?.name },
    };
    this.log.debug(
      `[fromIncoming] WA message ${domainMessage.platformMessageId} text="${domainMessage.text}" hasMedia=${hasMedia}`,
    );
    return domainMessage;
  }

  /**
   * Download media from a WhatsApp message and attach as base64.
   */
  async downloadMedia(body: any, dm: DomainMessage): Promise<void> {
    const change = body?.entry?.[0]?.changes?.[0];
    const msg = change?.value?.messages?.[0];
    if (!msg) return;

    const token = this.cfg.get<string>('WHATSAPP_TOKEN');
    const base = this.cfg.get<string>('WHATSAPP_GRAPH_API_BASE');
    const v = this.cfg.get<string>('WHATSAPP_GRAPH_API_VERSION');
    if (!token || !base || !v) return;

    const media: MediaAttachment[] = [];

    // Image
    if (msg.image) {
      const attachment = await this.downloadWhatsAppMedia(
        token, base, v, msg.image.id, 'image', msg.image.mime_type || 'image/jpeg',
      );
      if (attachment) media.push(attachment);
    }

    // Voice (ogg/opus)
    if (msg.voice) {
      const attachment = await this.downloadWhatsAppMedia(
        token, base, v, msg.voice.id, 'audio', msg.voice.mime_type || 'audio/ogg',
      );
      if (attachment) media.push(attachment);
    }

    // Audio
    if (msg.audio) {
      const attachment = await this.downloadWhatsAppMedia(
        token, base, v, msg.audio.id, 'audio', msg.audio.mime_type || 'audio/mpeg',
      );
      if (attachment) media.push(attachment);
    }

    // Document
    if (msg.document) {
      const attachment = await this.downloadWhatsAppMedia(
        token, base, v, msg.document.id, 'document',
        msg.document.mime_type || 'application/octet-stream',
        msg.document.filename,
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

  private async downloadWhatsAppMedia(
    token: string,
    base: string,
    version: string,
    mediaId: string,
    type: MediaType,
    mimeType: string,
    fileName?: string,
  ): Promise<MediaAttachment | null> {
    try {
      // Step 1: Get download URL
      const urlRes = await axios.get(`${base}/${version}/${mediaId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10_000,
      });
      const downloadUrl = urlRes.data?.url;
      if (!downloadUrl) return null;

      // Step 2: Download bytes
      const response = await axios.get(downloadUrl, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'arraybuffer',
        timeout: 30_000,
      });

      const base64 = Buffer.from(response.data).toString('base64');

      if (base64.length > 10 * 1024 * 1024 * 1.37) {
        this.log.warn(`[downloadWhatsAppMedia] File too large, skipping`);
        return null;
      }

      return { type, mimeType, data: base64, fileName };
    } catch (err) {
      this.log.warn(
        `[downloadWhatsAppMedia] Failed to download ${type}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** Strip HTML tags for WhatsApp (plain text only). */
  private stripHtml(text: string): string {
    return text
      .replace(/<b>(.*?)<\/b>/gi, '*$1*') // <b> → *bold* (WhatsApp)
      .replace(/<i>(.*?)<\/i>/gi, '_$1_') // <i> → _italic_
      .replace(/<[^>]*>/g, '');            // strip remaining tags
  }

  /**
   * Mark a WhatsApp message as read (shows blue double checkmarks).
   * WhatsApp Cloud API doesn't support a true typing indicator,
   * so read receipt is the closest equivalent UX signal.
   */
  async markAsRead(messageId: string, to: string): Promise<void> {
    const token = this.cfg.get<string>('WHATSAPP_TOKEN');
    const phoneNumberId = this.cfg.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const base = this.cfg.get<string>('WHATSAPP_GRAPH_API_BASE');
    const v = this.cfg.get<string>('WHATSAPP_GRAPH_API_VERSION');
    if (!token || !phoneNumberId || !base || !v) return;

    try {
      await axios.post(
        `${base}/${v}/${phoneNumberId}/messages`,
        { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          timeout: 5_000,
        },
      );
    } catch {
      // Best-effort — silently ignore
    }
  }

  async sendReply(dm: DomainMessage, text: string, opts?: { parseMode?: 'HTML' }) {
    const token = this.cfg.get<string>('WHATSAPP_TOKEN');
    const phoneNumberId = this.cfg.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const base = this.cfg.get<string>('WHATSAPP_GRAPH_API_BASE');
    const v = this.cfg.get<string>('WHATSAPP_GRAPH_API_VERSION');
    if (!token || !phoneNumberId || !base || !v)
      throw new UnauthorizedException('WA config missing');

    // WhatsApp doesn't support HTML — convert to WhatsApp markdown
    const body = opts?.parseMode === 'HTML' ? this.stripHtml(text) : text;

    const url = `${base}/${v}/${phoneNumberId}/messages`;
    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to: dm.externalId,
        type: 'text',
        text: { preview_url: false, body },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      },
    );

    this.log.log(`WA message sent to ${dm.externalId}`);
  }

  /**
   * Send WhatsApp interactive message with up to 3 buttons.
   * WhatsApp only supports plain text in buttons (no HTML/markdown).
   */
  async sendInteractiveReply(
    dm: DomainMessage,
    text: string,
    buttons: BotButton[],
  ): Promise<void> {
    const token = this.cfg.get<string>('WHATSAPP_TOKEN');
    const phoneNumberId = this.cfg.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const base = this.cfg.get<string>('WHATSAPP_GRAPH_API_BASE');
    const v = this.cfg.get<string>('WHATSAPP_GRAPH_API_VERSION');
    if (!token || !phoneNumberId || !base || !v) {
      throw new UnauthorizedException('WA config missing');
    }

    // WhatsApp max 3 buttons per message
    const waButtons = buttons.slice(0, 3).map((b, i) => ({
      type: 'reply',
      reply: {
        id: b.callbackData.substring(0, 256), // WA max 256 chars
        title: b.text.substring(0, 20),        // WA max 20 chars
      },
    }));

    const body = this.stripHtml(text);
    const url = `${base}/${v}/${phoneNumberId}/messages`;

    try {
      await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          to: dm.externalId,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: body.substring(0, 1024) }, // WA max 1024
            action: { buttons: waButtons },
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        },
      );
      this.log.log(`WA interactive message sent to ${dm.externalId}`);
    } catch (err) {
      this.log.warn(`[sendInteractiveReply] Failed, falling back to plain: ${String(err)}`);
      await this.sendReply(dm, text, { parseMode: 'HTML' });
    }
  }
}
