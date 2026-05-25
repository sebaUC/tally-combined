import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { RedisService, RedisKeys, RedisTTL } from '../../redis';
import { InsightResult } from '../contracts';

/**
 * Lectura de user_insights desde la BD, con cache Redis (5 min TTL).
 *
 * El bot lo consume en cada turn dentro de UserContextService — por eso
 * el TTL no puede ser muy corto. Las mutaciones invalidan vía
 * `invalidate(userId)` (lo llamarán los hooks en PR2).
 */
@Injectable()
export class InsightsReaderService {
  private readonly log = new Logger(InsightsReaderService.name);

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
    private readonly redis: RedisService,
  ) {}

  async get(userId: string): Promise<InsightResult | null> {
    const cacheKey = RedisKeys.userInsights(userId);

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as InsightResult;
      }
    } catch (err) {
      this.log.warn(`[get] Redis cache error, falling back to DB`, err);
    }

    const fromDb = await this.fetchFromDb(userId);
    if (fromDb) {
      try {
        await this.redis.set(
          cacheKey,
          JSON.stringify(fromDb),
          RedisTTL.USER_INSIGHTS,
        );
      } catch (err) {
        this.log.warn(`[get] Failed to cache user_insights in Redis`, err);
      }
    }
    return fromDb;
  }

  async invalidate(userId: string): Promise<void> {
    try {
      await this.redis.del(RedisKeys.userInsights(userId));
    } catch (err) {
      this.log.warn(`[invalidate] Failed to clear Redis cache`, err);
    }
  }

  private async fetchFromDb(userId: string): Promise<InsightResult | null> {
    const { data, error } = await this.supabase
      .from('user_insights')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      this.log.error(`[fetchFromDb] Error for ${userId}: ${error.message}`);
      return null;
    }
    if (!data) return null;

    // Reconstrucción del shape (TS interface). period_* vienen como date string.
    return {
      userId: data.user_id,
      periodStart: data.period_start,
      periodEnd: data.period_end,
      spender_archetype: data.spender_archetype ?? 'unknown',
      primary_category_id: data.primary_category_id,
      category_concentration: data.category_concentration ?? 0,
      data_maturity: data.data_maturity ?? 'empty',
      daily_spend_dist: data.daily_spend_dist ?? emptyDist(),
      tx_amount_dist: data.tx_amount_dist ?? emptyDist(),
      monthly_spend_dist: data.monthly_spend_dist ?? emptyDist(),
      category_profile: data.category_profile ?? {},
      category_baselines: data.category_baselines ?? {},
      weekday_pattern: data.weekday_pattern ?? {},
      day_of_month_pattern: data.day_of_month_pattern ?? {},
      peak_day_of_week: data.peak_day_of_week,
      peak_week_of_month: data.peak_week_of_month,
      current_month: data.current_month ?? emptyCurrentMonth(),
      current_week: data.current_week ?? emptyCurrentWeek(),
      budget_state: data.budget_state ?? [],
      first_month: data.first_month,
      best_month: data.best_month,
      worst_month: data.worst_month,
      monthly_trajectory: data.monthly_trajectory ?? [],
      largest_expense: data.largest_expense,
      ant_expense_count: data.ant_expense_count ?? 0,
      ant_expense_total: data.ant_expense_total ?? 0,
      has_sufficient_data: data.has_sufficient_data ?? false,
      has_temporal_patterns: data.has_temporal_patterns ?? false,
      has_anomaly_baselines: data.has_anomaly_baselines ?? false,
      has_diary: data.has_diary ?? false,
      source: data.source ?? 'incremental',
      tx_count_at_compute: data.tx_count_at_compute ?? 0,
      computed_at: data.computed_at,
    };
  }
}

function emptyDist() {
  return { p25: 0, p50: 0, p75: 0, p90: 0, p95: 0, mean: 0, stddev: 0, count: 0 };
}

function emptyCurrentMonth() {
  return {
    spent: 0,
    days_in: 0,
    days_left: 0,
    pace_per_day: 0,
    projected_total: 0,
    vs_last_month_pct: null,
    vs_avg_pct: null,
  };
}

function emptyCurrentWeek() {
  return { spent: 0, days_in: 0, days_left: 0, pace_per_day: 0 };
}
