import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { Request } from 'express';

/**
 * Validates the `X-Telegram-Bot-Api-Secret-Token` header set by Telegram
 * when the webhook is registered with `secret_token=<TELEGRAM_SECRET>`.
 * Fails closed on any mismatch.
 */
@Injectable()
export class TelegramWebhookGuard implements CanActivate {
  private readonly logger = new Logger(TelegramWebhookGuard.name);
  private readonly secret: string;

  constructor(config: ConfigService) {
    const s = config.get<string>('TELEGRAM_SECRET');
    if (!s) {
      throw new Error('TELEGRAM_SECRET env var is required');
    }
    this.secret = s;
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers['x-telegram-bot-api-secret-token'];
    const provided = Array.isArray(header) ? header[0] : header;

    if (typeof provided !== 'string' || provided.length === 0) {
      this.reject(req, 'missing_header');
    }

    const a = Buffer.from(provided);
    const b = Buffer.from(this.secret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      this.reject(req, 'bad_secret');
    }
    return true;
  }

  private reject(req: Request, reason: string): never {
    this.logger.warn(`Telegram webhook rejected: ${reason} from ${req.ip}`);
    throw new UnauthorizedException('Invalid webhook secret');
  }
}
