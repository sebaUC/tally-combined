import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DomainMessage } from './contracts';
import { BotChannelService } from './delegates/bot-channel.service';
import { UserContextService } from './services/user-context.service';
import { ConversationService } from './services/conversation.service';
import { ConversationHistoryService } from './services/conversation-history.service';
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
      const [context, summary, pending, userMetrics, cooldownFlags, history, existingBlock] =
        await Promise.all([
          this.userContext.getContext(userId),
          this.conversation.getSummary(userId),
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
        this.saveHistoryAsync(userId, m.text, phaseA.direct_reply!);
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
        this.saveHistoryAsync(userId, m.text, phaseA.clarification!);
        return { replies: [{ text: phaseA.clarification!, parseMode: 'HTML' }], metrics };
      }

      // =====================================================================
      // NEW PATH: response_type === 'actions' (multi-action pipeline)
      // =====================================================================

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
          summary,
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
            summary,
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
          summary,
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

      // 9d. Auto-complete pending register_transaction after category creation
      if (
        toolCall.name === 'manage_categories' &&
        result.ok &&
        !result.userMessage &&
        result.data?.operation === 'create' &&
        pending?.tool === 'register_transaction' &&
        pending.collectedArgs.amount
      ) {
        const newCategoryName = result.data?.category?.name;
        if (newCategoryName) {
          this.log.state('Auto-completing pending tx with new category', {
            category: newCategoryName,
            amount: pending.collectedArgs.amount,
          }, cid);

          const txHandler = this.toolRegistry.getHandler('register_transaction');
          const txArgs: Record<string, unknown> = {
            ...pending.collectedArgs,
            category: newCategoryName,
          };

          const freshContext = await this.userContext.getContext(userId);
          if (freshContext.categories?.length) {
            txArgs._categories = freshContext.categories;
          }

          const txResult = await txHandler.execute(userId, m, txArgs);

          if (txResult.ok && !txResult.userMessage) {
            await this.metricsService.recordTransaction(userId);
            await this.conversation.clearPending(userId);
            this.log.ok('Pending tx auto-completed', {
              amount: pending.collectedArgs.amount,
              category: newCategoryName,
            }, cid);

            result.data = {
              ...result.data,
              operation: 'create_and_register',
              transaction: txResult.data,
            };
          }
        }
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
        this.saveHistoryAsync(userId, m.text, result.userMessage);
        return { replies: [{ text: result.userMessage }], metrics };
      }

      // 11. Build RuntimeContext for Phase B
      const runtimeContext = this.buildRuntimeContext(
        context,
        userMetrics,
        cooldownFlags,
        userStyle,
        summary,
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

      // 13. WRITE ORDER: Summary AFTER Phase B success only
      if (phaseB.new_summary) {
        await this.conversation.saveSummary(userId, phaseB.new_summary);
        this.log.state('Summary saved', undefined, cid);
      }

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

      this.saveHistoryAsync(userId, m.text, phaseB.final_message);

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
    summary: string | null,
    userStyle: any,
    history: any,
    metrics: ProcessingMetrics,
    startTotal: number,
  ): Promise<{ replies: BotReply[]; metrics: ProcessingMetrics }> {
    const replies: BotReply[] = [];

    // Build or resume ActionBlock
    let block: ActionBlock;

    if (existingBlock) {
      // Resume: block already loaded with updated item (slot-fill case)
      block = existingBlock;
      this.log.state(`[actions] Resuming block ${block.id}`, undefined, cid);
    } else {
      // New block from Phase A actions
      const phaseAItems = phaseA.actions ?? [];
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
        // Pass the skipped items so the limit message can reference them
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

    // Block closed — evaluate nudges as separate BotReply BEFORE Phase B closing
    if (plannerResult.executedCount > 0) {
      const nudgeReplies = this.evaluateNudges(
        context,
        userMetrics,
        cooldownFlags,
        plannerResult.updatedBlock,
      );
      replies.push(...nudgeReplies);
    }

    // If no actual actions were executed (only queries or greeting), skip Phase B
    const executedItems = plannerResult.updatedBlock.items.filter(
      (i) => i.status === 'executed',
    );

    if (executedItems.length === 0) {
      // All failed/abandoned — just return what we have
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

    // Phase B: Generate closing message (¿Algo más?)
    const primaryTool = this.actionPlanner.getPrimaryTool(executedItems);
    const primaryItem = executedItems.find((i) => i.tool === primaryTool)!;
    const primaryResult: ActionResult = primaryItem.result ?? {
      ok: true,
      action: primaryTool as ActionType,
      data: {},
    };

    const runtimeContext = this.buildRuntimeContext(
      context,
      userMetrics,
      cooldownFlags,
      userStyle,
      summary,
      plannerResult.summaryForPhaseB,
    );

    const phaseBTimer = this.log.timer('Phase B (closing)', cid);
    let phaseB;
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
      // Continue without Phase B — confirmations already sent
    }
    metrics.phaseBMs =
      Date.now() -
      startTotal -
      metrics.contextMs -
      metrics.phaseAMs -
      metrics.toolMs;
    phaseBTimer();

    if (phaseB?.final_message) {
      replies.push({ text: phaseB.final_message, parseMode: 'HTML' });
      this.log.phaseB(
        'Closing message generated',
        { length: phaseB.final_message.length },
        cid,
      );

      if (phaseB.new_summary) {
        await this.conversation.saveSummary(userId, phaseB.new_summary);
        this.log.state('Summary saved', undefined, cid);
      }

      if (phaseB.did_nudge && phaseB.nudge_type) {
        await this.cooldowns.recordNudge(userId, phaseB.nudge_type);
        this.log.state('Nudge recorded', { type: phaseB.nudge_type }, cid);
      }
    }

    metrics.totalMs = Date.now() - startTotal;
    this.log.ok(
      'Actions flow complete',
      {
        executed: plannerResult.executedCount,
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

    this.saveHistoryAsync(userId, m.text, combinedText);

    return { replies, metrics };
  }

  // ===========================================================================
  // Nudge evaluation (called after block closes, before Phase B)
  // ===========================================================================

  private evaluateNudges(
    context: any,
    userMetrics: any,
    cooldownFlags: any,
    block: ActionBlock,
  ): BotReply[] {
    const nudges: BotReply[] = [];

    if (!cooldownFlags.canBudgetWarning) return nudges;

    const budget = context.activeBudget;
    if (budget?.amount && budget.spent != null) {
      const percent = budget.spent / budget.amount;
      if (percent >= 0.8 && cooldownFlags.canBudgetWarning) {
        const nudge = this.responseBuilder.buildBudgetNudge(percent);
        if (nudge.text) nudges.push(nudge);
      }
    }

    if (cooldownFlags.canNudge && userMetrics.txStreakDays >= 7) {
      const nudge = this.responseBuilder.buildStreakNudge(userMetrics.txStreakDays);
      if (nudge.text) nudges.push(nudge);
    }

    return nudges;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private buildRuntimeContext(
    context: any,
    userMetrics: any,
    cooldownFlags: any,
    userStyle: any,
    summary: string | null,
    blockSummary?: string,
  ): RuntimeContext {
    const budgetPercent =
      context.activeBudget?.amount && context.activeBudget.spent != null
        ? context.activeBudget.spent / context.activeBudget.amount
        : null;

    const moodHint = this.metricsService.calculateMoodHint(context, userMetrics);

    return {
      summary: blockSummary ? `${summary ?? ''}\n${blockSummary}`.trim() : (summary ?? undefined),
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
  ): void {
    this.historyService
      .appendToHistory(userId, userMessage, assistantMessage)
      .catch((err) => {
        console.error('[BotService] Failed to save history:', err);
      });
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
