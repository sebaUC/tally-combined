import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DomainMessage, MediaAttachment } from './contracts';
import { BotChannelService } from './delegates/bot-channel.service';
import { UserContextService } from './services/user-context.service';
import { ConversationService, SessionSummary } from './services/conversation.service';
import { ConversationLogService } from './services/conversation-log.service';
import { ConversationHistoryService } from './services/conversation-history.service';
import { MetricsService } from './services/metrics.service';
import { CooldownService } from './services/cooldown.service';
import { StyleDetectorService } from './services/style-detector.service';
import { OrchestratorClient } from './services/orchestrator.client';
import { MessageLogService } from './services/message-log.service';
import {
  ConversationMessageMetadata,
  OrchestratorError,
  PhaseAResponse,
  RuntimeContext,
  toPendingSlotContext,
} from './services/orchestrator.contracts';
import { GuardrailsService } from './services/guardrails.service';
import { ToolRegistry } from './tools/tool-registry';
import { ActionResult, ActionType } from './actions/action-result';
import { ActionBlock, ActionItem, BotReply } from './actions/action-block';
import { ActionPlannerService, getItemType } from './services/action-planner.service';
import { ResponseBuilderService } from './services/response-builder.service';
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
    private readonly historyService: ConversationHistoryService,
    private readonly metricsService: MetricsService,
    private readonly cooldowns: CooldownService,
    private readonly styleDetector: StyleDetectorService,
    private readonly orchestrator: OrchestratorClient,
    private readonly guardrails: GuardrailsService,
    private readonly toolRegistry: ToolRegistry,
    private readonly redis: RedisService,
    private readonly messageLog: MessageLogService,
    private readonly actionPlanner: ActionPlannerService,
    private readonly responseBuilder: ResponseBuilderService,
    private readonly conversationLog: ConversationLogService,
  ) {}

  async handle(m: DomainMessage): Promise<BotReply[]> {
    const cid = this.generateCorrelationId();

    this.log.separator(cid);
    this.log.recv(
      `${m.channel} message`,
      { text: m.text.substring(0, 50), from: m.externalId },
      cid,
    );

    // 1. Handle /start commands (Telegram deep links) - no dedup needed
    const startReply = await this.channels.handleStartCommand(m);
    if (startReply) {
      this.log.ok('Start command handled', undefined, cid);
      return [{ text: startReply }];
    }

    // 2. Lookup user - no dedup needed yet (fast operation)
    const userId = await this.channels.lookupLinkedUser(m);
    if (!userId) {
      this.log.warn('User not linked', { externalId: m.externalId }, cid);
      return [{ text: await this.channels.buildLinkReply(m) }];
    }

    // 3. TWO-PHASE DEDUP: Prevents duplicate processing and allows retry on crash
    const messageId =
      m.platformMessageId || `${m.channel}-${m.externalId}-${Date.now()}`;
    const dedupKey = RedisKeys.msgDedup(messageId);
    const dedupState = await this.redis.get(dedupKey);

    if (dedupState === 'done') {
      this.log.state(
        'Duplicate ignored (already done)',
        { msgId: messageId },
        cid,
      );
      return [{ text: '[duplicate ignored]', skipSend: true }];
    }

    if (dedupState === 'processing') {
      this.log.state('Message still processing', { msgId: messageId }, cid);
      return [{ text: 'Procesando tu mensaje...' }];
    }

    // Set "processing" with short TTL (120s) - expires if crash
    await this.redis.set(dedupKey, 'processing', RedisTTL.MSG_DEDUP_PROCESSING);

    // 4. CONCURRENCY LOCK: Only one message per user at a time
    const lockKey = RedisKeys.lock(userId);
    const lockAcquired = await this.redis.acquireLock(
      lockKey,
      RedisTTL.LOCK * 1000,
    );

    if (!lockAcquired) {
      this.log.warn('Lock not acquired, user busy', { userId }, cid);
      await this.redis.del(dedupKey);
      return [{ text: 'Dame un momento, aún proceso tu mensaje anterior...' }];
    }

    try {
      const { replies, metrics } = await this.processMessage(cid, userId, m);

      // Bug D fix: ensure at least one reply
      if (!replies.length || !replies.some(r => !r.skipSend && r.text?.trim())) {
        replies.push({ text: 'No entendí tu mensaje. ¿Puedes reformularlo?' });
      }

      // SUCCESS: Mark dedup as "done" with 24h TTL
      await this.redis.set(dedupKey, 'done', RedisTTL.MSG_DEDUP_DONE);

      const firstText = replies.find((r) => !r.skipSend)?.text ?? '';
      this.log.send(
        'Response ready',
        { replies: replies.length, totalMs: metrics.totalMs },
        cid,
      );
      return replies;
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
  ): Promise<{ replies: BotReply[]; reply: string; metrics: ProcessingMetrics }> {
    const cid = this.generateCorrelationId();
    this.log.separator(cid);
    this.log.recv(
      'Test message',
      { userId, text: m.text.substring(0, 50) },
      cid,
    );
    const { replies, metrics } = await this.processMessage(cid, userId, m);
    const reply = replies.filter((r) => !r.skipSend).map((r) => r.text).join('\n\n');
    return { replies, reply, metrics };
  }

  private async processMessage(
    cid: string,
    userId: string,
    m: DomainMessage,
  ): Promise<{ replies: BotReply[]; metrics: ProcessingMetrics }> {
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
      return { replies: [{ text: 'En mantenimiento.' }], metrics };
    }

    try {
      // 1. LOAD ALL STATE BEFORE PROCESSING (transaction-like behavior)
      const contextTimer = this.log.timer('Context loaded', cid);
      const [context, sessionSummary, pending, userMetrics, cooldownFlags, history, existingBlock] =
        await Promise.all([
          this.userContext.getContext(userId),
          this.conversation.getSessionSummary(userId),
          this.conversation.getPending(userId),
          this.metricsService.getMetrics(userId),
          this.cooldowns.getCooldownFlags(userId),
          this.historyService.getHistory(userId),
          this.conversation.getBlock(userId),
        ]);
      metrics.contextMs = Date.now() - startTotal;
      contextTimer();

      if (pending) {
        this.log.pending(
          'Pending slot-fill found',
          {
            tool: pending.tool,
            collected: Object.keys(pending.collectedArgs).join(','),
            missing: pending.missingArgs.join(','),
          },
          cid,
        );
      }

      if (existingBlock) {
        this.log.state(
          `Existing ActionBlock found id=${existingBlock.id} items=${existingBlock.items.length}`,
          undefined,
          cid,
        );
      }

      // 1b. Frustration detection: if 3+ consecutive failures, clear state and help
      if (sessionSummary.failedAttempts >= 3) {
        this.log.warn(
          `Frustration detected: ${sessionSummary.failedAttempts} consecutive failures`,
          undefined,
          cid,
        );
        await Promise.all([
          this.conversation.clearPending(userId),
          this.conversation.clearBlock(userId),
        ]);
        sessionSummary.failedAttempts = 0;
        await this.conversation.updateSessionSummary(userId, {
          tool: 'frustration_reset',
          success: true,
        });
        const helpMsg = 'Parece que algo no funcionó. Intenta con: "gasté [monto] en [categoría]" o "registra [monto] como ingreso".';
        this.saveHistoryAsync(userId, m.text, helpMsg, undefined, undefined, m.channel);
        return {
          replies: [{ text: helpMsg, parseMode: 'HTML' }],
          metrics: { ...metrics, totalMs: Date.now() - startTotal },
        };
      }

      // 2. Detect user style from message
      const userStyle = this.styleDetector.detect(m.text);

      // 3. Get tool schemas
      const tools = this.toolRegistry.getToolSchemas();

      // 4. Extract available categories for Phase A matching
      const availableCategories: string[] =
        context.categories?.map((c) => c.name) ?? [];

      // 5. If there is an existing ActionBlock with needs_info items, resume it
      // Pass the first needs_info item as a PendingSlotContext so Phase A can fill it
      let pendingContextForPhaseA = toPendingSlotContext(pending);
      if (existingBlock) {
        const needsInfoItem = existingBlock.items.find(
          (i) => i.status === 'needs_info',
        );
        if (needsInfoItem && needsInfoItem.question) {
          pendingContextForPhaseA = {
            tool: needsInfoItem.tool,
            collected_args: needsInfoItem.args ?? {},
            missing_args: needsInfoItem.missing ?? [],
            asked_at: existingBlock.createdAt,
          };
          this.log.state(
            `[block:resume] Passing item:${needsInfoItem.id} as pending to Phase A`,
            undefined,
            cid,
          );
        }
      }

      // 6. Phase A: AI decides what to do
      const phaseATimer = this.log.timer('Phase A', cid);
      const phaseA = await this.orchestrator.phaseA(
        m.text,
        context,
        tools,
        pendingContextForPhaseA,
        availableCategories,
        history,
        m.media,
      );
      metrics.phaseAMs = Date.now() - startTotal - metrics.contextMs;
      phaseATimer();

      metrics.phaseAResponse = phaseA;
      this.log.phaseA('Decision', { type: phaseA.response_type }, cid);

      // =====================================================================
      // DIRECT REPLIES (no tool, no Phase B)
      // =====================================================================

      if (phaseA.response_type === 'direct_reply') {
        metrics.totalMs = Date.now() - startTotal;
        this.log.ok('Direct reply', { ms: metrics.totalMs }, cid);
        this.logMessageAsync(
          userId,
          m.channel,
          m.text,
          phaseA.direct_reply!,
          null,
          phaseA as unknown as Record<string, unknown>,
          null,
          null,
        );
        this.saveHistoryAsync(userId, m.text, phaseA.direct_reply!, undefined, undefined, m.channel);
        return { replies: [{ text: phaseA.direct_reply!, parseMode: 'HTML' }], metrics };
      }

      if (phaseA.response_type === 'clarification') {
        metrics.totalMs = Date.now() - startTotal;
        this.log.slot(
          'Clarification needed',
          { text: phaseA.clarification?.substring(0, 50) },
          cid,
        );
        this.logMessageAsync(
          userId,
          m.channel,
          m.text,
          phaseA.clarification!,
          null,
          phaseA as unknown as Record<string, unknown>,
          null,
          null,
        );
        this.saveHistoryAsync(userId, m.text, phaseA.clarification!, undefined, undefined, m.channel);
        return { replies: [{ text: phaseA.clarification!, parseMode: 'HTML' }], metrics };
      }

      // =====================================================================
      // NEW PATH: response_type === 'actions' (multi-action pipeline)
      // =====================================================================

      // Fix: Gemini sometimes returns response_type="actions" with empty actions[]
      // but puts the actual data in tool_call. Normalize this before routing.
      if (phaseA.response_type === 'actions' && !phaseA.actions?.length && phaseA.tool_call) {
        this.log.warn(
          'Phase A returned actions with empty array + tool_call — normalizing to tool_call',
          undefined,
          cid,
        );
        phaseA.response_type = 'tool_call';
      }

      if (phaseA.response_type === 'actions' && phaseA.actions?.length) {
        return await this.processActionsPath(
          cid,
          userId,
          m,
          context,
          phaseA,
          existingBlock,
          userMetrics,
          cooldownFlags,
          sessionSummary,
          userStyle,
          history,
          metrics,
          startTotal,
        );
      }

      // =====================================================================
      // LEGACY PATH: response_type === 'tool_call'
      // If there's an existing block with needs_info and Phase A returned
      // tool_call, it means the user answered the slot-fill question.
      // Apply the answer to the block item and process the block.
      // =====================================================================

      if (existingBlock) {
        const needsInfoItem = existingBlock.items.find(
          (i) => i.status === 'needs_info',
        );
        if (needsInfoItem && phaseA.response_type === 'tool_call' && phaseA.tool_call) {
          // Merge Phase A args into the block item (answer to slot-fill)
          needsInfoItem.args = {
            ...needsInfoItem.args,
            ...phaseA.tool_call.args,
          };
          needsInfoItem.status = 'ready';
          this.log.state(
            `[block:slot-fill] item:${needsInfoItem.id} updated with Phase A args`,
            undefined,
            cid,
          );
          // Re-use actions path with updated block
          return await this.processActionsPath(
            cid,
            userId,
            m,
            context,
            { ...phaseA, response_type: 'actions', actions: [] },
            existingBlock,
            userMetrics,
            cooldownFlags,
            sessionSummary,
            userStyle,
            history,
            metrics,
            startTotal,
          );
        }
      }

      // =====================================================================
      // SINGLE-ACTION TEMPLATE PATH: action tools via unified template format
      // When Phase A returns tool_call for an action tool (no pending slot-fill),
      // wrap it as a 1-item ActionBlock so it uses the same template as multi-action.
      // =====================================================================

      const ACTION_TOOLS_FOR_TEMPLATE = new Set([
        'register_transaction',
        'manage_categories',
        'manage_transactions',
      ]);

      if (ACTION_TOOLS_FOR_TEMPLATE.has(phaseA.tool_call?.name ?? '') && !pending) {
        return await this.processActionsPath(
          cid,
          userId,
          m,
          context,
          {
            ...phaseA,
            response_type: 'actions',
            actions: [
              {
                id: 1,
                tool: phaseA.tool_call!.name,
                args: phaseA.tool_call!.args ?? {},
                status: 'ready',
              },
            ],
          },
          null,
          userMetrics,
          cooldownFlags,
          sessionSummary,
          userStyle,
          history,
          metrics,
          startTotal,
        );
      }

      // =====================================================================
      // LEGACY PATH (single tool_call, no block)
      // Used for: query tools (ask_balance, etc.), greeting, ask_app_info,
      // and action tools when slot-fill pending state exists.
      // =====================================================================

      const toolCall = phaseA.tool_call!;
      metrics.toolName = toolCall.name;
      this.log.tool(`Calling ${toolCall.name}`, { args: toolCall.args }, cid);

      // 7. Validate arguments with Guardrails
      const validation = this.guardrails.validate(toolCall);
      if (!validation.valid) {
        this.log.warn('Guardrails rejected', { error: validation.error }, cid);
        metrics.totalMs = Date.now() - startTotal;

        let guardrailReply =
          'No pude procesar tu solicitud. ¿Podrías intentar de nuevo con más detalle?';
        if (
          toolCall.name === 'register_transaction' &&
          validation.error?.includes('amount')
        ) {
          guardrailReply = '¿Cuánto fue el gasto exactamente?';
        }

        this.logMessageAsync(
          userId,
          m.channel,
          m.text,
          guardrailReply,
          toolCall.name,
          phaseA as unknown as Record<string, unknown>,
          null,
          `Guardrails: ${validation.error}`,
        );
        return { replies: [{ text: guardrailReply }], metrics };
      }

      // 8. Execute tool handler
      const toolTimer = this.log.timer(`Tool ${toolCall.name}`, cid);
      const handler = this.toolRegistry.getHandler(toolCall.name);
      const sanitizedArgs = validation.sanitized?.args ?? toolCall.args;

      if (
        (toolCall.name === 'register_transaction' ||
          toolCall.name === 'manage_transactions') &&
        context.categories?.length
      ) {
        sanitizedArgs._categories = context.categories;
      }

      const result = await handler.execute(userId, m, sanitizedArgs);
      metrics.toolMs =
        Date.now() - startTotal - metrics.contextMs - metrics.phaseAMs;
      metrics.toolResult = result;
      toolTimer();

      this.log.tool(
        `Result: ${result.ok ? 'success' : 'failed'}`,
        { action: result.action },
        cid,
      );

      // 9. Metrics AFTER tool success only (not slot-fill returns)
      if (toolCall.name === 'register_transaction' && result.ok && !result.userMessage) {
        await this.metricsService.recordTransaction(userId);
        this.log.state('Transaction metrics recorded', undefined, cid);
      }

      if (
        toolCall.name === 'manage_categories' &&
        result.ok &&
        result.data?.operation === 'create_and_register'
      ) {
        await this.metricsService.recordTransaction(userId);
        this.log.state('Transaction metrics recorded (via category creation)', undefined, cid);
      }

      if (
        toolCall.name === 'manage_categories' &&
        result.ok &&
        !result.userMessage
      ) {
        await this.userContext.invalidate(userId);
        this.log.state('Context cache invalidated (category mutation)', undefined, cid);
      }

      // 9d. CATEGORY_NOT_FOUND: forward to Phase B for natural question
      if (!result.ok && result.errorCode === 'CATEGORY_NOT_FOUND') {
        this.log.state('CATEGORY_NOT_FOUND — forwarding to Phase B', {
          attemptedCategory: result.data?.attemptedCategory,
          amount: result.data?.amount,
        }, cid);

        const updatedSummary = await this.conversation.updateSessionSummary(userId, {
          tool: toolCall.name,
          success: false,
        });
        const runtimeContext = this.buildRuntimeContext(
          context, userMetrics, cooldownFlags, userStyle, updatedSummary,
        );
        const phaseBUserText = this.buildPhaseBUserText(m, toolCall.name, toolCall.args);

        let phaseBMsg: string;
        try {
          const phaseB = await this.orchestrator.phaseB(
            toolCall.name, result, context, runtimeContext, phaseBUserText, history,
          );
          phaseBMsg = phaseB.final_message;
        } catch {
          phaseBMsg = `No encontré la categoría "${result.data?.attemptedCategory}". ¿La creo como nueva?`;
        }

        metrics.totalMs = Date.now() - startTotal;
        this.logMessageAsync(userId, m.channel, m.text, phaseBMsg, toolCall.name,
          phaseA as unknown as Record<string, unknown>, null, null);
        this.saveHistoryAsync(userId, m.text, phaseBMsg, {
          tool: 'register_transaction',
          action: 'category_not_found',
          attemptedCategory: result.data?.attemptedCategory,
          amount: result.data?.amount,
        }, m.media, m.channel);
        return { replies: [{ text: phaseBMsg, parseMode: 'HTML' }], metrics };
      }

      // 10. Slot-fill: save pending state and return
      if (result.userMessage) {
        if (result.pending) {
          await this.conversation.setPending(userId, {
            tool: toolCall.name,
            collectedArgs: result.pending.collectedArgs,
            missingArgs: result.pending.missingArgs,
            askedAt: new Date().toISOString(),
          });
          this.log.pending(
            'Saved pending state',
            {
              collected: Object.keys(result.pending.collectedArgs).join(','),
              missing: result.pending.missingArgs.join(','),
            },
            cid,
          );
        }

        metrics.totalMs = Date.now() - startTotal;
        this.log.slot(
          'Slot-fill prompt',
          { response: result.userMessage.substring(0, 50) },
          cid,
        );
        this.logMessageAsync(
          userId,
          m.channel,
          m.text,
          result.userMessage,
          toolCall.name,
          phaseA as unknown as Record<string, unknown>,
          null,
          null,
        );
        this.saveHistoryAsync(userId, m.text, result.userMessage, {
          tool: toolCall.name,
          slotFill: true,
        }, m.media, m.channel);
        return { replies: [{ text: result.userMessage }], metrics };
      }

      // 10b. Update session summary after tool execution
      const updatedSummary = await this.conversation.updateSessionSummary(userId, {
        tool: toolCall.name,
        success: result.ok && !result.userMessage,
        amount: result.data?.amount ?? result.data?.transaction?.amount,
        category: result.data?.category ?? result.data?.transaction?.category,
        txId: result.data?.id ?? result.data?.transaction?.id,
        txType: result.data?.type ?? result.data?.transaction?.type,
        hasMedia: !!m.media?.length,
      });

      // 11. Build RuntimeContext for Phase B
      const runtimeContext = this.buildRuntimeContext(
        context,
        userMetrics,
        cooldownFlags,
        userStyle,
        updatedSummary,
      );

      // 12. Build user text for Phase B (for media messages)
      const phaseBUserText = this.buildPhaseBUserText(m, toolCall.name, toolCall.args);

      const phaseBTimer = this.log.timer('Phase B', cid);
      let phaseB;
      try {
        phaseB = await this.orchestrator.phaseB(
          toolCall.name,
          result,
          context,
          runtimeContext,
          phaseBUserText,
          history,
        );
      } catch (phaseBError) {
        this.log.err(
          'Phase B failed after tool success',
          { error: String(phaseBError) },
          cid,
        );
        metrics.phaseBMs =
          Date.now() -
          startTotal -
          metrics.contextMs -
          metrics.phaseAMs -
          metrics.toolMs;
        metrics.totalMs = Date.now() - startTotal;
        const phaseBFailReply =
          'Listo. (No pude generar un mensaje personalizado)';
        this.logMessageAsync(
          userId,
          m.channel,
          m.text,
          phaseBFailReply,
          toolCall.name,
          phaseA as unknown as Record<string, unknown>,
          null,
          `Phase B failed: ${String(phaseBError)}`,
        );
        return { replies: [{ text: phaseBFailReply }], metrics };
      }
      metrics.phaseBMs =
        Date.now() -
        startTotal -
        metrics.contextMs -
        metrics.phaseAMs -
        metrics.toolMs;
      phaseBTimer();

      this.log.phaseB(
        'Response generated',
        { length: phaseB.final_message.length },
        cid,
      );

      // Summary is now deterministic (SessionSummary), updated before Phase B

      // 14. Cooldowns AFTER Phase B AND did_nudge=true
      if (phaseB.did_nudge && phaseB.nudge_type) {
        await this.cooldowns.recordNudge(userId, phaseB.nudge_type);
        this.log.state('Nudge recorded', { type: phaseB.nudge_type }, cid);
      }

      // 15. Clear pending if slot-fill was in progress and same tool completed
      if (pending && result.ok && toolCall.name === pending.tool) {
        await this.conversation.clearPending(userId);
        this.log.state('Pending cleared', undefined, cid);
      }

      metrics.totalMs = Date.now() - startTotal;
      this.log.ok(
        'Flow complete',
        {
          context: `${metrics.contextMs}ms`,
          phaseA: `${metrics.phaseAMs}ms`,
          tool: `${metrics.toolMs}ms`,
          phaseB: `${metrics.phaseBMs}ms`,
          total: `${metrics.totalMs}ms`,
        },
        cid,
      );

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

      this.saveHistoryAsync(
        userId,
        m.text,
        phaseB.final_message,
        this.buildHistoryMetadata(toolCall.name, result),
        m.media,
        m.channel,
      );

      return { replies: [{ text: phaseB.final_message, parseMode: 'HTML' }], metrics };
    } catch (err) {
      metrics.totalMs = Date.now() - startTotal;

      if (err instanceof OrchestratorError) {
        this.log.err(
          `Orchestrator: ${err.code}`,
          { message: err.message },
          cid,
        );

        if (err.code === 'COLD_START') {
          this.log.warn('😴 AI Service cold start detected', undefined, cid);
          const coldStartReply =
            '😴💤 Estoy despertando, dame un momento... Envía tu mensaje de nuevo en unos segundos.';
          this.logMessageAsync(
            userId ?? null,
            m.channel,
            m.text,
            coldStartReply,
            metrics.toolName ?? null,
            null,
            null,
            `COLD_START: ${err.message}`,
          );
          return { replies: [{ text: coldStartReply }], metrics };
        }

        const errorMessages: Record<string, string> = {
          LLM_TIMEOUT:
            '😪 Estoy un poco lento... Intenta de nuevo en unos segundos.',
          INVALID_RESPONSE:
            'Recibí una respuesta inesperada. ¿Podrías reformular tu mensaje?',
          LLM_ERROR:
            '😴 Tuve un problema respondiendo. Intenta de nuevo en unos momentos.',
        };

        const errorReply =
          errorMessages[err.code] ??
          'Hubo un problema procesando tu solicitud.';
        this.logMessageAsync(
          userId ?? null,
          m.channel,
          m.text,
          errorReply,
          metrics.toolName ?? null,
          null,
          null,
          `${err.code}: ${err.message}`,
        );
        return { replies: [{ text: errorReply }], metrics };
      }

      this.log.err('Unexpected error', { error: String(err) }, cid);
      const unexpectedReply = 'Hubo un error procesando tu solicitud.';
      this.logMessageAsync(
        userId ?? null,
        m.channel,
        m.text,
        unexpectedReply,
        metrics.toolName ?? null,
        null,
        null,
        String(err),
      );
      return { replies: [{ text: unexpectedReply }], metrics };
    }
  }

  // ===========================================================================
  // NEW PATH: Multi-action ActionBlock pipeline
  // ===========================================================================

  private async processActionsPath(
    cid: string,
    userId: string,
    m: DomainMessage,
    context: any,
    phaseA: PhaseAResponse,
    existingBlock: ActionBlock | null,
    userMetrics: any,
    cooldownFlags: any,
    sessionSummary: SessionSummary,
    userStyle: any,
    history: any,
    metrics: ProcessingMetrics,
    startTotal: number,
  ): Promise<{ replies: BotReply[]; metrics: ProcessingMetrics }> {
    const replies: BotReply[] = [];

    // Build or resume ActionBlock
    // If Phase A returned new actions, those take priority — discard old block.
    // Only resume existingBlock when Phase A sent NO new actions (slot-fill answer).
    let block: ActionBlock;
    const phaseAItems = phaseA.actions ?? [];
    const hasNewActions = phaseAItems.length > 0;

    if (existingBlock && !hasNewActions) {
      // Resume: slot-fill case — Phase A returned no new actions, just continue the block
      block = existingBlock;
      this.log.state(`[actions] Resuming block ${block.id}`, undefined, cid);
    } else {
      // New block from Phase A actions (discard old block if any)
      if (existingBlock) {
        await this.conversation.clearBlock(userId);
        this.log.state(
          `[actions] Discarded stale block ${existingBlock.id} — new actions from Phase A`,
          undefined,
          cid,
        );
      }

      const limitedItems = phaseAItems.slice(0, 3); // maxItems=3
      const skippedCount = phaseAItems.length - limitedItems.length;

      const blockItems = limitedItems.map((ai, idx) => ({
        id: ai.id ?? idx,
        tool: ai.tool,
        type: getItemType(ai.tool),
        args: ai.args ?? {},
        status: ai.status ?? 'ready' as const,
        missing: ai.missing,
        question: ai.question,
        dependsOn: ai.depends_on,
        attempts: 0,
      }));

      block = ActionPlannerService.createBlock(blockItems);
      this.log.state(
        `[actions] New block ${block.id} with ${block.items.length} items`,
        undefined,
        cid,
      );

      if (skippedCount > 0) {
        const skippedItems = phaseAItems.slice(3).map((ai, idx) => ({
          id: ai.id ?? (3 + idx),
          tool: ai.tool,
          type: getItemType(ai.tool),
          args: ai.args ?? {},
          status: ai.status ?? 'ready' as const,
          missing: ai.missing,
          question: ai.question,
          dependsOn: ai.depends_on,
          attempts: 0,
        }));
        const limitMsg = this.responseBuilder.buildLimitMessage(skippedItems);
        if (limitMsg.text) replies.push(limitMsg);
      }
    }

    // Process the block
    const toolTimer = this.log.timer('ActionPlanner', cid);
    const plannerResult = await this.actionPlanner.processBlock(
      userId,
      block,
      context,
      m,
      cid,
    );
    metrics.toolMs =
      Date.now() - startTotal - metrics.contextMs - metrics.phaseAMs;
    toolTimer();

    // Add planner replies (confirmations, questions, abandonment notes)
    replies.push(...plannerResult.replies);

    // Record metrics for all executed transactions at once (block-level)
    if (plannerResult.executedCount > 0) {
      const txItems = plannerResult.updatedBlock.items.filter(
        (i) => i.status === 'executed' && i.tool === 'register_transaction',
      );
      if (txItems.length > 0) {
        await this.metricsService.recordTransactions(userId, txItems.length);
        this.log.state(
          `Transaction metrics recorded (${txItems.length} tx)`,
          undefined,
          cid,
        );
      }

      // Invalidate context cache if category mutations happened
      const catItems = plannerResult.updatedBlock.items.filter(
        (i) => i.status === 'executed' && i.tool === 'manage_categories',
      );
      if (catItems.length > 0) {
        await this.userContext.invalidate(userId);
        this.log.state('Context cache invalidated (category mutation)', undefined, cid);
      }
    }

    // Update session summary for each executed item
    for (const item of plannerResult.updatedBlock.items.filter(i => i.status === 'executed')) {
      await this.conversation.updateSessionSummary(userId, {
        tool: item.tool,
        success: true,
        amount: item.result?.data?.amount ?? item.args?.amount,
        category: item.result?.data?.category ?? item.args?.category,
        txId: item.result?.data?.id ?? item.result?.data?.transaction?.id,
        txType: item.result?.data?.type ?? item.args?.type,
        hasMedia: !!m.media?.length,
      });
    }
    // Track failed items
    for (const item of plannerResult.updatedBlock.items.filter(i => i.status === 'failed')) {
      await this.conversation.updateSessionSummary(userId, {
        tool: item.tool,
        success: false,
      });
    }

    // Save or clear block
    if (plannerResult.blockClosed) {
      await this.conversation.clearBlock(userId);
      this.log.state(`[block:closed] id=${block.id}`, undefined, cid);
    } else {
      await this.conversation.setBlock(userId, plannerResult.updatedBlock);
      this.log.state(
        `[block:saved] id=${block.id} pending=${plannerResult.pendingCount}`,
        undefined,
        cid,
      );
    }

    // If block still open (pending items), return early — no Phase B
    if (!plannerResult.blockClosed) {
      metrics.totalMs = Date.now() - startTotal;
      const combinedText = replies.filter((r) => !r.skipSend).map((r) => r.text).join('\n');
      this.logMessageAsync(
        userId,
        m.channel,
        m.text,
        combinedText,
        'multi-action',
        phaseA as unknown as Record<string, unknown>,
        null,
        null,
      );
      return { replies, metrics };
    }

    // If no actual actions were executed (only queries or greeting), skip closing
    const executedItems = plannerResult.updatedBlock.items.filter(
      (i) => i.status === 'executed',
    );

    if (executedItems.length === 0) {
      metrics.totalMs = Date.now() - startTotal;
      const combinedText = replies.filter((r) => !r.skipSend).map((r) => r.text).join('\n');
      this.logMessageAsync(
        userId,
        m.channel,
        m.text,
        combinedText,
        'multi-action',
        phaseA as unknown as Record<string, unknown>,
        null,
        null,
      );
      return { replies, metrics };
    }

    // Block closed — evaluate nudges FIRST to decide closing strategy
    const nudgeReplies = plannerResult.executedCount > 0
      ? this.evaluateNudges(context, userMetrics, cooldownFlags, plannerResult.updatedBlock)
      : [];
    const hasNudge = nudgeReplies.length > 0;

    const primaryTool = this.actionPlanner.getPrimaryTool(executedItems);
    const primaryItem = executedItems.find((i) => i.tool === primaryTool)!;
    const primaryResult: ActionResult = primaryItem.result ?? {
      ok: true,
      action: primaryTool as ActionType,
      data: {},
    };

    let phaseB: any = null;

    if (hasNudge) {
      // Nudge IS the closing message — skip Phase B entirely (saves latency)
      replies.push(...nudgeReplies);
      this.log.state('Nudge replaces Phase B as closing', undefined, cid);
    } else {
      // No nudge — call Phase B for brief personalized closing
      const runtimeContext = this.buildRuntimeContext(
        context,
        userMetrics,
        cooldownFlags,
        userStyle,
        sessionSummary,
        plannerResult.summaryForPhaseB,
      );

      const phaseBTimer = this.log.timer('Phase B (closing)', cid);
      try {
        phaseB = await this.orchestrator.phaseB(
          primaryTool,
          primaryResult,
          context,
          runtimeContext,
          m.text || plannerResult.summaryForPhaseB,
          history,
        );
      } catch (phaseBError) {
        this.log.err(
          'Phase B (closing) failed',
          { error: String(phaseBError) },
          cid,
        );
      }
      metrics.phaseBMs =
        Date.now() -
        startTotal -
        metrics.contextMs -
        metrics.phaseAMs -
        metrics.toolMs;
      phaseBTimer();

      if (phaseB?.final_message) {
        // Sanitize: strip duplicate confirmation lines (✅, $, montos)
        // Phase B should only generate brief closing, but LLMs sometimes repeat
        const closingText = phaseB.final_message
          .split('\n')
          .filter((line: string) => {
            const trimmed = line.trim();
            // Remove lines that look like template confirmations
            if (trimmed.startsWith('✅')) return false;
            if (/^\$[\d.,]+/.test(trimmed)) return false;
            if (/^💰|^🍽️|^🚗|^💊|^📚|^🎬|^🏠|^👕|^📱|^💼|^💳/.test(trimmed)) return false;
            return true;
          })
          .join('\n')
          .trim();

        if (closingText) {
          replies.push({ text: closingText, parseMode: 'HTML' });
          this.log.phaseB(
            'Closing message generated',
            { length: closingText.length },
            cid,
          );
        }

        // Summary is now deterministic (SessionSummary), updated after tool execution
      }
    }

    // Record nudge cooldowns (whether from backend nudge or Phase B nudge)
    if (hasNudge) {
      // Backend nudge — record cooldown for the nudge types we sent
      for (const nr of nudgeReplies) {
        const nudgeType = nr.text.includes('presupuesto') ? 'budget' : 'streak';
        await this.cooldowns.recordNudge(userId, nudgeType);
      }
    }

    metrics.totalMs = Date.now() - startTotal;
    this.log.ok(
      'Actions flow complete',
      {
        executed: plannerResult.executedCount,
        nudge: hasNudge,
        context: `${metrics.contextMs}ms`,
        phaseA: `${metrics.phaseAMs}ms`,
        tool: `${metrics.toolMs}ms`,
        phaseB: `${metrics.phaseBMs}ms`,
        total: `${metrics.totalMs}ms`,
      },
      cid,
    );

    const combinedText = replies.filter((r) => !r.skipSend).map((r) => r.text).join('\n');
    this.logMessageAsync(
      userId,
      m.channel,
      m.text,
      combinedText,
      primaryTool,
      phaseA as unknown as Record<string, unknown>,
      phaseB as unknown as Record<string, unknown> ?? null,
      null,
    );

    this.saveHistoryAsync(
      userId,
      m.text,
      combinedText,
      this.buildHistoryMetadata(primaryTool, primaryResult),
      m.media,
      m.channel,
    );

    // Bug D fix: ensure at least one reply
    if (!replies.length || !replies.some(r => !r.skipSend && r.text?.trim())) {
      replies.push({ text: 'No entendí tu mensaje. ¿Puedes reformularlo?' });
    }

    return { replies, metrics };
  }

  // ===========================================================================
  // Nudge evaluation (called after block closes, before Phase B)
  // ===========================================================================

  private evaluateNudges(
    context: any,
    userMetrics: any,
    cooldownFlags: any,
    _block: ActionBlock,
  ): BotReply[] {
    const nudges: BotReply[] = [];

    // Budget warning (5h cooldown)
    if (cooldownFlags.canBudgetWarning) {
      const budget = context.activeBudget;
      if (budget?.amount && budget.spent != null) {
        const percent = budget.spent / budget.amount;
        if (percent >= 0.8) {
          const nudge = this.responseBuilder.buildBudgetNudge(percent);
          if (nudge.text) nudges.push(nudge);
        }
      }
    }

    // Streak celebration (24h global cooldown)
    if (cooldownFlags.canNudge && userMetrics.txStreakDays >= 7) {
      const nudge = this.responseBuilder.buildStreakNudge(userMetrics.txStreakDays);
      if (nudge.text) nudges.push(nudge);
    }

    return nudges;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private serializeSessionSummary(ss: SessionSummary, blockSummary?: string): string {
    const parts: string[] = [];
    if (ss.todayTxCount > 0) {
      parts.push(`Hoy: ${ss.todayTxCount} transacciones, $${ss.todayTotalSpent} gastado, $${ss.todayTotalIncome} ingresado`);
    }
    if (ss.todayCategories.length > 0) {
      parts.push(`Categorías hoy: ${ss.todayCategories.join(', ')}`);
    }
    if (ss.lastTool) {
      parts.push(`Última acción: ${ss.lastTool}`);
    }
    if (ss.sessionTopics.length > 0) {
      parts.push(`Temas: ${ss.sessionTopics.join(', ')}`);
    }
    if (blockSummary) {
      parts.push(blockSummary);
    }
    return parts.join('. ') || '';
  }

  private buildRuntimeContext(
    context: any,
    userMetrics: any,
    cooldownFlags: any,
    userStyle: any,
    sessionSummary: SessionSummary,
    blockSummary?: string,
  ): RuntimeContext {
    const budgetPercent =
      context.activeBudget?.amount && context.activeBudget.spent != null
        ? context.activeBudget.spent / context.activeBudget.amount
        : null;

    const moodHint = this.metricsService.calculateMoodHint(context, userMetrics);

    return {
      summary: this.serializeSessionSummary(sessionSummary, blockSummary) || undefined,
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
  }

  private buildPhaseBUserText(
    m: DomainMessage,
    toolName: string,
    args: Record<string, any>,
  ): string {
    if (!m.media?.length || (m.text && !m.text.startsWith('IMPORTANTE:'))) {
      return m.text;
    }
    if (toolName === 'register_transaction' && args.amount) {
      const cat = args.category || '';
      const name = args.name || '';
      return `Registrar $${args.amount} en ${cat}${name ? ` (${name})` : ''}`;
    }
    if (toolName === 'manage_categories') {
      const op = args.operation || 'gestionar';
      const name = args.name || '';
      return `${op === 'create' ? 'Crear categoría' : op === 'delete' ? 'Eliminar categoría' : op === 'rename' ? 'Renombrar categoría' : 'Gestionar categorías'} ${name}`.trim();
    }
    if (toolName === 'manage_transactions') {
      const op = args.operation || '';
      return `${op === 'list' ? 'Ver mis transacciones' : op === 'edit' ? 'Editar transacción' : op === 'delete' ? 'Eliminar transacción' : 'Gestionar transacciones'}`;
    }
    if (toolName === 'ask_balance') return 'Consultar mi balance';
    if (toolName === 'ask_budget_status') return 'Ver mi presupuesto';
    if (toolName === 'ask_goal_status') return 'Ver mis metas';
    return '[Solicitud por mensaje de voz]';
  }

  private generateCorrelationId(): string {
    return randomUUID().substring(0, 8);
  }

  private saveHistoryAsync(
    userId: string,
    userMessage: string,
    assistantMessage: string,
    metadata?: ConversationMessageMetadata,
    media?: MediaAttachment[],
    channel: string = 'test',
  ): void {
    // Convert MediaAttachment[] to lightweight MediaReference[] (no base64)
    const mediaRefs = media?.length
      ? media.map((m) => ({
          type: m.type as 'image' | 'audio' | 'document',
          mimeType: m.mimeType,
          fileName: m.fileName,
        }))
      : undefined;

    // Tier 1: Redis working memory
    this.historyService
      .appendWithMetadata(userId, userMessage, assistantMessage, metadata, mediaRefs)
      .catch((err) => {
        console.error('[BotService] Failed to save history:', err);
      });

    // Tier 3: Supabase long-term memory (fire-and-forget)
    const mediaType = media?.[0]?.type ?? undefined;
    const mediaDesc = media?.[0]?.fileName ?? undefined;
    this.conversationLog
      .logExchange(
        { userId, role: 'user', content: userMessage, channel, mediaType, mediaDesc },
        {
          userId,
          role: 'assistant',
          content: assistantMessage,
          channel,
          tool: metadata?.tool,
          action: metadata?.action,
          amount: metadata?.amount,
          category: metadata?.category,
          txId: metadata?.txId,
        },
      )
      .catch((err) => {
        console.error('[BotService] Failed to log conversation:', err);
      });
  }

  private buildHistoryMetadata(
    toolName: string,
    result: ActionResult,
  ): ConversationMessageMetadata {
    const meta: ConversationMessageMetadata = { tool: toolName };
    if (!result.data) return meta;
    const d = result.data;
    switch (toolName) {
      case 'register_transaction':
        if (!result.ok && result.errorCode === 'CATEGORY_NOT_FOUND') {
          meta.action = 'category_not_found';
          meta.attemptedCategory = d.attemptedCategory;
          meta.amount = d.amount;
        } else {
          meta.action = d.type === 'income' ? 'income_registered' : 'expense_registered';
          meta.amount = d.amount ?? d.transaction?.amount;
          meta.category = d.category ?? d.transaction?.category;
          meta.txId = d.id ?? d.transaction?.id;
        }
        break;
      case 'manage_transactions':
        meta.action = `transaction_${d.operation ?? 'unknown'}`;
        meta.amount = d.deleted?.amount ?? d.previous?.amount;
        meta.txId = d.transaction_id ?? d.deleted?.transaction_id ?? d.deleted?.id;
        break;
      case 'manage_categories':
        meta.action = `category_${d.operation ?? 'unknown'}`;
        if (d.transaction) {
          meta.amount = d.transaction.amount;
          meta.txId = d.transaction.id ?? d.transaction.transaction_id;
        }
        break;
      case 'ask_balance':
        meta.action = 'balance_queried';
        break;
      case 'ask_budget_status':
        meta.action = 'budget_queried';
        break;
      case 'ask_goal_status':
        meta.action = 'goals_queried';
        break;
    }
    return meta;
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
    this.messageLog
      .log({
        userId,
        channel,
        userMessage,
        botResponse,
        toolName,
        phaseADebug,
        phaseBDebug,
        error,
      })
      .catch((err) => {
        console.error('[BotService] Failed to log message:', err);
      });
  }
}
