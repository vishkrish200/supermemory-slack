import type { Context, MiddlewareHandler, Next } from "hono";
import { HTTPException } from "hono/http-exception";

export interface SlackRateLimitConfig {
  // Slack method name (e.g., 'conversations.history', 'chat.postMessage')
  method: string;
  // Requests per minute for this method
  requestsPerMinute: number;
  // Special handling for specific methods
  specialRules?: {
    messagesPerRequest?: number;
    perChannelLimit?: boolean;
  };
}

/**
 * Slack API rate limit configurations based on their tier system
 * https://api.slack.com/docs/rate-limits
 */
export const SLACK_RATE_LIMITS: Record<string, SlackRateLimitConfig> = {
  // Tier 1 (Most restrictive - 1+ requests per minute)
  "conversations.history": {
    method: "conversations.history",
    requestsPerMinute: 1, // New apps: 1 req/min, 15 messages per request
    specialRules: {
      messagesPerRequest: 15,
    },
  },
  "conversations.replies": {
    method: "conversations.replies",
    requestsPerMinute: 1, // New apps: 1 req/min, 15 messages per request
    specialRules: {
      messagesPerRequest: 15,
    },
  },

  // Tier 2 (20+ requests per minute)
  "conversations.list": {
    method: "conversations.list",
    requestsPerMinute: 20,
  },
  "users.list": {
    method: "users.list",
    requestsPerMinute: 20,
  },

  // Tier 3 (50+ requests per minute)
  "conversations.info": {
    method: "conversations.info",
    requestsPerMinute: 50,
  },
  "users.info": {
    method: "users.info",
    requestsPerMinute: 50,
  },
  "auth.test": {
    method: "auth.test",
    requestsPerMinute: 50,
  },

  // Tier 4 (100+ requests per minute)
  "chat.postMessage": {
    method: "chat.postMessage",
    requestsPerMinute: 60, // Conservative: ~1 per second
    specialRules: {
      perChannelLimit: true, // 1 message per second per channel
    },
  },

  // Events API
  events: {
    method: "events",
    requestsPerMinute: 500, // 30,000 per hour = ~500 per minute
  },
};

/**
 * In-memory rate limit storage for Slack API calls
 * Key format: `{teamId}:{method}:{channel?}`
 */
class SlackRateLimitStore {
  private store: Map<
    string,
    {
      count: number;
      resetAt: number;
      lastRequest: number;
    }
  > = new Map();

  private generateKey(
    teamId: string,
    method: string,
    channelId?: string
  ): string {
    return channelId && SLACK_RATE_LIMITS[method]?.specialRules?.perChannelLimit
      ? `${teamId}:${method}:${channelId}`
      : `${teamId}:${method}`;
  }

  async checkLimit(
    teamId: string,
    method: string,
    channelId?: string
  ): Promise<{ allowed: boolean; retryAfter?: number; remaining?: number }> {
    // Periodically cleanup expired entries (roughly every 100 requests)
    if (Math.random() < 0.01) {
      this.cleanup();
    }

    const config = SLACK_RATE_LIMITS[method];
    if (!config) {
      // No specific limit configured, allow the request
      return { allowed: true };
    }

    const key = this.generateKey(teamId, method, channelId);
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute window

    const entry = this.store.get(key);

    if (!entry) {
      // First request in this window
      this.store.set(key, {
        count: 1,
        resetAt: now + windowMs,
        lastRequest: now,
      });
      return {
        allowed: true,
        remaining: config.requestsPerMinute - 1,
      };
    }

    // Check if window has expired
    if (now >= entry.resetAt) {
      // Reset the window
      this.store.set(key, {
        count: 1,
        resetAt: now + windowMs,
        lastRequest: now,
      });
      return {
        allowed: true,
        remaining: config.requestsPerMinute - 1,
      };
    }

    // Check if rate limit exceeded
    if (entry.count >= config.requestsPerMinute) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return {
        allowed: false,
        retryAfter,
        remaining: 0,
      };
    }

    // Special handling for per-channel limits (like chat.postMessage)
    if (config.specialRules?.perChannelLimit) {
      const timeSinceLastRequest = now - entry.lastRequest;
      const minInterval = 1000; // 1 second minimum between requests

      if (timeSinceLastRequest < minInterval) {
        const retryAfter = Math.ceil(
          (minInterval - timeSinceLastRequest) / 1000
        );
        return {
          allowed: false,
          retryAfter,
          remaining: config.requestsPerMinute - entry.count,
        };
      }
    }

    // Update the count
    entry.count++;
    entry.lastRequest = now;
    this.store.set(key, entry);

    return {
      allowed: true,
      remaining: config.requestsPerMinute - entry.count,
    };
  }

  async recordRequest(
    teamId: string,
    method: string,
    channelId?: string
  ): Promise<void> {
    // The rate check already records the request, so this is mainly for cleanup
    const key = this.generateKey(teamId, method, channelId);
    const entry = this.store.get(key);

    if (entry) {
      entry.lastRequest = Date.now();
      this.store.set(key, entry);
    }
  }

  // Cleanup expired entries periodically
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now >= entry.resetAt) {
        this.store.delete(key);
      }
    }
  }
}

// Global rate limit store instance
const slackRateLimitStore = new SlackRateLimitStore();

// Note: Removed global setInterval for Cloudflare Workers compatibility
// Cleanup is now called during rate limit checks to avoid global async operations

/**
 * Middleware to enforce Slack API rate limits
 */
export const slackRateLimit = (
  method: string,
  channelIdExtractor?: (c: Context) => string | undefined
): MiddlewareHandler => {
  return async (c: Context, next: Next) => {
    // Extract team ID from context (you'll need to implement this based on your auth)
    const teamId = c.get("teamId") || c.req.header("X-Slack-Team-Id");

    if (!teamId) {
      console.warn("No team ID found for Slack rate limiting");
      await next();
      return;
    }

    const channelId = channelIdExtractor ? channelIdExtractor(c) : undefined;

    // Check rate limit
    const result = await slackRateLimitStore.checkLimit(
      teamId,
      method,
      channelId
    );

    if (!result.allowed) {
      // Set rate limit headers
      c.header(
        "X-RateLimit-Limit",
        SLACK_RATE_LIMITS[method]?.requestsPerMinute?.toString() || "0"
      );
      c.header("X-RateLimit-Remaining", "0");
      c.header(
        "X-RateLimit-Reset",
        Math.floor(
          (Date.now() + (result.retryAfter || 60) * 1000) / 1000
        ).toString()
      );

      if (result.retryAfter) {
        c.header("Retry-After", result.retryAfter.toString());
      }

      throw new HTTPException(429, {
        message: `Slack API rate limit exceeded for ${method}. Retry after ${result.retryAfter} seconds.`,
      });
    }

    // Set rate limit headers for successful requests
    if (result.remaining !== undefined) {
      c.header(
        "X-RateLimit-Limit",
        SLACK_RATE_LIMITS[method]?.requestsPerMinute?.toString() || "0"
      );
      c.header("X-RateLimit-Remaining", result.remaining.toString());
    }

    await next();
  };
};

/**
 * Helper function to handle Slack API responses and extract rate limit info
 */
export const handleSlackApiResponse = async (
  response: Response
): Promise<Response> => {
  // Check if Slack returned a rate limit error
  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    console.warn(
      `Slack API rate limit hit. Retry after: ${retryAfter} seconds`
    );

    // You could implement automatic retry logic here
    throw new HTTPException(429, {
      message: `Slack API rate limit exceeded. Retry after ${retryAfter} seconds.`,
      res: response,
    });
  }

  return response;
};

/**
 * Utility to create a rate-limited Slack API client wrapper
 */
export class RateLimitedSlackClient {
  private teamId: string;

  constructor(teamId: string) {
    this.teamId = teamId;
  }

  async makeRequest(
    method: string,
    url: string,
    options: RequestInit,
    channelId?: string
  ): Promise<Response> {
    // Check rate limit before making request
    const result = await slackRateLimitStore.checkLimit(
      this.teamId,
      method,
      channelId
    );

    if (!result.allowed) {
      throw new Error(
        `Rate limit exceeded for ${method}. Retry after ${result.retryAfter} seconds.`
      );
    }

    // Make the request
    const response = await fetch(url, options);

    // Handle Slack's rate limit response
    return handleSlackApiResponse(response);
  }

  async callMethod(
    method: string,
    token: string,
    params: Record<string, any> = {},
    channelId?: string
  ): Promise<any> {
    const url = `https://slack.com/api/${method}`;
    const body = new URLSearchParams({
      token,
      ...params,
    });

    const response = await this.makeRequest(
      method,
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${token}`,
        },
        body: body.toString(),
      },
      channelId
    );

    return response.json();
  }
}

export { slackRateLimitStore };
