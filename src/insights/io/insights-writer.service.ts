import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { InsightResult } from '../contracts';

export type HistoryTrigger =
  | 'maturity_promotion'
  | 'monthly_archive'
  | 'manual_recompute'
  | 'milestone';

/**
 * Persiste InsightResult a Supabase.
 *
 * Lo que se escribe:
 *   - upsert a `user_insights` (siempre)
 *   - INSERT a `user_insights_history` si trigger relevante (opcional)
 */
@Injectable()
export class InsightsWriterService {
  private readonly log = new Logger(InsightsWriterService.name);

  constructor(@Inject('SUPABASE') private readonly supabase: SupabaseClient) {}

  async upsert(result: InsightResult): Promise<void> {
    const row = this.toRow(result);
    const { error } = await this.supabase
      .from('user_insights')
      .upsert(row, { onConflict: 'user_id' });

    if (error) {
      this.log.error(
        `[upsert] Failed for user ${result.userId}: ${error.message}`,
      );
      throw new Error(`Failed to upsert user_insights: ${error.message}`);
    }
  }

  async archiveToHistory(
    result: InsightResult,
    trigger: HistoryTrigger,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('user_insights_history')
      .insert({
        user_id: result.userId,
        snapshot: result,
        trigger_source: trigger,
      });

    if (error) {
      this.log.warn(
        `[archiveToHistory] Failed for user ${result.userId}: ${error.message}`,
      );
      // No throw — history es best-effort
    }
  }

  async markStale(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('user_insights')
      .update({ stale: true })
      .eq('user_id', userId);

    if (error) {
      this.log.warn(`[markStale] Failed for user ${userId}: ${error.message}`);
    }
  }

  /**
   * Convierte el InsightResult (TypeScript) a la fila tal cual va a Supabase.
   * Las columnas jsonb reciben los objetos directamente, no stringificados.
   */
  private toRow(result: InsightResult): Record<string, unknown> {
    return {
      user_id: result.userId,
      period_start: result.periodStart.slice(0, 10),
      period_end: result.periodEnd.slice(0, 10),

      spender_archetype: result.spender_archetype,
      primary_category_id: result.primary_category_id,
      category_concentration: result.category_concentration,
      data_maturity: result.data_maturity,

      daily_spend_dist: result.daily_spend_dist,
      tx_amount_dist: result.tx_amount_dist,
      monthly_spend_dist: result.monthly_spend_dist,

      category_profile: result.category_profile,
      category_baselines: result.category_baselines,

      weekday_pattern: result.weekday_pattern,
      day_of_month_pattern: result.day_of_month_pattern,
      peak_day_of_week: result.peak_day_of_week,
      peak_week_of_month: result.peak_week_of_month,

      current_month: result.current_month,
      current_week: result.current_week,
      budget_state: result.budget_state,

      first_month: result.first_month,
      best_month: result.best_month,
      worst_month: result.worst_month,
      monthly_trajectory: result.monthly_trajectory,

      largest_expense: result.largest_expense,
      ant_expense_count: result.ant_expense_count,
      ant_expense_total: result.ant_expense_total,

      // Layer 2 y 3 quedan en defaults — los rellena PR2/PR4.
      observations: [],
      money_diary: null,

      has_sufficient_data: result.has_sufficient_data,
      has_temporal_patterns: result.has_temporal_patterns,
      has_anomaly_baselines: result.has_anomaly_baselines,
      has_diary: result.has_diary,

      source: result.source,
      tx_count_at_compute: result.tx_count_at_compute,
      computed_at: result.computed_at,
      stale: false,
    };
  }
}
