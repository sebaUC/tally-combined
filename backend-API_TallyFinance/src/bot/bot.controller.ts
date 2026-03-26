import {
  Body,
  Controller,
  Post,
  Inject,
  InternalServerErrorException,
  Logger,
  HttpException,
  HttpStatus,
  OnModuleInit,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { BotV3Service } from './v3/bot-v3.service';
import { WhatsappAdapter } from './adapters/whatsapp.adapter';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { CallbackHandlerService } from './services/callback-handler.service';
import { UserContextService } from './services/user-context.service';
import { BotChannelService } from './delegates/bot-channel.service';
import { DomainMessage } from './contracts';
import { BotReply } from './actions/action-block';
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
    private readonly botV3: BotV3Service,
    private readonly wa: WhatsappAdapter,
    private readonly tg: TelegramAdapter,
    private readonly callbackHandler: CallbackHandlerService,
    private readonly userContext: UserContextService,
    private readonly channels: BotChannelService,
    private readonly redis: RedisService,
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
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

  /**
   * Send all BotReply items via WhatsApp.
   */
  private async sendWaReplies(
    msg: DomainMessage,
    replies: BotReply[],
  ): Promise<void> {
    for (const reply of replies) {
      if (reply.skipSend || !reply.text) continue;
      if (reply.buttons?.length) {
        await this.wa.sendInteractiveReply(msg, reply.text, reply.buttons);
      } else {
        await this.wa.sendReply(msg, reply.text, { parseMode: reply.parseMode });
      }
    }
  }

  /**
   * Send all BotReply items via Telegram.
   */
  private async sendTgReplies(
    msg: DomainMessage,
    replies: BotReply[],
  ): Promise<void> {
    for (const reply of replies) {
      if (reply.skipSend || !reply.text) continue;
      if (reply.buttons?.length) {
        await this.tg.sendReplyWithButtons(
          msg,
          reply.text,
          reply.buttons,
          reply.parseMode,
        );
      } else {
        await this.tg.sendReply(msg, reply.text, { parseMode: reply.parseMode });
      }
    }
  }

  @Post('whatsapp/webhook')
  async whatsapp(@Body() body: any) {
    this.log.debug(`[WA] Webhook body=${JSON.stringify(body)}`);

    // Handle WhatsApp interactive button reply (callback equivalent)
    const change = body?.entry?.[0]?.changes?.[0];
    const msg = change?.value?.messages?.[0];
    if (msg?.type === 'interactive' && msg?.interactive?.type === 'button_reply') {
      const callbackData = msg.interactive.button_reply?.id;
      const phone = msg.from;
      if (callbackData && phone) {
        const userId = await this.channels.getUserIdByExternalId(phone, 'whatsapp');
        if (userId) {
          const result = await this.callbackHandler.handle(callbackData, userId);
          if (result) {
            const domainMsg: DomainMessage = {
              channel: 'whatsapp',
              externalId: phone,
              platformMessageId: msg.id,
              text: '',
              timestamp: new Date().toISOString(),
            };
            await this.wa.sendReply(domainMsg, result, { parseMode: 'HTML' });
          }
        }
      }
      return 'EVENT_RECEIVED';
    }

    const domainMsg = this.wa.fromIncoming(body);
    if (!domainMsg) {
      this.log.debug('[WA] Evento sin mensaje procesable');
      return 'EVENT_IGNORED';
    }

    // Check rate limit (Redis-backed)
    await this.checkRateLimit(domainMsg.externalId, 'whatsapp');

    // Download media attachments (photos, voice, documents)
    await this.wa.downloadMedia(body, domainMsg);

    // Mark as read — shows blue checkmarks while processing
    this.wa.markAsRead(domainMsg.platformMessageId, domainMsg.externalId).catch(() => {});

    try {
      this.log.debug(`[WA] DomainMessage text="${domainMsg.text}" media=${domainMsg.media?.length ?? 0}`);

      const userId = await this.channels.getUserIdByExternalId(domainMsg.externalId, 'whatsapp');
      if (!userId) {
        await this.wa.sendReply(domainMsg, 'No tienes cuenta vinculada. Regístrate en tallyfinance.vercel.app', {});
        return 'EVENT_RECEIVED';
      }

      const result = await this.botV3.handle(userId, domainMsg.text || '', 'whatsapp', domainMsg.platformMessageId);
      await this.sendWaReplies(domainMsg, result.replies);
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

    // Handle Telegram callback_query (button press)
    if (body?.callback_query) {
      const cbq = body.callback_query;
      const callbackData: string = cbq?.data;
      const chatId = String(cbq?.message?.chat?.id ?? cbq?.from?.id ?? '');
      const messageId: number = cbq?.message?.message_id;

      if (callbackData && chatId) {
        // Answer callback to remove loading spinner
        await this.answerCallbackQuery(cbq.id).catch(() => {});

        const userId = await this.channels.getUserIdByExternalId(chatId, 'telegram');
        if (userId) {
          const result = await this.callbackHandler.handle(callbackData, userId);
          if (result) {
            const domainMsg: DomainMessage = {
              channel: 'telegram',
              externalId: chatId,
              platformMessageId: String(messageId),
              text: '',
              timestamp: new Date().toISOString(),
            };
            // Edit the original message to show undo result
            if (messageId) {
              await this.tg.editMessageText(chatId, messageId, result, 'HTML').catch(() => {});
            } else {
              await this.tg.sendReply(domainMsg, result, { parseMode: 'HTML' });
            }
          }
        }
      }
      return 'OK';
    }

    const domainMsg = this.tg.fromIncoming(body);
    if (!domainMsg) {
      this.log.debug('[TG] Evento sin mensaje procesable');
      return 'OK';
    }

    // Check rate limit (Redis-backed)
    await this.checkRateLimit(domainMsg.externalId, 'telegram');

    // Download media attachments (photos, voice, documents)
    await this.tg.downloadMedia(body, domainMsg);

    // Start "typing..." indicator — repeats every 4s until reply is sent
    const stopTyping = this.tg.startTyping(domainMsg);

    try {
      this.log.debug(`[TG] DomainMessage text="${domainMsg.text}" media=${domainMsg.media?.length ?? 0}`);

      const userId = await this.channels.getUserIdByExternalId(domainMsg.externalId, 'telegram');
      if (!userId) {
        stopTyping();
        await this.tg.sendReply(domainMsg, 'No tienes cuenta vinculada. Regístrate en tallyfinance.vercel.app', {});
        return 'OK';
      }

      // Handle /reset command
      if (domainMsg.text?.trim() === '/reset') {
        await this.botV3.reset(userId);
        stopTyping();
        await this.tg.sendReply(domainMsg, 'Conversación reiniciada.', {});
        return 'OK';
      }

      const result = await this.botV3.handle(userId, domainMsg.text || '', 'telegram', domainMsg.platformMessageId);
      stopTyping();
      await this.sendTgReplies(domainMsg, result.replies);
      return 'OK';
    } catch (err) {
      stopTyping();
      if (err instanceof HttpException) throw err;
      console.error('[TG][ERROR]', err);
      throw new InternalServerErrorException(
        'Error procesando mensaje de Telegram',
      );
    }
  }

  /** Answer Telegram callback_query to remove the loading indicator */
  private async answerCallbackQuery(callbackQueryId: string): Promise<void> {
    const token = (this.tg as any).cfg?.get?.('TELEGRAM_BOT_TOKEN');
    if (!token) return;
    try {
      const axios = require('axios');
      await axios.post(
        `https://api.telegram.org/bot${token}/answerCallbackQuery`,
        { callback_query_id: callbackQueryId },
        { timeout: 5_000 },
      );
    } catch {
      // ignore
    }
  }

  @Post('bot/test')
  async test(@Body() body: TestRequest) {
    this.log.debug(`[TEST] Request: ${JSON.stringify(body)}`);

    if (!body.message || !body.userId) {
      return { ok: false, error: 'Missing required fields: message, userId' };
    }

    try {
      const result = await this.botV3.handle(body.userId, body.message, body.channel ?? 'test');
      return {
        ok: true,
        reply: result.reply,
        replies: result.replies.map((r) => ({ text: r.text, hasButtons: !!r.buttons?.length })),
        functionsCalled: result.functionsCalled.map((fc) => ({
          name: fc.name,
          args: fc.args,
          result: fc.result,
        })),
        tokensUsed: result.tokensUsed,
      };
    } catch (err) {
      this.log.error(`[TEST] Error: ${String(err)}`);
      return { ok: false, error: String(err) };
    }
  }

  // ── V3: Gemini Function Calling ──

  @Post('bot/test-v3')
  async testV3(
    @Body() body: { message: string; userId: string; reset?: boolean },
  ) {
    if (!body.message && !body.reset) {
      return { ok: false, error: 'Missing required fields: message, userId' };
    }
    if (!body.userId) {
      return { ok: false, error: 'Missing required field: userId' };
    }

    if (body.reset) {
      await this.botV3.reset(body.userId);
      return { ok: true, message: 'Conversation reset' };
    }

    try {
      const result = await this.botV3.handle(body.userId, body.message, 'test');
      return {
        ok: true,
        reply: result.reply,
        functionsCalled: result.functionsCalled.map((fc) => ({
          name: fc.name,
          args: fc.args,
          result: fc.result,
        })),
        tokensUsed: result.tokensUsed,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}
