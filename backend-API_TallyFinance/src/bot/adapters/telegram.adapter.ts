import {
  Injectable,
  Logger,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { Agent } from 'https';
import { DomainMessage } from '../contracts';

// Force IPv4 to avoid timeout issues in Docker
const httpsAgent = new Agent({ family: 4 });

@Injectable()
export class TelegramAdapter {
  private readonly log = new Logger(TelegramAdapter.name);
  constructor(private readonly cfg: ConfigService) {}

  fromIncoming(body: any): DomainMessage | null {
    const msg = body?.message ?? body?.edited_message ?? body?.channel_post;
    if (!msg?.text) {
      this.log.debug('Telegram update sin texto procesable');
      return null;
    }

    const domainMessage: DomainMessage = {
      channel: 'telegram',
      externalId: String(msg.chat?.id),
      platformMessageId: String(msg.message_id),
      text: String(msg.text ?? '').trim(),
      timestamp: new Date((msg.date ?? Date.now() / 1000) * 1000).toISOString(),
      profileHint: {
        displayName: msg.from?.first_name,
        username: msg.from?.username,
      },
    };
    this.log.debug(
      `[fromIncoming] TG message ${domainMessage.platformMessageId} text="${domainMessage.text}"`,
    );
    return domainMessage;
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
        if (!err.response || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') {
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
