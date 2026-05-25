import { Injectable, Inject, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { GeminiClient, type GeminiResult } from './gemini.client.js';
import { botTools } from './function-declarations.js';
import { createFunctionRouter } from './function-router.js';
import { ConversationService } from './conversation.service.js';
import { RedisService } from '../redis/index.js';
import { ResponseBuilderService } from './services/response-builder.service.js';
import { MetricsService } from './services/metrics.service.js';
import { MerchantResolverService } from '../merchants/services/merchant-resolver.service.js';
import { MerchantPreferencesService } from '../merchants/services/merchant-preferences.service.js';
import { InsightsEngineService } from '../insights/engine/insights-engine.service.js';
import type { InsightResult } from '../insights/contracts/index.js';
import { BotReply } from './actions/action-block.js';

const PROMPT_PATH = path.join(__dirname, 'prompts', 'gus_system.txt');
const TOKEN_DAILY_KEY = (id: string) => `tokens:${id}:daily`;
const TOKEN_MONTHLY_KEY = (id: string) => `tokens:${id}:monthly`;
const DEDUP_KEY = (id: string) => `msg:${id}`;
const LOCK_KEY = (id: string) => `lock:${id}`;
const DAILY_LIMIT = 2_000_000;

export interface BotResult {
  reply: string;
  replies: BotReply[];
  functionsCalled: GeminiResult['functionsCalled'];
  tokensUsed: GeminiResult['tokensUsed'];
}

/** Functions that mutate data — trigger cache invalidation + metrics */
const MUTATION_FNS = new Set([
  'register_expense',
  'register_income',
  'edit_transaction',
  'delete_transaction',
  'manage_category',
  'set_balance',
]);
const TX_REGISTER_FNS = new Set(['register_expense', 'register_income']);

@Injectable()
export class BotService {
  private readonly log = new Logger(BotService.name);
  private readonly client: GeminiClient;
  private promptTemplate: string;

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
    private readonly redis: RedisService,
    private readonly conversation: ConversationService,
    private readonly responseBuilder: ResponseBuilderService,
    private readonly metrics: MetricsService,
    private readonly merchantResolver: MerchantResolverService,
    private readonly merchantPrefs: MerchantPreferencesService,
    private readonly insightsEngine: InsightsEngineService,
    @Inject('USER_CONTEXT_SERVICE') private readonly userContext: any,
    @Inject('MESSAGE_LOG_SERVICE') private readonly messageLog: any,
  ) {
    const apiKey = process.env.GEMINI_API_KEY || '';
    this.client = new GeminiClient(apiKey);

    try {
      this.promptTemplate = fs.readFileSync(PROMPT_PATH, 'utf-8');
    } catch {
      this.promptTemplate =
        'Eres Gus, asistente financiero de TallyFinance. Tono: {tone}.';
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
  ): Promise<BotResult> {
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
    const lockAcquired = await this.redis
      .acquireLock(lockKey, 5000)
      .catch(() => true);
    if (!lockAcquired) {
      if (messageId) await this.redis.del(DEDUP_KEY(messageId)).catch(() => {});
      return this.textResult(
        'Dame un momento, estoy procesando tu mensaje anterior.',
      );
    }

    try {
      const result = await this.processMessage(userId, text, channel, media);

      // Mark dedup as done
      if (messageId) {
        await this.redis
          .set(DEDUP_KEY(messageId), 'done', 24 * 3600)
          .catch(() => {});
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
  ): Promise<BotResult> {
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
    let displayName = 'Usuario',
      tone = 'friendly';
    let categories: string[] = [];
    let budgets = 'Sin presupuesto activo';
    let accounts = 'Sin cuentas';
    let insights: InsightResult | null = null;

    try {
      const ctx = await this.userContext.getContext(userId);
      displayName = ctx.displayName || 'Usuario';
      tone = ctx.personality?.tone || 'friendly';
      categories = (ctx.categories || []).map((c: any) => c.name);
      insights = ctx.insights ?? null;

      if (ctx.activeBudgets?.length) {
        budgets = ctx.activeBudgets
          .map(
            (b: any) =>
              `${b.period}: $${Math.round(b.amount).toLocaleString('es-CL')}`,
          )
          .join(', ');
      } else if (ctx.activeBudget?.amount) {
        budgets = `${ctx.activeBudget.period}: $${Math.round(ctx.activeBudget.amount).toLocaleString('es-CL')}`;
      }

      if (ctx.accounts?.length) {
        accounts = ctx.accounts
          .map(
            (a: any) =>
              `${a.name}: $${Math.round(a.currentBalance).toLocaleString('es-CL')}`,
          )
          .join(', ');
      }
    } catch (err) {
      this.log.warn(`[handle] Failed to load context for ${userId}`, err);
    }

    // 3. Build system prompt
    const systemPrompt = this.promptTemplate
      .replace('{tone}', tone)
      .replace('{insights}', BotService.buildInsightsBlock(insights))
      .replace('{displayName}', displayName)
      .replace('{categories}', categories.join(', ') || 'Sin categorías')
      .replace('{budgets}', budgets)
      .replace('{accounts}', accounts);

    // 3b. Quick responses (no Gemini call needed)
    const quickReply = this.checkQuickResponse(text, tone);
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
      if (!text)
        userParts.push({
          text: 'El usuario envió esta imagen. Analízala en contexto financiero.',
        });
    }
    if (userParts.length === 0) userParts.push({ text: '' });

    // 6. Add user message to history
    history.push({ role: 'user', parts: userParts });

    // 7. Create function executor
    const executeFn = createFunctionRouter(this.supabase, userId, {
      merchantResolver: this.merchantResolver,
      merchantPrefs: this.merchantPrefs,
      insightsEngine: this.insightsEngine,
    });

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
      const errMsg =
        'Tuve un problema procesando tu mensaje. Intenta de nuevo.';
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
      const card = this.buildCardForFunction(
        fc.name,
        fc.result.data,
        fc.result,
      );
      if (card) replies.push(card);
    }

    // AI comment — always last (strip markdown since Telegram doesn't render it)
    if (result.reply?.trim()) {
      replies.push({ text: BotService.stripMarkdown(result.reply) });
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
        return rb.buildConfirmation(
          'register_transaction',
          {
            ...data,
            type: 'expense',
          },
          data.id,
        );

      case 'register_income':
        return rb.buildConfirmation(
          'register_transaction',
          {
            ...data,
            type: 'income',
            name: data.source || data.name || 'Ingreso',
          },
          data.id,
        );

      case 'delete_transaction':
        return rb.buildConfirmation(
          'manage_transactions',
          {
            operation: 'delete',
            deleted: data.deleted,
            id: data.deleted?.id,
          },
          data.deleted?.id,
        );

      case 'edit_transaction':
        return rb.buildConfirmation(
          'manage_transactions',
          {
            operation: 'edit',
            id: data.id,
            changes: this.sanitizeEditChanges(data.updated, data.previous),
          },
          data.id,
        );

      case 'query_transactions': {
        if (data.transactions) {
          return rb.buildConfirmation('manage_transactions', {
            operation: 'list',
            transactions: data.transactions,
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

  private static readonly DASHBOARD_URL =
    'https://frontend-tally-finance.vercel.app/app';
  private static readonly DASHBOARD_PATTERN =
    /\b(dashboard|link|web|app|página|pagina|sitio|reporte|reportes|configurar|configuración)\b/i;

  private static readonly DASHBOARD_MSGS: Record<string, string> = {
    neutral: `Acá está tu dashboard → LINK\n\nResumen de gastos, gráficos por categoría, presupuesto y cuentas.`,
    friendly: `Dale, acá lo tienes 😊\n\n👉 LINK\n\nPuedes ver tus gastos, gráficos, categorías y configurar tu presupuesto. Pásate! 🚀`,
    strict: `Tu dashboard está acá → LINK\n\nRevisa tu resumen de gastos, gráficos por categoría y el estado de tu presupuesto.`,
    toxic: `¿No lo tenías guardado? 🙃\n\n👉 LINK\n\nAhí puedes ver cuánto llevas este mes, tus categorías y configurar tu presupuesto.`,
  };

  // ── Build the "TU USER" block of the system prompt from Layer-1 insights ──
  // Public so the test endpoint can render the same block the LLM sees.

  public static formatCLP(n: number): string {
    return `$${Math.round(n).toLocaleString('es-CL')}`;
  }

  public static buildInsightsBlock(insights: InsightResult | null): string {
    if (
      !insights ||
      insights.data_maturity === 'empty' ||
      !insights.has_sufficient_data
    ) {
      const txCount = insights?.tx_count_at_compute ?? 0;
      return (
        `Sin data suficiente todavía (${txCount} transacciones registradas).\n` +
        `No hagas afirmaciones sobre patrones o magnitudes — todavía no las conocés.`
      );
    }

    const fmt = BotService.formatCLP;
    const d = insights.daily_spend_dist;
    const tx = insights.tx_amount_dist;
    const cm = insights.current_month;

    const topCats =
      Object.values(insights.category_profile)
        .sort((a, b) => b.share_pct - a.share_pct)
        .slice(0, 3)
        .map(
          (c) =>
            `${c.category_name} ${Math.round(c.share_pct)}% (${c.trend_30d})`,
        )
        .join(', ') || 'sin categoría dominante';

    const budgetLines =
      insights.budget_state
        .map(
          (b) =>
            `  ${b.period}: ${fmt(b.spent)}/${fmt(b.amount)} (${Math.round(b.spent_pct)}%)`,
        )
        .join('\n') || '  (sin budgets activos)';

    const vsLast =
      cm.vs_last_month_pct === null
        ? ''
        : ` (${cm.vs_last_month_pct >= 0 ? '+' : ''}${Math.round(cm.vs_last_month_pct)}% vs mes pasado)`;

    return [
      `Maturity: ${insights.data_maturity}`,
      `Archetype: ${insights.spender_archetype}`,
      ``,
      `Escala diaria del user: típico ${fmt(d.p50)}, alto ${fmt(d.p90)}, atípico ${fmt(d.p95)}`,
      `Escala por tx: típico ${fmt(tx.p50)}, alto ${fmt(tx.p90)}, atípico ${fmt(tx.p95)}`,
      ``,
      `Mes actual: ${fmt(cm.spent)} en ${cm.days_in} días`,
      `  Pace: ${fmt(cm.pace_per_day)}/día → proyectado ${fmt(cm.projected_total)}${vsLast}`,
      ``,
      `Top categorías: ${topCats}`,
      ``,
      `Budgets activos:`,
      budgetLines,
    ].join('\n');
  }

  private checkQuickResponse(text: string, tone: string): string | null {
    if (BotService.DASHBOARD_PATTERN.test(text)) {
      const template =
        BotService.DASHBOARD_MSGS[tone] ||
        BotService.DASHBOARD_MSGS.neutral;
      return template.replace(/LINK/g, BotService.DASHBOARD_URL);
    }
    return null;
  }

  // ── Security: sanitize edit changes for user-facing display ──

  private static readonly FIELD_LABELS: Record<string, string> = {
    amount: 'Monto',
    name: 'Nombre',
    description: 'Descripción',
    posted_at: 'Fecha',
    category: 'Categoría',
    category_id: 'Categoría',
  };

  private static readonly UUID_RE =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

  /** Strip markdown formatting that Telegram can't render */
  private static stripMarkdown(text: string): string {
    return text
      .replace(/\*\*(.+?)\*\*/g, '$1') // **bold** → bold
      .replace(/\*(.+?)\*/g, '$1') // *bold* → bold
      .replace(/__(.+?)__/g, '$1') // __underline__
      .replace(/_(.+?)_/g, '$1') // _italic_
      .replace(/`(.+?)`/g, '$1') // `code`
      .replace(/```[\s\S]*?```/g, ''); // code blocks
  }

  private sanitizeEditChanges(
    updated: Record<string, any> | undefined,
    previous: Record<string, any> | undefined,
  ): string[] {
    if (!updated) return [];
    const rb = this.responseBuilder;
    return Object.keys(updated)
      .filter((k) => !k.endsWith('_id')) // Never show internal ID fields
      .map((k) => {
        const label = BotService.FIELD_LABELS[k] || k;
        let prev = previous?.[k];
        let next = updated[k];

        // Strip UUIDs from values
        if (typeof prev === 'string' && BotService.UUID_RE.test(prev))
          prev = undefined;
        if (typeof next === 'string' && BotService.UUID_RE.test(next))
          next = undefined;

        // Format amounts
        if (k === 'amount') {
          prev = prev != null ? `$${rb.formatCLP(Number(prev))}` : undefined;
          next = next != null ? `$${rb.formatCLP(Number(next))}` : undefined;
        }

        // Format dates
        if (k === 'posted_at') {
          prev = prev ? rb.formatDate(String(prev)) : undefined;
          next = next ? rb.formatDate(String(next)) : undefined;
        }

        const prevStr = prev ?? '—';
        const nextStr = next ?? '—';
        return `${label}: ${prevStr} → ${nextStr}`;
      });
  }

  // ── Helpers ──

  private emptyResult(reason: string): BotResult {
    return {
      reply: '',
      replies: [{ text: '', skipSend: true }],
      functionsCalled: [],
      tokensUsed: { input: 0, output: 0, total: 0 },
    };
  }

  private textResult(text: string): BotResult {
    return {
      reply: text,
      replies: [{ text }],
      functionsCalled: [],
      tokensUsed: { input: 0, output: 0, total: 0 },
    };
  }

  // ── Token tracking ──

  private async checkTokenLimit(
    userId: string,
  ): Promise<{ ok: boolean; message?: string }> {
    try {
      const dailyStr = await this.redis.get(TOKEN_DAILY_KEY(userId));
      const daily = parseInt(dailyStr || '0', 10);
      if (daily >= DAILY_LIMIT) {
        return {
          ok: false,
          message:
            'Has alcanzado tu límite diario de mensajes. Vuelve mañana o mejora tu plan en tallyfinance.vercel.app/app',
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
      await this.redis.set(
        monthlyKey,
        String(monthlyCurrent + tokens),
        30 * 24 * 3600,
      );
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
        userId,
        channel,
        userMessage,
        botResponse: result.reply,
        toolName: primaryTool,
        phaseADebug: {
          version: 'v3',
          functionsCalled: result.functionsCalled.map((fc) => ({
            name: fc.name,
            args: fc.args,
            ok: fc.result?.ok,
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
