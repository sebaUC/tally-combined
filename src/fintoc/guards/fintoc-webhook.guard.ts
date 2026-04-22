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
import {
  FINTOC_WEBHOOK_IP_ALLOWLIST,
  FINTOC_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
} from '../constants/fintoc.constants';
import { FintocAuditService } from '../services/fintoc-audit.service';

/**
 * Valida webhooks entrantes de Fintoc — 3 capas:
 *   1. IP allowlist (opcional, configurable con FINTOC_WEBHOOK_IP_ENFORCE)
 *   2. Firma HMAC-SHA256 del header `Fintoc-Signature`
 *   3. Timestamp dentro de la tolerancia (anti-replay)
 *
 * Si cualquiera falla → 401 + audit log.
 *
 * El secret del webhook viene de `FINTOC_WEBHOOK_SECRET`.
 */
@Injectable()
export class FintocWebhookGuard implements CanActivate {
  private readonly logger = new Logger(FintocWebhookGuard.name);
  private readonly webhookSecret: string;
  private readonly enforceIpAllowlist: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly audit: FintocAuditService,
  ) {
    const secret = config.get<string>('FINTOC_WEBHOOK_SECRET');
    if (!secret) {
      throw new Error('FINTOC_WEBHOOK_SECRET env var is required');
    }
    this.webhookSecret = secret;
    // Por defecto no enforce en dev (ngrok/local). En prod: FINTOC_WEBHOOK_IP_ENFORCE=true
    this.enforceIpAllowlist =
      config.get<string>('FINTOC_WEBHOOK_IP_ENFORCE') === 'true';
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();

    // 1. IP allowlist
    if (this.enforceIpAllowlist && !this.isIpAllowed(req)) {
      this.rejectAndLog(req, 'ip_not_allowed');
    }

    // 2. Firma + timestamp
    const header = req.headers['fintoc-signature'];
    const signatureHeader = Array.isArray(header) ? header[0] : header;
    if (!signatureHeader) {
      this.rejectAndLog(req, 'missing_signature');
    }

    const parsed = this.parseSignatureHeader(signatureHeader as string);
    if (!parsed) {
      this.rejectAndLog(req, 'malformed_signature');
    }

    if (!this.isTimestampFresh(parsed!.timestamp)) {
      this.rejectAndLog(req, 'stale_timestamp');
    }

    const rawBody = req.rawBody?.toString('utf8') ?? '';
    if (!this.verifySignature(parsed!.timestamp, rawBody, parsed!.signature)) {
      this.rejectAndLog(req, 'bad_signature');
    }

    return true;
  }

  // ── helpers ──────────────────────────────────────────────────

  private isIpAllowed(req: Request): boolean {
    const ip = req.ip ?? '';
    return FINTOC_WEBHOOK_IP_ALLOWLIST.includes(ip);
  }

  private parseSignatureHeader(
    header: string,
  ): { timestamp: string; signature: string } | null {
    const parts = header.split(',').map((p) => p.trim());
    let timestamp: string | null = null;
    let signature: string | null = null;
    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key === 't') timestamp = value;
      if (key === 'v1') signature = value;
    }
    if (!timestamp || !signature) return null;
    return { timestamp, signature };
  }

  private isTimestampFresh(timestamp: string): boolean {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;
    const nowSeconds = Math.floor(Date.now() / 1000);
    return Math.abs(nowSeconds - ts) < FINTOC_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS;
  }

  private verifySignature(
    timestamp: string,
    rawBody: string,
    expected: string,
  ): boolean {
    const message = `${timestamp}.${rawBody}`;
    const computed = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(message)
      .digest('hex');

    const a = Buffer.from(computed);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  private rejectAndLog(req: Request, reason: string): never {
    this.logger.warn(`Webhook rejected: ${reason} from ${req.ip}`);
    this.audit.log({
      actorType: 'webhook',
      action: 'webhook_invalid_signature',
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      detail: { reason },
    });
    throw new UnauthorizedException('Invalid webhook signature');
  }
}
