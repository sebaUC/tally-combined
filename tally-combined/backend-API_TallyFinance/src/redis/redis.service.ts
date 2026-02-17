import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';

/**
 * Redis service with in-memory fallback for single-instance MVP.
 * GUARD: If MULTI_INSTANCE=true and Redis unavailable, operations fail hard.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private readonly fallbackCache = new Map<
    string,
    { value: string; expiresAt: number }
  >();
  private readonly fallbackLocks = new Map<string, number>();
  private readonly multiInstance: boolean;
  private connected = false;

  constructor(private readonly config: ConfigService) {
    this.multiInstance = config.get('MULTI_INSTANCE') === 'true';
    this.initializeClient();
  }

  private initializeClient() {
    const redisUrl = this.config.get<string>('REDIS_URL');

    if (!redisUrl) {
      this.logger.warn('REDIS_URL not configured, using in-memory fallback');
      return;
    }

    try {
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) return null;
          return Math.min(times * 100, 2000);
        },
        lazyConnect: true,
      });

      this.client.on('connect', () => {
        this.connected = true;
        this.logger.log('Redis connected');
      });

      this.client.on('error', (err) => {
        this.connected = false;
        this.logger.error('Redis error', err.message);
      });

      this.client.on('close', () => {
        this.connected = false;
        this.logger.warn('Redis connection closed');
      });

      this.client.connect().catch((err) => {
        this.logger.error('Failed to connect to Redis', err.message);
      });
    } catch (err) {
      this.logger.error('Failed to initialize Redis client', err);
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }

  /**
   * Check if Redis is available, throw if multi-instance and unavailable
   */
  private checkAvailability(): boolean {
    if (this.connected && this.client) {
      return true;
    }
    if (this.multiInstance) {
      throw new Error('Redis unavailable in multi-instance mode');
    }
    return false;
  }

  /**
   * Get value from Redis or fallback
   */
  async get(key: string): Promise<string | null> {
    if (this.checkAvailability()) {
      return this.client!.get(key);
    }

    // Fallback to in-memory
    const entry = this.fallbackCache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.value;
    }
    this.fallbackCache.delete(key);
    return null;
  }

  /**
   * Set value with TTL (seconds)
   */
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.checkAvailability()) {
      await this.client!.setex(key, ttlSeconds, value);
      return;
    }

    // Fallback to in-memory
    this.fallbackCache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  /**
   * Delete key
   */
  async del(key: string): Promise<void> {
    if (this.checkAvailability()) {
      await this.client!.del(key);
      return;
    }

    this.fallbackCache.delete(key);
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    if (this.checkAvailability()) {
      const result = await this.client!.exists(key);
      return result === 1;
    }

    const entry = this.fallbackCache.get(key);
    return !!(entry && entry.expiresAt > Date.now());
  }

  /**
   * Acquire a distributed lock with TTL
   * Returns true if lock acquired, false if already held
   */
  async acquireLock(key: string, ttlMs: number): Promise<boolean> {
    const lockValue = randomUUID();
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    if (this.checkAvailability()) {
      const result = await this.client!.set(
        key,
        lockValue,
        'EX',
        ttlSeconds,
        'NX',
      );
      return result === 'OK';
    }

    // Fallback to in-memory
    const existingLock = this.fallbackLocks.get(key);
    if (existingLock && existingLock > Date.now()) {
      return false;
    }
    this.fallbackLocks.set(key, Date.now() + ttlMs);
    return true;
  }

  /**
   * Release a lock
   */
  async releaseLock(key: string): Promise<void> {
    if (this.checkAvailability()) {
      await this.client!.del(key);
      return;
    }

    this.fallbackLocks.delete(key);
  }

  /**
   * Rate limiter operations using sorted sets
   */
  async rateLimitCheck(
    key: string,
    maxRequests: number,
    windowMs: number,
  ): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - windowMs;

    if (this.checkAvailability()) {
      // Remove expired entries
      await this.client!.zremrangebyscore(key, '-inf', windowStart);

      // Count current entries
      const count = await this.client!.zcard(key);
      if (count >= maxRequests) {
        return false;
      }

      // Add new entry with unique member
      const uniqueMember = `${now}-${randomUUID().slice(0, 8)}`;
      await this.client!.zadd(key, now, uniqueMember);
      await this.client!.expire(key, Math.ceil(windowMs / 1000));

      return true;
    }

    // Fallback: simple in-memory rate limiting
    const existing = this.fallbackCache.get(key);
    let count = 0;
    if (existing && existing.expiresAt > Date.now()) {
      count = parseInt(existing.value, 10) || 0;
    }
    if (count >= maxRequests) {
      return false;
    }
    this.fallbackCache.set(key, {
      value: String(count + 1),
      expiresAt: Date.now() + windowMs,
    });
    return true;
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    if (!this.client || !this.connected) {
      return !this.multiInstance; // Healthy in single-instance fallback mode
    }

    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return !this.multiInstance;
    }
  }

  /**
   * Get connection status
   */
  getStatus(): { connected: boolean; mode: 'redis' | 'fallback' } {
    return {
      connected: this.connected,
      mode: this.connected && this.client ? 'redis' : 'fallback',
    };
  }
}
