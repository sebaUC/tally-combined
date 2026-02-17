import {
  Body,
  Controller,
  Post,
  InternalServerErrorException,
  Logger,
  HttpException,
  HttpStatus,
  OnModuleInit,
} from '@nestjs/common';
import { BotService } from './bot.service';
import { WhatsappAdapter } from './adapters/whatsapp.adapter';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { UserContextService } from './services/user-context.service';
import { DomainMessage } from './contracts';
import {
  AsyncRateLimiter,
  createAsyncRateLimiter,
} from '../common/utils/resilience';
import { RedisService } from '../redis';

interface TestRequest {
  message: string;
  userId: string;
  channel?: 'telegram' | 'whatsapp' | 'test';
  verbose?: boolean;
}

@Controller()
export class BotController implements OnModuleInit {
  private readonly log = new Logger(BotController.name);

  // Rate limiter: 30 messages per minute per user (Redis-backed with in-memory fallback)
  private rateLimiter!: AsyncRateLimiter;

  constructor(
    private readonly bot: BotService,
    private readonly wa: WhatsappAdapter,
    private readonly tg: TelegramAdapter,
    private readonly userContext: UserContextService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    // Initialize async rate limiter with Redis (30 msgs/60s per user)
    this.rateLimiter = createAsyncRateLimiter(this.redis, 30, 60_000);
  }

  /**
   * Checks rate limit for an external user ID.
   * Throws 429 Too Many Requests if exceeded.
   */
  private async checkRateLimit(key: string, channel: string): Promise<void> {
    const allowed = await this.rateLimiter.isAllowed(key);
    if (!allowed) {
      this.log.warn(`[RateLimit] Exceeded for ${channel}/${key}`);
      throw new HttpException(
        'Demasiados mensajes. Espera un momento antes de enviar más.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  @Post('whatsapp/webhook')
  async whatsapp(@Body() body: any) {
    this.log.debug(`[WA] Webhook body=${JSON.stringify(body)}`);
    const msg = this.wa.fromIncoming(body);
    if (!msg) {
      this.log.debug('[WA] Evento sin mensaje procesable');
      return 'EVENT_IGNORED';
    }

    // Check rate limit (Redis-backed)
    await this.checkRateLimit(msg.externalId, 'whatsapp');

    try {
      this.log.debug(`[WA] DomainMessage=${JSON.stringify(msg)}`);
      this.log.debug(
        `[WA] Entregando mensaje ${msg.platformMessageId} a BotService`,
      );
      const reply = await this.bot.handle(msg);
      this.log.debug(`[WA] Respuesta lista "${reply}"`);
      await this.wa.sendReply(msg, reply);
      return 'EVENT_RECEIVED';
    } catch (err) {
      if (err instanceof HttpException) throw err;
      console.error('[WSP][ERROR]', err);
      throw new InternalServerErrorException(
        'Error procesando mensaje de WhatsApp',
      );
    }
  }

  @Post('telegram/webhook')
  async telegram(@Body() body: any) {
    this.log.debug(`[TG] Webhook body=${JSON.stringify(body)}`);
    const msg = this.tg.fromIncoming(body);
    if (!msg) {
      this.log.debug('[TG] Evento sin mensaje procesable');
      return 'OK';
    }

    // Check rate limit (Redis-backed)
    await this.checkRateLimit(msg.externalId, 'telegram');

    try {
      this.log.debug(`[TG] DomainMessage=${JSON.stringify(msg)}`);
      this.log.debug(
        `[TG] Entregando mensaje ${msg.platformMessageId} a BotService`,
      );
      const reply = await this.bot.handle(msg);
      this.log.debug(`[TG] Respuesta lista "${reply}"`);
      await this.tg.sendReply(msg, reply);
      return 'OK';
    } catch (err) {
      if (err instanceof HttpException) throw err;
      console.error('[TG][ERROR]', err);
      throw new InternalServerErrorException(
        'Error procesando mensaje de Telegram',
      );
    }
  }

  @Post('bot/test')
  async test(@Body() body: TestRequest) {
    this.log.debug(`[TEST] Request: ${JSON.stringify(body)}`);

    if (!body.message || !body.userId) {
      return {
        ok: false,
        error: 'Missing required fields: message, userId',
      };
    }

    const testMessage: DomainMessage = {
      channel: body.channel ?? 'test',
      externalId: `test-${body.userId}`,
      platformMessageId: `test-${Date.now()}`,
      text: body.message,
      timestamp: new Date().toISOString(),
    };

    try {
      const { reply, metrics } = await this.bot.handleTest(
        body.userId,
        testMessage,
      );

      const response: any = {
        ok: true,
        reply,
        metrics: {
          correlationId: metrics.correlationId,
          totalMs: metrics.totalMs,
          contextMs: metrics.contextMs,
          phaseAMs: metrics.phaseAMs,
          toolMs: metrics.toolMs,
          phaseBMs: metrics.phaseBMs,
        },
      };

      if (body.verbose) {
        response.debug = {
          phaseA: metrics.phaseAResponse,
          toolName: metrics.toolName,
          toolResult: metrics.toolResult,
          input: testMessage,
        };

        try {
          response.context = await this.userContext.getContext(body.userId);
        } catch {
          response.context = { error: 'Could not load user context' };
        }
      }

      return response;
    } catch (err) {
      this.log.error(`[TEST] Error: ${String(err)}`);
      return {
        ok: false,
        error: String(err),
      };
    }
  }
}
