import { Injectable, Logger } from '@nestjs/common';
import { RedisService, RedisKeys, RedisTTL } from '../../redis';

/**
 * Pending slot-fill state structure.
 * Stored as JSON in Redis with 10min TTL.
 */
export interface PendingSlot {
  tool: string;
  collectedArgs: Record<string, unknown>;
  missingArgs: string[];
  askedAt: string; // ISO timestamp
}

/**
 * Conversation memory service.
 *
 * Manages two separate Redis keys per user:
 * - `conv:{userId}:summary` - Natural language TEXT summarizing recent context (2-24h TTL)
 * - `conv:{userId}:pending` - JSON slot-fill state for multi-turn tool completion (10m TTL)
 */
@Injectable()
export class ConversationService {
  private readonly log = new Logger(ConversationService.name);

  constructor(private readonly redis: RedisService) {}

  // =========================================================================
  // SUMMARY: Natural language context recap (TEXT STRING)
  // =========================================================================

  /**
   * Gets the conversation summary for a user.
   * @returns Summary text or null if not cached
   */
  async getSummary(userId: string): Promise<string | null> {
    const key = RedisKeys.convSummary(userId);
    try {
      return await this.redis.get(key);
    } catch (err) {
      this.log.warn(`[getSummary] Redis error for user ${userId}`, err);
      return null;
    }
  }

  /**
   * Saves a conversation summary.
   * @param userId User ID
   * @param summary Natural language recap (e.g., "Usuario registró 3 gastos en comida...")
   * @param ttlHours TTL in hours (default 2, max 24)
   */
  async saveSummary(
    userId: string,
    summary: string,
    ttlHours: number = 2,
  ): Promise<void> {
    const key = RedisKeys.convSummary(userId);
    const ttl = Math.min(ttlHours, 24) * 3600;
    try {
      await this.redis.set(key, summary, ttl);
      this.log.debug(`[saveSummary] Saved summary for user ${userId}`);
    } catch (err) {
      this.log.warn(`[saveSummary] Redis error for user ${userId}`, err);
    }
  }

  /**
   * Clears the conversation summary.
   */
  async clearSummary(userId: string): Promise<void> {
    const key = RedisKeys.convSummary(userId);
    try {
      await this.redis.del(key);
      this.log.debug(`[clearSummary] Cleared summary for user ${userId}`);
    } catch (err) {
      this.log.warn(`[clearSummary] Redis error for user ${userId}`, err);
    }
  }

  // =========================================================================
  // PENDING: Slot-fill state for multi-turn tool completion (JSON)
  // =========================================================================

  /**
   * Gets pending slot-fill state.
   * @returns PendingSlot or null if no pending state
   */
  async getPending(userId: string): Promise<PendingSlot | null> {
    const key = RedisKeys.convPending(userId);
    try {
      const json = await this.redis.get(key);
      if (!json) return null;
      return JSON.parse(json) as PendingSlot;
    } catch (err) {
      this.log.warn(`[getPending] Redis error for user ${userId}`, err);
      return null;
    }
  }

  /**
   * Sets pending slot-fill state.
   * Automatically expires after 10 minutes if user abandons.
   */
  async setPending(userId: string, pending: PendingSlot): Promise<void> {
    const key = RedisKeys.convPending(userId);
    try {
      await this.redis.set(key, JSON.stringify(pending), RedisTTL.CONV_PENDING);
      this.log.debug(
        `[setPending] Set pending for user ${userId}: tool=${pending.tool}, missing=${pending.missingArgs.join(',')}`,
      );
    } catch (err) {
      this.log.warn(`[setPending] Redis error for user ${userId}`, err);
    }
  }

  /**
   * Clears pending slot-fill state (after completion or explicit cancel).
   */
  async clearPending(userId: string): Promise<void> {
    const key = RedisKeys.convPending(userId);
    try {
      await this.redis.del(key);
      this.log.debug(`[clearPending] Cleared pending for user ${userId}`);
    } catch (err) {
      this.log.warn(`[clearPending] Redis error for user ${userId}`, err);
    }
  }

  /**
   * Checks if user has pending slot-fill state.
   */
  async hasPending(userId: string): Promise<boolean> {
    const key = RedisKeys.convPending(userId);
    try {
      return await this.redis.exists(key);
    } catch (err) {
      this.log.warn(`[hasPending] Redis error for user ${userId}`, err);
      return false;
    }
  }
}
