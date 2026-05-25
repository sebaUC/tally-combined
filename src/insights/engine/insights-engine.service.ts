import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  InsightInput,
  InsightResult,
  InsightSource,
  TransactionRow,
  CategoryRow,
  BudgetRow,
} from '../contracts';
import { Layer1MetricsService } from './layer1-metrics.service';
import { InsightsWriterService } from '../io/insights-writer.service';
import { InsightsReaderService } from '../io/insights-reader.service';

/**
 * Ventana por defecto en días para el recompute completo.
 * El plan especifica 90 días (Trigger #3 batch semanal).
 */
const DEFAULT_LOOKBACK_DAYS = 90;

/**
 * Orquestador del compute. Carga datos de Supabase, corre Layer 1,
 * persiste el resultado. Wraps de:
 *   - Layer1MetricsService (puro)
 *   - InsightsWriterService (IO)
 *   - InsightsReaderService (IO)
 *
 * Triggers (PR2) llamarán a `recomputeForUser(userId, source)`.
 */
@Injectable()
export class InsightsEngineService {
  private readonly log = new Logger(InsightsEngineService.name);

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
    private readonly layer1: Layer1MetricsService,
    private readonly writer: InsightsWriterService,
    private readonly reader: InsightsReaderService,
  ) {}

  /**
   * Recompute para todos los users que tengan al menos 1 tx en los últimos
   * `lookbackDays` días. Llama secuencialmente para no saturar Supabase.
   * Devuelve resumen { totalUsers, ok, failed }.
   *
   * Pensado para correr semanal (Trigger #3) desde un cron externo:
   *   curl -X POST $BASE_URL/internal/insights/batch \
   *     -H "Authorization: Bearer $INTERNAL_SERVICE_TOKEN"
   */
  async recomputeBatch(
    lookbackDays = DEFAULT_LOOKBACK_DAYS,
  ): Promise<{ totalUsers: number; ok: number; failed: number; failedIds: string[] }> {
    const since = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);
    const { data, error } = await this.supabase
      .from('transactions')
      .select('user_id')
      .gte('posted_at', since.toISOString());

    if (error) {
      this.log.error(`[recomputeBatch] Load users failed: ${error.message}`);
      throw new Error(error.message);
    }

    const userIds = Array.from(new Set((data ?? []).map((r: any) => r.user_id)));
    let ok = 0;
    let failed = 0;
    const failedIds: string[] = [];

    for (const userId of userIds) {
      try {
        await this.recomputeForUser(userId, 'batch_weekly', lookbackDays);
        ok++;
      } catch (err) {
        failed++;
        failedIds.push(userId);
        this.log.warn(
          `[recomputeBatch] Failed for ${userId}: ${(err as Error).message}`,
        );
      }
    }

    this.log.log(
      `[recomputeBatch] Done — total=${userIds.length} ok=${ok} failed=${failed}`,
    );
    return { totalUsers: userIds.length, ok, failed, failedIds };
  }

  /**
   * Recompute completo desde 90 días de historia. Camino de:
   *   - Trigger #3 (batch semanal — via recomputeBatch)
   *   - Trigger #4 (on-demand)
   *   - Onboarding seed inicial
   *   - Incremental post-mutación (fire-and-forget desde el router)
   */
  async recomputeForUser(
    userId: string,
    source: InsightSource,
    lookbackDays = DEFAULT_LOOKBACK_DAYS,
  ): Promise<InsightResult> {
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - lookbackDays * 24 * 3600 * 1000);

    const [transactions, categories, budgets] = await Promise.all([
      this.loadTransactions(userId, periodStart, periodEnd),
      this.loadCategories(userId),
      this.loadBudgets(userId),
    ]);

    const input: InsightInput = {
      userId,
      transactions,
      categories,
      budgets,
      periodStart,
      periodEnd,
      source,
    };

    const result = this.layer1.compute(input);

    await this.writer.upsert(result);
    await this.reader.invalidate(userId);

    if (source === 'manual_recompute' || source === 'batch_weekly') {
      await this.writer.archiveToHistory(
        result,
        source === 'manual_recompute' ? 'manual_recompute' : 'monthly_archive',
      );
    }

    this.log.log(
      `[recomputeForUser] user=${userId} source=${source} tx_count=${transactions.length} maturity=${result.data_maturity}`,
    );
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Data loaders
  // ─────────────────────────────────────────────────────────────────────

  private async loadTransactions(
    userId: string,
    start: Date,
    end: Date,
  ): Promise<TransactionRow[]> {
    const { data, error } = await this.supabase
      .from('transactions')
      .select(
        'id, user_id, amount, type, category_id, posted_at, name, description, is_internal_transfer, paired_transaction_id, account_id',
      )
      .eq('user_id', userId)
      .eq('is_internal_transfer', false)
      .gte('posted_at', start.toISOString())
      .lte('posted_at', end.toISOString())
      .order('posted_at', { ascending: true });

    if (error) {
      this.log.error(`[loadTransactions] ${error.message}`);
      throw new Error(`Failed to load transactions: ${error.message}`);
    }
    return (data ?? []) as TransactionRow[];
  }

  private async loadCategories(userId: string): Promise<CategoryRow[]> {
    const { data, error } = await this.supabase
      .from('categories')
      .select('id, user_id, name, icon, budget')
      .eq('user_id', userId);

    if (error) {
      this.log.error(`[loadCategories] ${error.message}`);
      throw new Error(`Failed to load categories: ${error.message}`);
    }
    return (data ?? []) as CategoryRow[];
  }

  private async loadBudgets(userId: string): Promise<BudgetRow[]> {
    const { data, error } = await this.supabase
      .from('spending_expectations')
      .select('user_id, period, amount, active')
      .eq('user_id', userId)
      .eq('active', true);

    if (error) {
      this.log.error(`[loadBudgets] ${error.message}`);
      throw new Error(`Failed to load budgets: ${error.message}`);
    }
    return (data ?? []) as BudgetRow[];
  }
}
