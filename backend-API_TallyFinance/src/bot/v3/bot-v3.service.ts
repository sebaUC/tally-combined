import { Injectable, Inject, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { GeminiClient, type GeminiResult } from './gemini.client.js';
import { botTools } from './function-declarations.js';
import { createFunctionRouter } from './function-router.js';
import { ConversationV3Service } from './conversation-v3.service.js';
import { RedisService } from '../../redis/index.js';
import { ResponseBuilderService } from '../services/response-builder.service.js';
import { MetricsService } from '../services/metrics.service.js';
import { BotReply } from '../actions/action-block.js';

const PROMPT_PATH = path.join(__dirname, 'prompts', 'gus_system.txt');
const TOKEN_DAILY_KEY = (id: string) => `tokens:${id}:daily`;
const TOKEN_MONTHLY_KEY = (id: string) => `tokens:${id}:monthly`;
const DEDUP_KEY = (id: string) => `msg:${id}`;
const LOCK_KEY = (id: string) => `lock:${id}`;
const DAILY_LIMIT = 200_000;

export interface BotV3Result {
  reply: string;
  replies: BotReply[];
  functionsCalled: GeminiResult['functionsCalled'];
  tokensUsed: GeminiResult['tokensUsed'];
}

/** Functions that mutate data — trigger cache invalidation + metrics */
const MUTATION_FNS = new Set([
  'register_expense', 'register_income', 'edit_transaction',
  'delete_transaction', 'manage_category', 'set_balance',
]);
const TX_REGISTER_FNS = new Set(['register_expense', 'register_income']);

@Injectable()
export class BotV3Service {
  private readonly log = new Logger(BotV3Service.name);
  private readonly client: GeminiClient;
  private promptTemplate: string;

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
    private readonly redis: RedisService,
    private readonly conversation: ConversationV3Service,
    private readonly responseBuilder: ResponseBuilderService,
    private readonly metrics: MetricsService,
    @Inject('USER_CONTEXT_SERVICE') private readonly userContext: any,
    @Inject('MESSAGE_LOG_SERVICE') private readonly messageLog: any,
  ) {
    const apiKey = process.env.GEMINI_API_KEY || '';
    this.client = new GeminiClient(apiKey);

    try {
      this.promptTemplate = fs.readFileSync(PROMPT_PATH, 'utf-8');
    } catch {
      this.promptTemplate = 'Eres Gus, asistente financiero de TallyFinance. Tono: {tone}. Mood: {mood}.';
      this.log.warn('Could not load gus_system.txt — using fallback prompt');
    }
  }

  /**
   * Handle a user message — the complete V3 pipeline.
   * @param messageId — platform message ID for dedup (optional for test endpoint)
   */
  async handle(
    userId: string,
    text: string,
    channel: string,
    messageId?: string,
    media?: { type: string; mimeType: string; data: string }[],
  ): Promise<BotV3Result> {
    // ── Dedup check ──
    if (messageId) {
      const dedupKey = DEDUP_KEY(messageId);
      const existing = await this.redis.get(dedupKey).catch(() => null);
      if (existing === 'done') {
        return this.emptyResult('[dedup] already processed');
      }
      if (existing === 'processing') {
        return this.textResult('Procesando tu mensaje anterior...');
      }
      await this.redis.set(dedupKey, 'processing', 120).catch(() => {});
    }

    // ── Concurrency lock ──
    const lockKey = LOCK_KEY(userId);
    const lockAcquired = await this.redis.acquireLock(lockKey, 5000).catch(() => true);
    if (!lockAcquired) {
      if (messageId) await this.redis.del(DEDUP_KEY(messageId)).catch(() => {});
      return this.textResult('Dame un momento, estoy procesando tu mensaje anterior.');
    }

    try {
      const result = await this.processMessage(userId, text, channel, media);

      // Mark dedup as done
      if (messageId) {
        await this.redis.set(DEDUP_KEY(messageId), 'done', 24 * 3600).catch(() => {});
      }

      return result;
    } catch (err) {
      // Allow retry on failure
      if (messageId) await this.redis.del(DEDUP_KEY(messageId)).catch(() => {});
      throw err;
    } finally {
      await this.redis.releaseLock(lockKey).catch(() => {});
    }
  }

  async reset(userId: string): Promise<void> {
    await this.conversation.reset(userId);
  }

  // ── Core pipeline ──

  private async processMessage(
    userId: string,
    text: string,
    channel: string,
    media?: { type: string; mimeType: string; data: string }[],
  ): Promise<BotV3Result> {
    const start = Date.now();

    // 1. Check token limit
    const tokenCheck = await this.checkTokenLimit(userId);
    if (!tokenCheck.ok) {
      return {
        reply: tokenCheck.message!,
        replies: [{ text: tokenCheck.message!, parseMode: 'HTML' }],
        functionsCalled: [],
        tokensUsed: { input: 0, output: 0, total: 0 },
      };
    }

    // 2. Load user context
    let displayName = 'Usuario', tone = 'neutral', mood = 'normal';
    let categories: string[] = [];
    let budgets = 'Sin presupuesto activo';
    let accounts = 'Sin cuentas';

    try {
      const ctx = await this.userContext.getContext(userId);
      displayName = ctx.displayName || 'Usuario';
      tone = ctx.personality?.tone || 'neutral';
      mood = ctx.personality?.mood || 'normal';
      categories = (ctx.categories || []).map((c: any) => c.name);

      if (ctx.activeBudgets?.length) {
        budgets = ctx.activeBudgets
          .map((b: any) => `${b.period}: $${Math.round(b.amount).toLocaleString('es-CL')}`)
          .join(', ');
      } else if (ctx.activeBudget?.amount) {
        budgets = `${ctx.activeBudget.period}: $${Math.round(ctx.activeBudget.amount).toLocaleString('es-CL')}`;
      }

      if (ctx.accounts?.length) {
        accounts = ctx.accounts
          .map((a: any) => `${a.name}: $${Math.round(a.currentBalance).toLocaleString('es-CL')}`)
          .join(', ');
      }
    } catch (err) {
      this.log.warn(`[handle] Failed to load context for ${userId}`, err);
    }

    // 3. Build system prompt
    const systemPrompt = this.promptTemplate
      .replace('{tone}', tone)
      .replace('{mood}', mood)
      .replace('{displayName}', displayName)
      .replace('{categories}', categories.join(', ') || 'Sin categorías')
      .replace('{budgets}', budgets)
      .replace('{accounts}', accounts);

    // 3b. Quick responses (no Gemini call needed)
    const quickReply = this.checkQuickResponse(text);
    if (quickReply) {
      return {
        reply: quickReply,
        replies: [{ text: quickReply, parseMode: 'HTML' }],
        functionsCalled: [],
        tokensUsed: { input: 0, output: 0, total: 0 },
      };
    }

    // 4. Load conversation history from Redis
    const history = await this.conversation.getHistory(userId);

    // 5. Build user message (text + media if present)
    const userParts: any[] = [];
    if (text) userParts.push({ text });
    if (media?.length) {
      for (const m of media) {
        userParts.push({ inlineData: { mimeType: m.mimeType, data: m.data } });
      }
      if (!text) userParts.push({ text: 'El usuario envió esta imagen. Analízala en contexto financiero.' });
    }
    if (userParts.length === 0) userParts.push({ text: '' });

    // 6. Add user message to history
    history.push({ role: 'user', parts: userParts });

    // 7. Create function executor
    const executeFn = createFunctionRouter(this.supabase, userId);

    // 8. Call Gemini
    let result: GeminiResult;
    try {
      result = await this.client.chat(
        systemPrompt,
        history.slice(0, -1),
        userParts,
        botTools,
        executeFn,
      );
    } catch (err) {
      this.log.error(`[handle] Gemini call failed`, err);
      history.pop();
      const errMsg = 'Tuve un problema procesando tu mensaje. Intenta de nuevo.';
      return {
        reply: errMsg,
        replies: [{ text: errMsg }],
        functionsCalled: [],
        tokensUsed: { input: 0, output: 0, total: 0 },
      };
    }

    // 9. Add function calls + responses + final reply to history
    for (const fc of result.functionsCalled) {
      history.push({
        role: 'model',
        parts: [{ functionCall: { name: fc.name, args: fc.args } }],
      });
      history.push({
        role: 'function',
        parts: [{ functionResponse: { name: fc.name, response: fc.result } }],
      });
    }
    history.push({ role: 'model', parts: [{ text: result.reply }] });

    // 10. Save conversation to Redis
    await this.conversation.saveHistory(userId, history);

    // 11. Track tokens
    await this.recordTokens(userId, result.tokensUsed.total);

    // 12. Post-action: metrics + cache invalidation
    await this.postAction(userId, result.functionsCalled);

    // 13. Log message (fire-and-forget)
    this.logMessage(userId, channel, text, result).catch(() => {});

    // 14. Build BotReply[]
    const replies: BotReply[] = this.buildReplies(result);

    const totalMs = Date.now() - start;
    this.log.debug(
      `[handle] Done user=${userId} functions=${result.functionsCalled.length} ` +
      `tokens=${result.tokensUsed.total} time=${totalMs}ms`,
    );

    return { ...result, replies };
  }

  // ── Post-action: metrics + cache invalidation ──

  private async postAction(
    userId: string,
    functionsCalled: GeminiResult['functionsCalled'],
  ): Promise<void> {
    let hasMutation = false;
    let txCount = 0;

    for (const fc of functionsCalled) {
      if (!fc.result?.ok) continue;
      if (MUTATION_FNS.has(fc.name)) hasMutation = true;
      if (TX_REGISTER_FNS.has(fc.name)) txCount++;
    }

    // Record transaction metrics (streaks)
    if (txCount > 0) {
      this.metrics.recordTransactions(userId, txCount).catch(() => {});
    }

    // Invalidate context cache so next message has fresh data
    if (hasMutation) {
      this.userContext.invalidate(userId).catch(() => {});
    }
  }

  // ── Reply building ──

  private buildReplies(result: GeminiResult): BotReply[] {
    const replies: BotReply[] = [];

    for (const fc of result.functionsCalled) {
      if (!fc.result?.ok) continue;
      const card = this.buildCardForFunction(fc.name, fc.result.data, fc.result);
      if (card) replies.push(card);
    }

    // AI comment — always last
    if (result.reply?.trim()) {
      replies.push({ text: result.reply });
    }

    if (replies.length === 0) {
      replies.push({ text: result.reply || 'Listo.' });
    }

    return replies;
  }

  private buildCardForFunction(
    fnName: string,
    data: Record<string, any> | undefined,
    fullResult: Record<string, any>,
  ): BotReply | null {
    if (!data) return null;
    const rb = this.responseBuilder;

    switch (fnName) {
      case 'register_expense':
        return rb.buildConfirmation('register_transaction', {
          ...data, type: 'expense',
        }, data.id);

      case 'register_income':
        return rb.buildConfirmation('register_transaction', {
          ...data, type: 'income',
          name: data.source || data.name || 'Ingreso',
        }, data.id);

      case 'delete_transaction':
        return rb.buildConfirmation('manage_transactions', {
          operation: 'delete',
          deleted: data.deleted,
          id: data.deleted?.id,
        }, data.deleted?.id);

      case 'edit_transaction':
        return rb.buildConfirmation('manage_transactions', {
          operation: 'edit', id: data.id,
          changes: Object.keys(data.updated || {}).map(
            (k) => `${k}: ${data.previous?.[k]} → ${data.updated?.[k]}`,
          ),
        }, data.id);

      case 'query_transactions': {
        if (data.transactions) {
          return rb.buildConfirmation('manage_transactions', {
            operation: 'list', transactions: data.transactions,
          });
        }
        // sum/count — build inline card
        if (data.total !== undefined) {
          return {
            text: `💸 Total: <b>$${rb.formatCLP(data.total)}</b> (${data.count} transacciones)`,
            parseMode: 'HTML',
          };
        }
        if (data.count !== undefined) {
          return {
            text: `📊 <b>${data.count}</b> transacciones${data.category ? ` en ${data.category}` : ''} (${data.period})`,
            parseMode: 'HTML',
          };
        }
        return null;
      }

      case 'manage_category':
        return rb.buildConfirmation('manage_categories', data);

      case 'get_balance':
        return rb.buildConfirmation('ask_balance', data);

      case 'set_balance':
        return rb.buildConfirmation('balance_set', data);

      default:
        return null;
    }
  }

  // ── Quick responses (algorithmic, no Gemini) ──

  private static readonly DASHBOARD_URL = 'https://frontend-tally-finance.vercel.app/app';
  private static readonly DASHBOARD_PATTERN = /\b(dashboard|link|web|app|página|pagina|sitio|reporte|reportes|configurar|configuración)\b/i;

  private checkQuickResponse(text: string): string | null {
    if (BotV3Service.DASHBOARD_PATTERN.test(text)) {
      return `Tu dashboard está acá 👉 ${BotV3Service.DASHBOARD_URL}\n\nAhí puedes ver tu resumen de gastos, gráficos por categoría, configurar presupuesto y gestionar tus cuentas.`;
    }
    return null;
  }

  // ── Helpers ──

  private emptyResult(reason: string): BotV3Result {
    return {
      reply: '', replies: [{ text: '', skipSend: true }],
      functionsCalled: [], tokensUsed: { input: 0, output: 0, total: 0 },
    };
  }

  private textResult(text: string): BotV3Result {
    return {
      reply: text, replies: [{ text }],
      functionsCalled: [], tokensUsed: { input: 0, output: 0, total: 0 },
    };
  }

  // ── Token tracking ──

  private async checkTokenLimit(userId: string): Promise<{ ok: boolean; message?: string }> {
    try {
      const dailyStr = await this.redis.get(TOKEN_DAILY_KEY(userId));
      const daily = parseInt(dailyStr || '0', 10);
      if (daily >= DAILY_LIMIT) {
        return {
          ok: false,
          message: 'Has alcanzado tu límite diario de mensajes. Vuelve mañana o mejora tu plan en tallyfinance.vercel.app/app',
        };
      }
    } catch {
      // If Redis fails, allow the message
    }
    return { ok: true };
  }

  private async recordTokens(userId: string, tokens: number): Promise<void> {
    try {
      const dailyKey = TOKEN_DAILY_KEY(userId);
      const monthlyKey = TOKEN_MONTHLY_KEY(userId);

      const dailyStr = await this.redis.get(dailyKey);
      const dailyCurrent = parseInt(dailyStr || '0', 10);
      await this.redis.set(dailyKey, String(dailyCurrent + tokens), 24 * 3600);

      const monthlyStr = await this.redis.get(monthlyKey);
      const monthlyCurrent = parseInt(monthlyStr || '0', 10);
      await this.redis.set(monthlyKey, String(monthlyCurrent + tokens), 30 * 24 * 3600);
    } catch {
      // Non-critical
    }
  }

  // ── Logging ──

  private async logMessage(
    userId: string,
    channel: string,
    userMessage: string,
    result: GeminiResult,
  ): Promise<void> {
    try {
      const primaryTool = result.functionsCalled[0]?.name ?? null;
      await this.messageLog.log({
        userId, channel, userMessage,
        botResponse: result.reply,
        toolName: primaryTool,
        phaseADebug: {
          version: 'v3',
          functionsCalled: result.functionsCalled.map((fc) => ({
            name: fc.name, args: fc.args, ok: fc.result?.ok,
          })),
        },
        phaseBDebug: { tokensUsed: result.tokensUsed },
        error: null,
      });
    } catch {
      // Don't break the bot for logging failures
    }
  }
}
