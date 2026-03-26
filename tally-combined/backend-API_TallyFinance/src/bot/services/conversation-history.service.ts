import { Injectable, Logger } from '@nestjs/common';
import { RedisService, RedisKeys, RedisTTL } from '../../redis';
import { ConversationMessage, ConversationMessageMetadata, MediaReference } from './orchestrator.contracts';

/** Maximum entries in history array (25 pairs = 50 entries). */
const MAX_HISTORY_ENTRIES = 50;

/**
 * Tier 1 — Working Memory.
 *
 * Stores the last 25 user/assistant exchange pairs in Redis with metadata.
 * TTL refreshes on every append (4h), keeping active conversations alive.
 * When TTL expires, memory clears automatically.
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
    return this.appendWithMetadata(userId, userMessage, assistantMessage);
  }

  /**
   * Appends a user/assistant pair with optional metadata (tool, amount, txId, etc.).
   * Metadata is used by Phase A to resolve contextual references like "elimínalo".
   */
  async appendWithMetadata(
    userId: string,
    userMessage: string,
    assistantMessage: string,
    metadata?: ConversationMessageMetadata,
    userMedia?: MediaReference[],
  ): Promise<void> {
    const key = RedisKeys.convHistory(userId);
    try {
      const history = await this.getHistory(userId);
      const now = new Date().toISOString();

      // Build user entry — enrich content with media labels if present
      let userContent = userMessage;
      const userMeta: ConversationMessageMetadata | undefined =
        userMedia?.length ? { media: userMedia } : undefined;
      if (userMedia?.length) {
        const mediaLabels = userMedia.map((m) => {
          const icon = m.type === 'image' ? '📷' : m.type === 'audio' ? '🎤' : '📄';
          const desc = m.description ?? m.fileName ?? m.type;
          return `[${icon} ${desc}]`;
        });
        userContent = `${mediaLabels.join(' ')} ${userMessage}`.trim();
      }

      history.push(
        {
          role: 'user',
          content: userContent,
          timestamp: now,
          ...(userMeta ? { metadata: userMeta } : {}),
        },
        {
          role: 'assistant',
          content: assistantMessage,
          timestamp: now,
          ...(metadata ? { metadata } : {}),
        },
      );

      // FIFO trim: keep only the last MAX_HISTORY_ENTRIES
      const trimmed =
        history.length > MAX_HISTORY_ENTRIES
          ? history.slice(history.length - MAX_HISTORY_ENTRIES)
          : history;

      await this.redis.set(key, JSON.stringify(trimmed), RedisTTL.CONV_HISTORY);
      this.log.debug(
        `[appendWithMetadata] Saved ${trimmed.length} entries for user ${userId}`,
      );
    } catch (err) {
      this.log.warn(`[appendWithMetadata] Redis error for user ${userId}`, err);
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
