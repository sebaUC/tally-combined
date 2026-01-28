import { Injectable, Logger } from '@nestjs/common';
import { RedisService, RedisKeys, RedisTTL } from '../../redis';
import { MinimalUserContext } from './user-context.service';

/**
 * User engagement metrics stored in Redis.
 */
export interface UserMetrics {
  txStreakDays: number;
  lastTxIso: string | null;
  weekTxCount: number;
}

/**
 * Mood hint values:
 * -1 = Suggest negative mood (e.g., over budget)
 *  0 = Neutral
 * +1 = Suggest positive mood (e.g., good streak, under budget)
 */
export type MoodHint = -1 | 0 | 1;

const DEFAULT_METRICS: UserMetrics = {
  txStreakDays: 0,
  lastTxIso: null,
  weekTxCount: 0,
};

/**
 * Metrics service for tracking user engagement.
 *
 * Tracks transaction streaks and weekly activity.
 * Calculates mood hint for AI-Service based on metrics.
 */
@Injectable()
export class MetricsService {
  private readonly log = new Logger(MetricsService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Gets current metrics for a user.
   */
  async getMetrics(userId: string): Promise<UserMetrics> {
    const key = RedisKeys.convMetrics(userId);
    try {
      const json = await this.redis.get(key);
      if (!json) return { ...DEFAULT_METRICS };

      const metrics = JSON.parse(json) as UserMetrics;

      // Validate streak against last transaction date
      return this.validateStreak(metrics);
    } catch (err) {
      this.log.warn(`[getMetrics] Error for user ${userId}`, err);
      return { ...DEFAULT_METRICS };
    }
  }

  /**
   * Records a new transaction and updates streak/count.
   * Called after successful transaction registration.
   */
  async recordTransaction(userId: string): Promise<void> {
    const key = RedisKeys.convMetrics(userId);

    try {
      const current = await this.getMetrics(userId);
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      // Calculate new streak
      let newStreak = 1;
      if (current.lastTxIso) {
        const lastTxDate = new Date(current.lastTxIso).toISOString().split('T')[0];

        if (lastTxDate === todayStr) {
          // Same day, keep current streak
          newStreak = current.txStreakDays;
        } else {
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().split('T')[0];

          if (lastTxDate === yesterdayStr) {
            // Consecutive day, increment streak
            newStreak = current.txStreakDays + 1;
          }
          // Otherwise streak resets to 1
        }
      }

      // Calculate week count (simple: reset if more than 7 days old)
      let newWeekCount = 1;
      if (current.lastTxIso) {
        const daysSinceLast = Math.floor(
          (now.getTime() - new Date(current.lastTxIso).getTime()) / (24 * 60 * 60 * 1000),
        );
        if (daysSinceLast <= 7) {
          newWeekCount = current.weekTxCount + 1;
        }
      }

      const updated: UserMetrics = {
        txStreakDays: newStreak,
        lastTxIso: now.toISOString(),
        weekTxCount: newWeekCount,
      };

      await this.redis.set(key, JSON.stringify(updated), RedisTTL.METRICS);
      this.log.debug(
        `[recordTransaction] Updated metrics for user ${userId}: streak=${newStreak}, weekCount=${newWeekCount}`,
      );
    } catch (err) {
      this.log.warn(`[recordTransaction] Error for user ${userId}`, err);
    }
  }

  /**
   * Calculates mood hint based on user context and metrics.
   * Returns -1, 0, or +1 for AI-Service to compute final mood.
   */
  calculateMoodHint(context: MinimalUserContext, metrics: UserMetrics): MoodHint {
    // Calculate budget percentage if available
    const budgetPercent =
      context.activeBudget?.amount && context.activeBudget.spent != null
        ? context.activeBudget.spent / context.activeBudget.amount
        : null;

    // Negative: Over 90% of budget spent
    if (budgetPercent !== null && budgetPercent > 0.9) {
      return -1;
    }

    // Positive: 7+ day streak
    if (metrics.txStreakDays >= 7) {
      return 1;
    }

    // Positive: Under 25% of budget spent
    if (budgetPercent !== null && budgetPercent < 0.25) {
      return 1;
    }

    // Positive: High weekly activity (10+ transactions)
    if (metrics.weekTxCount >= 10) {
      return 1;
    }

    return 0;
  }

  /**
   * Validates and potentially resets streak if too much time has passed.
   */
  private validateStreak(metrics: UserMetrics): UserMetrics {
    if (!metrics.lastTxIso) {
      return { ...metrics, txStreakDays: 0 };
    }

    const now = new Date();
    const lastTx = new Date(metrics.lastTxIso);
    const daysSinceLast = Math.floor(
      (now.getTime() - lastTx.getTime()) / (24 * 60 * 60 * 1000),
    );

    // If more than 1 day since last transaction, streak is broken
    if (daysSinceLast > 1) {
      return {
        ...metrics,
        txStreakDays: 0,
        weekTxCount: daysSinceLast > 7 ? 0 : metrics.weekTxCount,
      };
    }

    return metrics;
  }
}
