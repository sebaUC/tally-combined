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
import { BotService } from './bot.service';
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
    private readonly bot: BotService,
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
      const replies = await this.bot.handle(domainMsg);
      await this.sendWaReplies(domainMsg, replies);
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

      // ── V3 Pipeline: Gemini Function Calling ──
      const useV3 = process.env.BOT_V3 === '1';

      if (useV3) {
        const userId = await this.channels.getUserIdByExternalId(domainMsg.externalId, 'telegram');
        if (!userId) {
          stopTyping();
          await this.tg.sendReply(domainMsg, 'No tienes cuenta vinculada. Regístrate en tallyfinance.vercel.app', {});
          return 'OK';
        }

        const { GeminiClient } = await import('./v3/gemini.client.js');
        const { botTools } = await import('./v3/function-declarations.js');
        const { createFunctionRouter } = await import('./v3/function-router.js');
        const { conversations } = await import('./gemini-v3-prototype.js');
        const fs = await import('fs');
        const path = await import('path');

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) { stopTyping(); return 'OK'; }

        // Load context
        let displayName = 'Usuario', tone = 'neutral', mood = 'normal';
        let categories: string[] = [], budget = 'Sin presupuesto activo';
        try {
          const ctx = await this.userContext.getContext(userId);
          displayName = ctx.displayName || 'Usuario';
          tone = ctx.personality?.tone || 'neutral';
          mood = ctx.personality?.mood || 'normal';
          categories = (ctx.categories || []).map((c: any) => c.name);
          if (ctx.activeBudget?.amount) budget = `${ctx.activeBudget.period}: $${Math.round(ctx.activeBudget.amount).toLocaleString('es-CL')}`;
        } catch {}

        // System prompt
        let systemPrompt: string;
        try {
          systemPrompt = fs.readFileSync(path.join(__dirname, 'v3', 'prompts', 'gus_system.txt'), 'utf-8');
        } catch {
          systemPrompt = 'Eres Gus, asistente financiero. Tono: {tone}.';
        }
        systemPrompt = systemPrompt
          .replace('{tone}', tone).replace('{mood}', mood)
          .replace('{displayName}', displayName)
          .replace('{categories}', categories.join(', ') || 'Sin categorías')
          .replace('{budget}', budget);

        // Conversation
        if (!conversations.has(userId)) conversations.set(userId, []);
        const history = conversations.get(userId)!;
        const userParts = [{ text: domainMsg.text || '' }];
        history.push({ role: 'user', parts: userParts });

        const supabase = this.supabase;
        const client = new GeminiClient(apiKey);
        const executeFn = createFunctionRouter(supabase, userId);

        const result = await client.chat(systemPrompt, history.slice(0, -1), userParts, botTools, executeFn);

        history.push({ role: 'model', parts: [{ text: result.reply }] });
        while (history.length > 50) history.shift();

        stopTyping();
        await this.tg.sendReply(domainMsg, result.reply, { parseMode: 'HTML' });
        return 'OK';
      }

      // ── V2 Pipeline (legacy) ──
      const replies = await this.bot.handle(domainMsg);
      stopTyping();
      await this.sendTgReplies(domainMsg, replies);
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
      const { replies, reply, metrics } = await this.bot.handleTest(
        body.userId,
        testMessage,
      );

      const response: any = {
        ok: true,
        reply,
        replies: replies.map((r) => ({ text: r.text, hasButtons: !!r.buttons?.length })),
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

  // ── V3: Gemini Function Calling (real execution) ──

  @Post('bot/test-v3')
  async testV3(
    @Body() body: { message: string; userId: string; reset?: boolean; dryRun?: boolean },
  ) {
    if (!body.message || !body.userId) {
      return { ok: false, error: 'Missing required fields: message, userId' };
    }

    // Dry run mode: use prototype mock functions
    if (body.dryRun) {
      const { chatV3, resetV3Conversation } = await import('./gemini-v3-prototype.js');
      if (body.reset) { resetV3Conversation(body.userId); return { ok: true, message: 'Reset' }; }
      let uc = { displayName: 'Usuario', tone: 'toxic', mood: 'normal', categories: ['Alimentación', 'Transporte', 'Personal', 'Salud', 'Educación', 'Hogar'] };
      try { const ctx = await this.userContext.getContext(body.userId); uc = { displayName: ctx.displayName || 'Usuario', tone: ctx.personality?.tone || 'toxic', mood: ctx.personality?.mood || 'normal', categories: (ctx.categories || []).map((c: any) => c.name) }; } catch {}
      const r = await chatV3(body.userId, body.message, uc);
      return { ok: true, reply: r.reply, functionsCalled: r.functionsCalled, tokensUsed: r.tokensUsed, mode: 'dry-run' };
    }

    // Real mode: Gemini + Supabase
    const { GeminiClient } = await import('./v3/gemini.client.js');
    const { botTools } = await import('./v3/function-declarations.js');
    const { createFunctionRouter } = await import('./v3/function-router.js');
    const fs = await import('fs');
    const path = await import('path');

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY not configured' };

    // Load user context
    let displayName = 'Usuario';
    let tone = 'toxic';
    let mood = 'normal';
    let categories: string[] = [];
    let budget = 'Sin presupuesto activo';

    try {
      const ctx = await this.userContext.getContext(body.userId);
      displayName = ctx.displayName || 'Usuario';
      tone = ctx.personality?.tone || 'toxic';
      mood = ctx.personality?.mood || 'normal';
      categories = (ctx.categories || []).map((c: any) => c.name);
      if (ctx.activeBudget?.amount) {
        budget = `${ctx.activeBudget.period}: $${Math.round(ctx.activeBudget.amount).toLocaleString('es-CL')}`;
      }
    } catch {}

    // Build system prompt
    let systemPrompt: string;
    try {
      const promptPath = path.join(__dirname, 'v3', 'prompts', 'gus_system.txt');
      systemPrompt = fs.readFileSync(promptPath, 'utf-8');
    } catch {
      // Fallback: inline minimal prompt
      systemPrompt = 'Eres Gus, asistente financiero de TallyFinance. Tono: {tone}. Mood: {mood}.';
    }
    systemPrompt = systemPrompt
      .replace('{tone}', tone)
      .replace('{mood}', mood)
      .replace('{displayName}', displayName)
      .replace('{categories}', categories.join(', ') || 'Sin categorías')
      .replace('{budget}', budget);

    // Conversation history (in-memory for now — Redis later)
    const { chatV3: _ignore, resetV3Conversation } = await import('./gemini-v3-prototype.js');

    // Use in-memory conversation from prototype (shared store)
    // TODO: Move to Redis-backed conversation service
    const convModule = await import('./gemini-v3-prototype.js');

    if (body.reset) {
      convModule.resetV3Conversation(body.userId);
      return { ok: true, message: 'Conversation reset' };
    }

    // Get Supabase client from the UserContextService's injected instance
    const supabase = (this.userContext as any).supabase;
    if (!supabase) return { ok: false, error: 'Supabase client not available' };

    const client = new GeminiClient(apiKey);
    const executeFunction = createFunctionRouter(supabase, body.userId);

    // Get conversation history (in-memory from prototype for now)
    const conversations = (convModule as any).conversations || new Map();
    if (!conversations.has(body.userId)) conversations.set(body.userId, []);
    const history = conversations.get(body.userId)!;

    const userParts = [{ text: body.message }];

    try {
      // Add user message to history
      history.push({ role: 'user', parts: userParts });

      const result = await client.chat(
        systemPrompt,
        history.slice(0, -1), // all except current
        userParts,
        botTools,
        executeFunction,
      );

      // Add model response to history
      history.push({ role: 'model', parts: [{ text: result.reply }] });

      // Add function calls to history (for context)
      for (const fc of result.functionsCalled) {
        // These are already in the chat via sendMessage, but we track them
      }

      // Trim history
      while (history.length > 50) history.shift();

      return {
        ok: true,
        reply: result.reply,
        functionsCalled: result.functionsCalled.map((fc) => ({
          name: fc.name,
          args: fc.args,
          result: fc.result,
        })),
        tokensUsed: result.tokensUsed,
        mode: 'real',
      };
    } catch (err) {
      // Remove the user message we added if it failed
      if (history.length && history[history.length - 1]?.role === 'user') {
        history.pop();
      }
      return { ok: false, error: String(err) };
    }
  }
}
