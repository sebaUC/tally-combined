import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Validates Meta's `X-Hub-Signature-256` header on WhatsApp Cloud API
 * webhook POSTs. Expects HMAC-SHA256 of the raw request body keyed with
 * the Meta app secret (`WHATSAPP_APP_SECRET`).
 *
 * GET requests (webhook verification handshake from Meta) are allowed
 * through and are expected to be verified by a dedicated handler that
 * checks `hub.verify_token` against a second env var.
 */
@Injectable()
export class WhatsappWebhookGuard implements CanActivate {
  private readonly logger = new Logger(WhatsappWebhookGuard.name);
  private readonly appSecret: string;

  constructor(config: ConfigService) {
    const s = config.get<string>('WHATSAPP_APP_SECRET');
    if (!s) {
      throw new Error(
        'WHATSAPP_APP_SECRET env var is required for webhook HMAC validation',
      );
    }
    this.appSecret = s;
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<RawBodyRequest<Request>>();

    // GET is Meta's one-time verification challenge — handled outside this guard.
    if (req.method === 'GET') return true;

    const header = req.headers['x-hub-signature-256'];
    const sig = Array.isArray(header) ? header[0] : header;
    if (typeof sig !== 'string' || !sig.startsWith('sha256=')) {
      this.reject(req, 'missing_or_malformed_header');
    }
    const expectedHex = (sig as string).slice('sha256='.length);

    const rawBody = req.rawBody?.toString('utf8') ?? '';
    const computed = crypto
      .createHmac('sha256', this.appSecret)
      .update(rawBody)
      .digest('hex');

    const a = Buffer.from(computed);
    const b = Buffer.from(expectedHex);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      this.reject(req, 'bad_signature');
    }
    return true;
  }

  private reject(req: Request, reason: string): never {
    this.logger.warn(`WhatsApp webhook rejected: ${reason} from ${req.ip}`);
    throw new UnauthorizedException('Invalid webhook signature');
  }
}
