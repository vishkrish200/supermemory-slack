/**
 * Configuration options for the Supermemory rate limiter
 */
export interface SupermemoryRateLimiterConfig {
  requestsPerMinute: number;
  burstCapacity?: number; // Optional burst allowance (defaults to requestsPerMinute)
  refillIntervalMs?: number; // How often to refill tokens (defaults to 1000ms)
}

/**
 * Token bucket rate limiter specifically designed for Supermemory API constraints
 * Supports burst traffic while maintaining average rate limits
 */
export class SupermemoryRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per millisecond
  private readonly refillIntervalMs: number;

  constructor(config: SupermemoryRateLimiterConfig) {
    this.capacity = config.burstCapacity || config.requestsPerMinute;
    this.tokens = this.capacity;
    this.refillIntervalMs = config.refillIntervalMs || 1000;
    this.refillRate = config.requestsPerMinute / (60 * 1000); // tokens per ms
    this.lastRefill = Date.now();
  }

  /**
   * Attempt to consume a token for an API request
   * @returns true if token available, false if rate limited
   */
  tryConsume(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Get the estimated wait time until next token is available
   * @returns milliseconds to wait, or 0 if token available now
   */
  getWaitTimeMs(): number {
    this.refill();

    if (this.tokens >= 1) {
      return 0;
    }

    // Calculate time needed to refill one token
    const tokensNeeded = 1 - this.tokens;
    return Math.ceil(tokensNeeded / this.refillRate);
  }

  /**
   * Get current rate limiter status for monitoring/debugging
   */
  getStatus(): {
    availableTokens: number;
    capacity: number;
    refillRate: number;
    lastRefill: number;
  } {
    this.refill();

    return {
      availableTokens: Math.floor(this.tokens),
      capacity: this.capacity,
      refillRate: this.refillRate * 60 * 1000, // convert to per-minute for readability
      lastRefill: this.lastRefill,
    };
  }

  /**
   * Wait until a token becomes available
   * @param maxWaitMs Maximum time to wait in milliseconds
   * @returns Promise that resolves when token is available, rejects if max wait exceeded
   */
  async waitForToken(maxWaitMs = 60000): Promise<void> {
    const startTime = Date.now();

    while (!this.tryConsume()) {
      const elapsed = Date.now() - startTime;

      if (elapsed >= maxWaitMs) {
        throw new Error(`Rate limit wait exceeded ${maxWaitMs}ms`);
      }

      const waitTime = Math.min(this.getWaitTimeMs(), maxWaitMs - elapsed);

      if (waitTime > 0) {
        await this.sleep(waitTime);
      }
    }
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    // Only refill if enough time has passed
    if (elapsed >= this.refillIntervalMs) {
      const tokensToAdd = elapsed * this.refillRate;
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Reset the rate limiter (useful for testing)
   */
  reset(): void {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }
}

/**
 * Global rate limiter store for managing rate limiters by API key
 */
export class SupermemoryRateLimiterStore {
  private limiters = new Map<string, SupermemoryRateLimiter>();
  private defaultConfig: SupermemoryRateLimiterConfig;

  constructor(defaultConfig: SupermemoryRateLimiterConfig) {
    this.defaultConfig = defaultConfig;
  }

  /**
   * Get or create a rate limiter for the specified API key
   */
  getLimiter(apiKey: string): SupermemoryRateLimiter {
    const keyHash = this.hashApiKey(apiKey);

    if (!this.limiters.has(keyHash)) {
      this.limiters.set(
        keyHash,
        new SupermemoryRateLimiter(this.defaultConfig)
      );
    }

    return this.limiters.get(keyHash)!;
  }

  /**
   * Update configuration for all existing limiters
   */
  updateConfig(newConfig: SupermemoryRateLimiterConfig): void {
    this.defaultConfig = newConfig;
    // Note: Existing limiters keep their current config until recreated
    // This is intentional to avoid disrupting in-flight rate limiting
  }

  /**
   * Get status for all active rate limiters
   */
  getAllStatus(): Record<
    string,
    ReturnType<SupermemoryRateLimiter["getStatus"]>
  > {
    const status: Record<
      string,
      ReturnType<SupermemoryRateLimiter["getStatus"]>
    > = {};

    for (const [keyHash, limiter] of this.limiters.entries()) {
      status[keyHash] = limiter.getStatus();
    }

    return status;
  }

  /**
   * Clean up unused rate limiters (call periodically to prevent memory leaks)
   */
  cleanup(): void {
    const cutoff = Date.now() - 10 * 60 * 1000; // 10 minutes

    for (const [keyHash, limiter] of this.limiters.entries()) {
      const status = limiter.getStatus();

      // Remove limiters that haven't been used recently and are at full capacity
      if (
        status.lastRefill < cutoff &&
        status.availableTokens === status.capacity
      ) {
        this.limiters.delete(keyHash);
      }
    }
  }

  /**
   * Create a simple hash of the API key for internal storage
   */
  private hashApiKey(apiKey: string): string {
    // Simple hash to avoid storing full API keys in memory
    let hash = 0;
    for (let i = 0; i < apiKey.length; i++) {
      const char = apiKey.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }
}

/**
 * Factory function to create default rate limiter configuration for Supermemory
 */
export function createSupermemoryRateLimiterConfig(env?: {
  SUPERMEMORY_RATE_LIMIT?: string;
  SUPERMEMORY_BURST_CAPACITY?: string;
}): SupermemoryRateLimiterConfig {
  const requestsPerMinute = env?.SUPERMEMORY_RATE_LIMIT
    ? Number.parseInt(env.SUPERMEMORY_RATE_LIMIT, 10)
    : 100; // Default to Supermemory's documented limit

  const burstCapacity = env?.SUPERMEMORY_BURST_CAPACITY
    ? Number.parseInt(env.SUPERMEMORY_BURST_CAPACITY, 10)
    : requestsPerMinute; // Default to same as rate limit

  return {
    requestsPerMinute,
    burstCapacity,
    refillIntervalMs: 1000, // Refill every second for smooth operation
  };
}
