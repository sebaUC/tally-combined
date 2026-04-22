/**
 * Centralized Redis key patterns for TallyFinance.
 * All keys and TTLs defined here for consistency.
 */
export const RedisKeys = {
  userContext: (userId: string) => `ctx:${userId}`,
  convMetrics: (userId: string) => `conv:${userId}:metrics`,
  rateLimit: (externalId: string) => `rl:${externalId}`,
  lock: (userId: string) => `lock:${userId}`,
  msgDedup: (msgId: string) => `msg:${msgId}`,
};

/**
 * TTL constants in seconds
 */
export const RedisTTL = {
  USER_CONTEXT: 60,
  METRICS: 30 * 24 * 3600, // 30 days
  RATE_LIMIT: 60,
  LOCK: 5,
  MSG_DEDUP_PROCESSING: 120, // 2 minutes (short TTL for crash recovery)
  MSG_DEDUP_DONE: 24 * 3600, // 24 hours (final state)
};
