import { Injectable, Logger } from '@nestjs/common';
import { RedisService, RedisKeys, RedisTTL } from '../../redis';
import { ConversationMessage } from './orchestrator.contracts';

/** Maximum entries in history array (10 pairs = 20 entries). */
const MAX_HISTORY_ENTRIES = 20;

/**
 * Tier 1 — Working Memory.
 *
 * Stores the last 10 user/assistant exchange pairs verbatim in Redis.
 * TTL refreshes on every append, keeping active conversations alive.
 * When TTL expires (10 min inactivity), memory clears automatically.
 *
 * Thread-safety: `lock:{userId}` in BotService guarantees single-writer per user,
 * so the non-atomic get-then-set pattern is safe.
 */
@Injectable()
export class ConversationHistoryService {
  private readonly log = new Logger(ConversationHistoryService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Gets conversation history for a user.
   * @returns Array of messages or empty array on miss/error (graceful degradation).
   */
  async getHistory(userId: string): Promise<ConversationMessage[]> {
    const key = RedisKeys.convHistory(userId);
    try {
      const json = await this.redis.get(key);
      if (!json) return [];
      return JSON.parse(json) as ConversationMessage[];
    } catch (err) {
      this.log.warn(`[getHistory] Redis error for user ${userId}`, err);
      return [];
    }
  }

  /**
   * Appends a user/assistant pair to history with FIFO trimming.
   * Refreshes TTL on every call, keeping active conversations alive.
   */
  async appendToHistory(
    userId: string,
    userMessage: string,
    assistantMessage: string,
  ): Promise<void> {
    const key = RedisKeys.convHistory(userId);
    try {
      const history = await this.getHistory(userId);

      history.push(
        { role: 'user', content: userMessage },
        { role: 'assistant', content: assistantMessage },
      );

      // FIFO trim: keep only the last MAX_HISTORY_ENTRIES
      const trimmed =
        history.length > MAX_HISTORY_ENTRIES
          ? history.slice(history.length - MAX_HISTORY_ENTRIES)
          : history;

      await this.redis.set(key, JSON.stringify(trimmed), RedisTTL.CONV_HISTORY);
      this.log.debug(
        `[appendToHistory] Saved ${trimmed.length} entries for user ${userId}`,
      );
    } catch (err) {
      this.log.warn(`[appendToHistory] Redis error for user ${userId}`, err);
    }
  }

  /**
   * Clears conversation history for a user.
   */
  async clearHistory(userId: string): Promise<void> {
    const key = RedisKeys.convHistory(userId);
    try {
      await this.redis.del(key);
      this.log.debug(`[clearHistory] Cleared history for user ${userId}`);
    } catch (err) {
      this.log.warn(`[clearHistory] Redis error for user ${userId}`, err);
    }
  }
}
