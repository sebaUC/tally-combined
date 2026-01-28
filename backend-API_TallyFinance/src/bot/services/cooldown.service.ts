import { Injectable, Logger } from '@nestjs/common';
import { RedisService, RedisKeys, RedisTTL } from '../../redis';

/**
 * Nudge types that can be tracked for cooldowns.
 */
export type NudgeType = 'budget' | 'goal' | 'streak';

/**
 * Cooldown state stored in Redis.
 */
export interface Cooldowns {
  lastNudge?: string; // ISO timestamp, any nudge type
  lastBudgetWarning?: string; // ISO timestamp, >90% budget only
}

/**
 * Runtime context flags for AI-Service.
 * Tells AI what nudges are allowed.
 */
export interface CooldownFlags {
  canNudge: boolean;
  canBudgetWarning: boolean;
  canEasterEgg: boolean;
}

// Cooldown durations in milliseconds
const GLOBAL_NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const BUDGET_WARNING_COOLDOWN_MS = 5 * 60 * 60 * 1000; // 5 hours

/**
 * Simplified cooldown service for MVP.
 *
 * Rules:
 * - Global nudge: 24h cooldown (any type)
 * - Budget warning: 5h cooldown (only if spent > 90%)
 * - Easter eggs: DISABLED in MVP
 */
@Injectable()
export class CooldownService {
  private readonly log = new Logger(CooldownService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Gets current cooldown flags for AI-Service.
   */
  async getCooldownFlags(userId: string): Promise<CooldownFlags> {
    const cooldowns = await this.getCooldowns(userId);

    return {
      canNudge: this.canNudge(cooldowns),
      canBudgetWarning: this.canBudgetWarning(cooldowns),
      canEasterEgg: false, // Disabled in MVP
    };
  }

  /**
   * Checks if global nudge is allowed (24h since last nudge).
   */
  private canNudge(cooldowns: Cooldowns): boolean {
    if (!cooldowns.lastNudge) return true;
    const elapsed = Date.now() - new Date(cooldowns.lastNudge).getTime();
    return elapsed > GLOBAL_NUDGE_COOLDOWN_MS;
  }

  /**
   * Checks if budget warning is allowed (5h since last warning).
   */
  private canBudgetWarning(cooldowns: Cooldowns): boolean {
    if (!cooldowns.lastBudgetWarning) return true;
    const elapsed = Date.now() - new Date(cooldowns.lastBudgetWarning).getTime();
    return elapsed > BUDGET_WARNING_COOLDOWN_MS;
  }

  /**
   * Records a nudge event. Called after Phase B if did_nudge=true.
   */
  async recordNudge(userId: string, type: NudgeType): Promise<void> {
    try {
      const cooldowns = await this.getCooldowns(userId);
      const now = new Date().toISOString();

      cooldowns.lastNudge = now;
      if (type === 'budget') {
        cooldowns.lastBudgetWarning = now;
      }

      await this.saveCooldowns(userId, cooldowns);
      this.log.debug(`[recordNudge] Recorded ${type} nudge for user ${userId}`);
    } catch (err) {
      this.log.warn(`[recordNudge] Error for user ${userId}`, err);
    }
  }

  /**
   * Gets cooldown state from Redis.
   */
  private async getCooldowns(userId: string): Promise<Cooldowns> {
    const key = RedisKeys.convCooldowns(userId);
    try {
      const json = await this.redis.get(key);
      if (!json) return {};
      return JSON.parse(json) as Cooldowns;
    } catch (err) {
      this.log.warn(`[getCooldowns] Error for user ${userId}`, err);
      return {};
    }
  }

  /**
   * Saves cooldown state to Redis.
   */
  private async saveCooldowns(userId: string, cooldowns: Cooldowns): Promise<void> {
    const key = RedisKeys.convCooldowns(userId);
    await this.redis.set(key, JSON.stringify(cooldowns), RedisTTL.COOLDOWNS);
  }

  /**
   * Resets all cooldowns for a user (for testing).
   */
  async resetCooldowns(userId: string): Promise<void> {
    const key = RedisKeys.convCooldowns(userId);
    try {
      await this.redis.del(key);
      this.log.debug(`[resetCooldowns] Reset cooldowns for user ${userId}`);
    } catch (err) {
      this.log.warn(`[resetCooldowns] Error for user ${userId}`, err);
    }
  }
}
