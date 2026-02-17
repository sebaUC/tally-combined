import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DomainMessage } from '../contracts';

@Injectable()
export class WhatsappAdapter {
  private readonly log = new Logger(WhatsappAdapter.name);
  constructor(private readonly cfg: ConfigService) {}

  // --- VERIFICATION (opcional dejar igual que hoy en un controller GET) ---

  fromIncoming(body: any): DomainMessage | null {
    const change = body?.entry?.[0]?.changes?.[0];
    const msg = change?.value?.messages?.[0];
    if (!msg?.text?.body) return null;

    const domainMessage: DomainMessage = {
      channel: 'whatsapp',
      externalId: msg.from, // phone
      platformMessageId: msg.id, // wamid
      text: msg.text.body,
      timestamp: new Date(Number(msg.timestamp) * 1000).toISOString(),
      profileHint: { displayName: change?.value?.contacts?.[0]?.profile?.name },
    };
    this.log.debug(
      `[fromIncoming] WA message ${domainMessage.platformMessageId} text="${domainMessage.text}"`,
    );
    return domainMessage;
  }

  async sendReply(dm: DomainMessage, text: string) {
    const token = this.cfg.get<string>('WHATSAPP_TOKEN');
    const phoneNumberId = this.cfg.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const base = this.cfg.get<string>('WHATSAPP_GRAPH_API_BASE');
    const v = this.cfg.get<string>('WHATSAPP_GRAPH_API_VERSION');
    if (!token || !phoneNumberId || !base || !v)
      throw new UnauthorizedException('WA config missing');

    const url = `${base}/${v}/${phoneNumberId}/messages`;
    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to: dm.externalId,
        type: 'text',
        text: { preview_url: false, body: text },
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
}
