/**
 * Resilience utilities for handling transient failures.
 *
 * Features:
 * - Retry with exponential backoff
 * - Circuit breaker pattern
 * - Rate limiting helpers
 */

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  shouldRetry?: (error: unknown) => boolean;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 2000,
};

/**
 * Retries an async operation with exponential backoff.
 *
 * @param fn - The async function to retry
 * @param options - Retry configuration
 * @returns The result of the function
 * @throws The last error if all retries fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (opts.shouldRetry && !opts.shouldRetry(error)) {
        throw error;
      }

      // Don't wait after the last attempt
      if (attempt < opts.maxAttempts) {
        const delay = Math.min(
          opts.baseDelayMs * Math.pow(2, attempt - 1),
          opts.maxDelayMs,
        );
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Simple circuit breaker state machine.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failures exceeded threshold, requests fail fast
 * - HALF_OPEN: Testing if service recovered
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxAttempts: number;
}

const DEFAULT_CIRCUIT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxAttempts: 3,
};

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;
  private readonly options: CircuitBreakerOptions;

  constructor(
    private readonly name: string,
    options: Partial<CircuitBreakerOptions> = {},
  ) {
    this.options = { ...DEFAULT_CIRCUIT_OPTIONS, ...options };
  }

  /**
   * Executes an operation through the circuit breaker.
   *
   * @param fn - The async function to execute
   * @returns The result of the function
   * @throws CircuitOpenError if circuit is open
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should transition from OPEN to HALF_OPEN
    if (this.state === 'OPEN') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.options.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.halfOpenAttempts = 0;
      } else {
        throw new CircuitOpenError(
          this.name,
          this.options.resetTimeoutMs - timeSinceFailure,
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.options.halfOpenMaxAttempts) {
        // Recovered
        this.state = 'CLOSED';
        this.failures = 0;
      }
    } else {
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Failed during recovery, back to OPEN
      this.state = 'OPEN';
    } else if (this.failures >= this.options.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): { state: CircuitState; failures: number } {
    return { state: this.state, failures: this.failures };
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.halfOpenAttempts = 0;
  }
}

export class CircuitOpenError extends Error {
  constructor(
    public readonly circuitName: string,
    public readonly retryAfterMs: number,
  ) {
    super(
      `Circuit breaker '${circuitName}' is open. Retry after ${retryAfterMs}ms`,
    );
    this.name = 'CircuitOpenError';
  }
}

/**
 * Simple in-memory rate limiter using sliding window.
 * Use this as a fallback when Redis is not available.
 */
export class RateLimiter {
  private readonly requests = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Checks if a request is allowed for the given key.
   *
   * @param key - Unique identifier (e.g., userId, IP)
   * @returns true if allowed, false if rate limited
   */
  isAllowed(key: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let timestamps = this.requests.get(key) || [];

    // Remove expired timestamps
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      this.requests.set(key, timestamps);
      return false;
    }

    timestamps.push(now);
    this.requests.set(key, timestamps);
    return true;
  }

  /**
   * Gets remaining requests for a key.
   */
  getRemaining(key: string): number {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = (this.requests.get(key) || []).filter(
      (t) => t > windowStart,
    );
    return Math.max(0, this.maxRequests - timestamps.length);
  }

  /**
   * Cleans up old entries to prevent memory leaks.
   * Call periodically (e.g., every minute).
   */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [key, timestamps] of this.requests.entries()) {
      const valid = timestamps.filter((t) => t > windowStart);
      if (valid.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, valid);
      }
    }
  }
}

/**
 * Interface for async rate limiting (Redis or fallback)
 */
export interface AsyncRateLimiter {
  isAllowed(key: string): Promise<boolean>;
}

/**
 * Creates an async rate limiter that uses Redis via the provided service.
 * Falls back to in-memory if Redis check fails.
 */
export function createAsyncRateLimiter(
  redisService: {
    rateLimitCheck: (
      key: string,
      max: number,
      windowMs: number,
    ) => Promise<boolean>;
  },
  maxRequests: number,
  windowMs: number,
): AsyncRateLimiter {
  const fallback = new RateLimiter(maxRequests, windowMs);

  return {
    async isAllowed(key: string): Promise<boolean> {
      try {
        return await redisService.rateLimitCheck(key, maxRequests, windowMs);
      } catch {
        // Fallback to in-memory on Redis failure
        return fallback.isAllowed(key);
      }
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks if an error is a transient DB error that should be retried.
 */
export function isTransientDbError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as Record<string, unknown>;

  // Supabase/PostgreSQL transient errors
  const transientCodes = [
    '40001', // serialization_failure
    '40P01', // deadlock_detected
    '57P03', // cannot_connect_now
    '08006', // connection_failure
    '08001', // sqlclient_unable_to_establish_sqlconnection
  ];

  if (err.code && transientCodes.includes(String(err.code))) {
    return true;
  }

  // Network errors
  const message = String(err.message || '').toLowerCase();
  if (
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('econnrefused')
  ) {
    return true;
  }

  return false;
}
