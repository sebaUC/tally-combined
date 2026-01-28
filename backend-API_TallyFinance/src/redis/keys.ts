/**
 * Centralized Redis key patterns for TallyFinance.
 * All keys and TTLs defined here for consistency.
 */
export const RedisKeys = {
  // User context cache
  userContext: (userId: string) => `ctx:${userId}`,

  // Conversation state (SEPARATE keys)
  convSummary: (userId: string) => `conv:${userId}:summary`,
  convPending: (userId: string) => `conv:${userId}:pending`,

  // Cooldowns
  convCooldowns: (userId: string) => `conv:${userId}:cooldowns`,

  // User metrics
  convMetrics: (userId: string) => `conv:${userId}:metrics`,

  // Rate limiting (sliding window)
  rateLimit: (externalId: string) => `rl:${externalId}`,

  // Concurrency safety
  lock: (userId: string) => `lock:${userId}`,
  msgDedup: (msgId: string) => `msg:${msgId}`,
};

/**
 * TTL constants in seconds
 */
export const RedisTTL = {
  USER_CONTEXT: 60, // 60 seconds
  CONV_SUMMARY_DEFAULT: 2 * 3600, // 2 hours
  CONV_SUMMARY_MAX: 24 * 3600, // 24 hours
  CONV_PENDING: 600, // 10 minutes
  COOLDOWNS: 30 * 24 * 3600, // 30 days
  METRICS: 30 * 24 * 3600, // 30 days
  RATE_LIMIT: 60, // 60 seconds
  LOCK: 5, // 5 seconds
  MSG_DEDUP_PROCESSING: 120, // 2 minutes (short TTL for crash recovery)
  MSG_DEDUP_DONE: 24 * 3600, // 24 hours (final state)
};
