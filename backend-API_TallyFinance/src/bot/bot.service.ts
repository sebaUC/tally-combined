import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DomainMessage } from './contracts';
import { BotChannelService } from './delegates/bot-channel.service';
import { UserContextService } from './services/user-context.service';
import { ConversationService } from './services/conversation.service';
import { MetricsService } from './services/metrics.service';
import { CooldownService } from './services/cooldown.service';
import { StyleDetectorService } from './services/style-detector.service';
import { OrchestratorClient } from './services/orchestrator.client';
import { MessageLogService } from './services/message-log.service';
import {
  OrchestratorError,
  PhaseAResponse,
  RuntimeContext,
  toPendingSlotContext,
} from './services/orchestrator.contracts';
import { GuardrailsService } from './services/guardrails.service';
import { ToolRegistry } from './tools/tool-registry';
import { ActionResult } from './actions/action-result';
import { RedisService, RedisKeys, RedisTTL } from '../redis';
import { debugLog } from '../common/utils/debug-logger';

export interface ProcessingMetrics {
  correlationId: string;
  totalMs: number;
  contextMs: number;
  phaseAMs: number;
  toolMs: number;
  phaseBMs: number;
  phaseAResponse?: PhaseAResponse;
  toolName?: string;
  toolResult?: ActionResult;
}

@Injectable()
export class BotService {
  private readonly log = debugLog.bot;

  constructor(
    private readonly channels: BotChannelService,
    private readonly userContext: UserContextService,
    private readonly conversation: ConversationService,
    private readonly metricsService: MetricsService,
    private readonly cooldowns: CooldownService,
    private readonly styleDetector: StyleDetectorService,
    private readonly orchestrator: OrchestratorClient,
    private readonly guardrails: GuardrailsService,
    private readonly toolRegistry: ToolRegistry,
    private readonly redis: RedisService,
    private readonly messageLog: MessageLogService,
  ) {}

  async handle(m: DomainMessage): Promise<string> {
    const cid = this.generateCorrelationId();

    this.log.separator(cid);
    this.log.recv(`${m.channel} message`, { text: m.text.substring(0, 50), from: m.externalId }, cid);

    // 1. Handle /start commands (Telegram deep links) - no dedup needed
    const startReply = await this.channels.handleStartCommand(m);
    if (startReply) {
      this.log.ok('Start command handled', undefined, cid);
      return startReply;
    }

    // 2. Lookup user - no dedup needed yet (fast operation)
    const userId = await this.channels.lookupLinkedUser(m);
    if (!userId) {
      this.log.warn('User not linked', { externalId: m.externalId }, cid);
      return this.channels.buildLinkReply(m);
    }

    // 3. TWO-PHASE DEDUP: Prevents duplicate processing and allows retry on crash
    const messageId = m.platformMessageId || `${m.channel}-${m.externalId}-${Date.now()}`;
    const dedupKey = RedisKeys.msgDedup(messageId);
    const dedupState = await this.redis.get(dedupKey);

    if (dedupState === 'done') {
      this.log.state('Duplicate ignored (already done)', { msgId: messageId }, cid);
      return '[duplicate ignored]';
    }

    if (dedupState === 'processing') {
      this.log.state('Message still processing', { msgId: messageId }, cid);
      return 'Procesando tu mensaje...';
    }

    // Set "processing" with short TTL (120s) - expires if crash
    await this.redis.set(dedupKey, 'processing', RedisTTL.MSG_DEDUP_PROCESSING);

    // 4. CONCURRENCY LOCK: Only one message per user at a time
    const lockKey = RedisKeys.lock(userId);
    const lockAcquired = await this.redis.acquireLock(lockKey, RedisTTL.LOCK * 1000);

    if (!lockAcquired) {
      this.log.warn('Lock not acquired, user busy', { userId }, cid);
      await this.redis.del(dedupKey);
      return 'Dame un momento, aún proceso tu mensaje anterior...';
    }

    try {
      const { reply, metrics } = await this.processMessage(cid, userId, m);

      // SUCCESS: Mark dedup as "done" with 24h TTL
      await this.redis.set(dedupKey, 'done', RedisTTL.MSG_DEDUP_DONE);

      this.log.send('Response ready', { length: reply.length, totalMs: metrics.totalMs }, cid);
      return reply;
    } catch (err) {
      this.log.err('Processing failed', { error: String(err) }, cid);
      await this.redis.del(dedupKey);
      throw err;
    } finally {
      await this.redis.releaseLock(lockKey);
    }
  }

  async handleTest(
    userId: string,
    m: DomainMessage,
  ): Promise<{ reply: string; metrics: ProcessingMetrics }> {
    const cid = this.generateCorrelationId();
    this.log.separator(cid);
    this.log.recv('Test message', { userId, text: m.text.substring(0, 50) }, cid);
    return this.processMessage(cid, userId, m);
  }

  private async processMessage(
    cid: string,
    userId: string,
    m: DomainMessage,
  ): Promise<{ reply: string; metrics: ProcessingMetrics }> {
    const startTotal = Date.now();
    const metrics: ProcessingMetrics = {
      correlationId: cid,
      totalMs: 0,
      contextMs: 0,
      phaseAMs: 0,
      toolMs: 0,
      phaseBMs: 0,
    };

    if (process.env.DISABLE_AI === '1') {
      this.log.warn('AI disabled (maintenance mode)', undefined, cid);
      metrics.totalMs = Date.now() - startTotal;
      return { reply: 'En mantenimiento.', metrics };
    }

    try {
      // 1. LOAD ALL STATE BEFORE PROCESSING (transaction-like behavior)
      const contextTimer = this.log.timer('Context loaded', cid);
      const [context, summary, pending, userMetrics, cooldownFlags] =
        await Promise.all([
          this.userContext.getContext(userId),
          this.conversation.getSummary(userId),
          this.conversation.getPending(userId),
          this.metricsService.getMetrics(userId),
          this.cooldowns.getCooldownFlags(userId),
        ]);
      metrics.contextMs = Date.now() - startTotal;
      contextTimer();

      // Log pending state if exists
      if (pending) {
        this.log.pending('Pending slot-fill found', {
          tool: pending.tool,
          collected: Object.keys(pending.collectedArgs).join(','),
          missing: pending.missingArgs.join(','),
        }, cid);
      }

      // 2. Detect user style from message
      const userStyle = this.styleDetector.detect(m.text);

      // 3. Get tool schemas
      const tools = this.toolRegistry.getToolSchemas();

      // 4. Extract available categories for Phase A matching
      const availableCategories: string[] =
        context.categories?.map((c) => c.name) ?? [];

      // 5. Convert pending state for Phase A
      const pendingContext = toPendingSlotContext(pending);

      // 6. Phase A: AI decides what to do (with pending context for slot-filling)
      const phaseATimer = this.log.timer('Phase A', cid);
      const phaseA = await this.orchestrator.phaseA(
        m.text,
        context,
        tools,
        pendingContext,
        availableCategories,
      );
      metrics.phaseAMs = Date.now() - startTotal - metrics.contextMs;
      phaseATimer();

      metrics.phaseAResponse = phaseA;
      this.log.phaseA('Decision', { type: phaseA.response_type }, cid);

      // Handle Phase A response - direct replies
      if (phaseA.response_type === 'direct_reply') {
        metrics.totalMs = Date.now() - startTotal;
        this.log.ok('Direct reply', { ms: metrics.totalMs }, cid);
        this.logMessageAsync(userId, m.channel, m.text, phaseA.direct_reply!, null, phaseA as unknown as Record<string, unknown>, null, null);
        return { reply: phaseA.direct_reply!, metrics };
      }

      if (phaseA.response_type === 'clarification') {
        metrics.totalMs = Date.now() - startTotal;
        this.log.slot('Clarification needed', { text: phaseA.clarification?.substring(0, 50) }, cid);
        this.logMessageAsync(userId, m.channel, m.text, phaseA.clarification!, null, phaseA as unknown as Record<string, unknown>, null, null);
        return { reply: phaseA.clarification!, metrics };
      }

      // Tool call flow
      const toolCall = phaseA.tool_call!;
      metrics.toolName = toolCall.name;
      this.log.tool(`Calling ${toolCall.name}`, { args: toolCall.args }, cid);

      // 7. Validate arguments with Guardrails
      const validation = this.guardrails.validate(toolCall);
      if (!validation.valid) {
        this.log.warn('Guardrails rejected', { error: validation.error }, cid);
        metrics.totalMs = Date.now() - startTotal;
        const guardrailReply = 'No pude procesar tu solicitud. ¿Podrías intentar de nuevo con más detalle?';
        this.logMessageAsync(userId, m.channel, m.text, guardrailReply, toolCall.name, phaseA as unknown as Record<string, unknown>, null, `Guardrails: ${validation.error}`);
        return { reply: guardrailReply, metrics };
      }

      // 8. Execute tool handler
      const toolTimer = this.log.timer(`Tool ${toolCall.name}`, cid);
      const handler = this.toolRegistry.getHandler(toolCall.name);
      const sanitizedArgs = validation.sanitized?.args ?? toolCall.args;

      // Inject categories from context to avoid redundant DB query
      if (toolCall.name === 'register_transaction' && context.categories?.length) {
        sanitizedArgs._categories = context.categories;
      }

      const result = await handler.execute(userId, m, sanitizedArgs);
      metrics.toolMs = Date.now() - startTotal - metrics.contextMs - metrics.phaseAMs;
      metrics.toolResult = result;
      toolTimer();

      this.log.tool(`Result: ${result.ok ? 'success' : 'failed'}`, { action: result.action }, cid);

      // 9. WRITE ORDER: Metrics AFTER tool success only
      if (toolCall.name === 'register_transaction' && result.ok) {
        await this.metricsService.recordTransaction(userId);
        this.log.state('Transaction metrics recorded', undefined, cid);
      }

      // 10. If handler returns userMessage (slot-filling), save pending state and return
      if (result.userMessage) {
        if (result.pending) {
          await this.conversation.setPending(userId, {
            tool: toolCall.name,
            collectedArgs: result.pending.collectedArgs,
            missingArgs: result.pending.missingArgs,
            askedAt: new Date().toISOString(),
          });
          this.log.pending('Saved pending state', {
            collected: Object.keys(result.pending.collectedArgs).join(','),
            missing: result.pending.missingArgs.join(','),
          }, cid);
        }

        metrics.totalMs = Date.now() - startTotal;
        this.log.slot('Slot-fill prompt', { response: result.userMessage.substring(0, 50) }, cid);
        this.logMessageAsync(userId, m.channel, m.text, result.userMessage, toolCall.name, phaseA as unknown as Record<string, unknown>, null, null);
        return { reply: result.userMessage, metrics };
      }

      // 11. Build RuntimeContext for Phase B
      const budgetPercent =
        context.activeBudget?.amount && context.activeBudget.spent != null
          ? context.activeBudget.spent / context.activeBudget.amount
          : null;

      const moodHint = this.metricsService.calculateMoodHint(context, userMetrics);

      const runtimeContext: RuntimeContext = {
        summary: summary ?? undefined,
        metrics: {
          tx_streak_days: userMetrics.txStreakDays,
          week_tx_count: userMetrics.weekTxCount,
          budget_percent: budgetPercent,
        },
        mood_hint: moodHint,
        can_nudge: cooldownFlags.canNudge,
        can_budget_warning: cooldownFlags.canBudgetWarning,
        last_opening: undefined,
        user_style: {
          uses_lucas: userStyle.usesLucas,
          uses_chilenismos: userStyle.usesChilenismos,
          emoji_level: userStyle.emojiLevel,
          is_formal: userStyle.isFormal,
        },
      };

      // 12. Phase B: AI generates personalized response
      const phaseBTimer = this.log.timer('Phase B', cid);
      let phaseB;
      try {
        phaseB = await this.orchestrator.phaseB(
          toolCall.name,
          result,
          context,
          runtimeContext,
        );
      } catch (phaseBError) {
        this.log.err('Phase B failed after tool success', { error: String(phaseBError) }, cid);
        metrics.phaseBMs = Date.now() - startTotal - metrics.contextMs - metrics.phaseAMs - metrics.toolMs;
        metrics.totalMs = Date.now() - startTotal;
        const phaseBFailReply = 'Listo. (No pude generar un mensaje personalizado)';
        this.logMessageAsync(userId, m.channel, m.text, phaseBFailReply, toolCall.name, phaseA as unknown as Record<string, unknown>, null, `Phase B failed: ${String(phaseBError)}`);
        return { reply: phaseBFailReply, metrics };
      }
      metrics.phaseBMs = Date.now() - startTotal - metrics.contextMs - metrics.phaseAMs - metrics.toolMs;
      phaseBTimer();

      this.log.phaseB('Response generated', { length: phaseB.final_message.length }, cid);

      // 13. WRITE ORDER: Summary AFTER Phase B success only
      if (phaseB.new_summary) {
        await this.conversation.saveSummary(userId, phaseB.new_summary);
        this.log.state('Summary saved', undefined, cid);
      }

      // 14. WRITE ORDER: Cooldowns AFTER Phase B success AND did_nudge=true
      if (phaseB.did_nudge && phaseB.nudge_type) {
        await this.cooldowns.recordNudge(userId, phaseB.nudge_type);
        this.log.state('Nudge recorded', { type: phaseB.nudge_type }, cid);
      }

      // 15. Clear pending if slot-fill was in progress and tool completed
      if (pending && result.ok) {
        await this.conversation.clearPending(userId);
        this.log.state('Pending cleared', undefined, cid);
      }

      metrics.totalMs = Date.now() - startTotal;
      this.log.ok('Flow complete', {
        context: `${metrics.contextMs}ms`,
        phaseA: `${metrics.phaseAMs}ms`,
        tool: `${metrics.toolMs}ms`,
        phaseB: `${metrics.phaseBMs}ms`,
        total: `${metrics.totalMs}ms`,
      }, cid);

      // Log for admin backoffice
      this.logMessageAsync(
        userId,
        m.channel,
        m.text,
        phaseB.final_message,
        toolCall.name,
        phaseA as unknown as Record<string, unknown>,
        phaseB as unknown as Record<string, unknown>,
        null,
      );

      return { reply: phaseB.final_message, metrics };
    } catch (err) {
      metrics.totalMs = Date.now() - startTotal;

      if (err instanceof OrchestratorError) {
        this.log.err(`Orchestrator: ${err.code}`, { message: err.message }, cid);

        // Handle cold start specially - friendly sleeping message
        if (err.code === 'COLD_START') {
          this.log.warn('😴 AI Service cold start detected', undefined, cid);
          const coldStartReply = '😴💤 Estoy despertando, dame un momento... Envía tu mensaje de nuevo en unos segundos.';
          this.logMessageAsync(userId, m.channel, m.text, coldStartReply, metrics.toolName ?? null, null, null, `COLD_START: ${err.message}`);
          return { reply: coldStartReply, metrics };
        }

        const errorMessages: Record<string, string> = {
          LLM_TIMEOUT:
            '😪 Estoy un poco lento... Intenta de nuevo en unos segundos.',
          INVALID_RESPONSE:
            'Recibí una respuesta inesperada. ¿Podrías reformular tu mensaje?',
          LLM_ERROR:
            '😴 Tuve un problema respondiendo. Intenta de nuevo en unos momentos.',
        };

        const errorReply = errorMessages[err.code] ?? 'Hubo un problema procesando tu solicitud.';
        this.logMessageAsync(userId, m.channel, m.text, errorReply, metrics.toolName ?? null, null, null, `${err.code}: ${err.message}`);
        return { reply: errorReply, metrics };
      }

      this.log.err('Unexpected error', { error: String(err) }, cid);
      const unexpectedReply = 'Hubo un error procesando tu solicitud.';
      this.logMessageAsync(userId, m.channel, m.text, unexpectedReply, metrics.toolName ?? null, null, null, String(err));
      return { reply: unexpectedReply, metrics };
    }
  }

  private generateCorrelationId(): string {
    return randomUUID().substring(0, 8);
  }

  private logMessageAsync(
    userId: string | null,
    channel: string,
    userMessage: string,
    botResponse: string | null,
    toolName: string | null,
    phaseADebug: Record<string, unknown> | null,
    phaseBDebug: Record<string, unknown> | null,
    error: string | null,
  ): void {
    // Fire and forget - don't await, don't block the response
    this.messageLog.log({
      userId,
      channel,
      userMessage,
      botResponse,
      toolName,
      phaseADebug,
      phaseBDebug,
      error,
    }).catch((err) => {
      console.error('[BotService] Failed to log message:', err);
    });
  }
}
