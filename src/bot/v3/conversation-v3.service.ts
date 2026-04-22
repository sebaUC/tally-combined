import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis';

const CONV_KEY = (userId: string) => `conv:v3:${userId}`;
const TTL = 4 * 3600; // 4 hours
const MAX_ENTRIES = 50;

/**
 * V3 Conversation Service — Redis-backed Gemini message history.
 *
 * Stores the full conversation including function calls and responses
 * in Gemini's native Content[] format. No lossy summarization.
 */
@Injectable()
export class ConversationV3Service {
  private readonly log = new Logger(ConversationV3Service.name);

  constructor(private readonly redis: RedisService) {}

  async getHistory(userId: string): Promise<any[]> {
    try {
      const json = await this.redis.get(CONV_KEY(userId));
      if (!json) return [];
      let history = JSON.parse(json);

      // Gemini requires history to start with role 'user'.
      // Drop leading non-user entries from corrupted/trimmed histories.
      while (history.length > 0 && history[0].role !== 'user') {
        history = history.slice(1);
      }

      return history;
    } catch (err) {
      this.log.warn(`[getHistory] Redis error for ${userId}`, err);
      return [];
    }
  }

  async saveHistory(userId: string, history: any[]): Promise<void> {
    try {
      // Strip inlineData (base64 images/audio) to save space
      const cleaned = history.map((entry) => {
        if (!entry.parts) return entry;
        return {
          ...entry,
          parts: entry.parts.map((part: any) => {
            if (part.inlineData) {
              return { text: `[📷 ${part.inlineData.mimeType || 'media'}]` };
            }
            return part;
          }),
        };
      });

      // FIFO trim
      let trimmed =
        cleaned.length > MAX_ENTRIES
          ? cleaned.slice(cleaned.length - MAX_ENTRIES)
          : cleaned;

      // Gemini requires history to start with role 'user'.
      // After trimming, drop leading non-user entries to avoid crash.
      while (trimmed.length > 0 && trimmed[0].role !== 'user') {
        trimmed = trimmed.slice(1);
      }

      await this.redis.set(CONV_KEY(userId), JSON.stringify(trimmed), TTL);
    } catch (err) {
      this.log.warn(`[saveHistory] Redis error for ${userId}`, err);
    }
  }

  async reset(userId: string): Promise<void> {
    try {
      await this.redis.del(CONV_KEY(userId));
      this.log.debug(`[reset] Cleared conversation for ${userId}`);
    } catch (err) {
      this.log.warn(`[reset] Redis error for ${userId}`, err);
    }
  }
}
