import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  slackRateLimitStore,
  SLACK_RATE_LIMITS,
  RateLimitedSlackClient,
} from "../src/middleware/slackRateLimit";

describe("SlackRateLimit", () => {
  const testTeamId = "T123456789";
  const testChannelId = "C123456789";

  beforeEach(() => {
    // Clear any existing rate limit data
    slackRateLimitStore.cleanup();
  });

  describe("SLACK_RATE_LIMITS configuration", () => {
    it("should have proper configuration for conversations.history", () => {
      const config = SLACK_RATE_LIMITS["conversations.history"];
      expect(config).toBeDefined();
      expect(config.requestsPerMinute).toBe(1);
      expect(config.specialRules?.messagesPerRequest).toBe(15);
    });

    it("should have proper configuration for chat.postMessage", () => {
      const config = SLACK_RATE_LIMITS["chat.postMessage"];
      expect(config).toBeDefined();
      expect(config.requestsPerMinute).toBe(60);
      expect(config.specialRules?.perChannelLimit).toBe(true);
    });

    it("should have tier-based limits", () => {
      // Tier 1 (most restrictive)
      expect(SLACK_RATE_LIMITS["conversations.history"].requestsPerMinute).toBe(
        1
      );
      expect(SLACK_RATE_LIMITS["conversations.replies"].requestsPerMinute).toBe(
        1
      );

      // Tier 2
      expect(SLACK_RATE_LIMITS["conversations.list"].requestsPerMinute).toBe(
        20
      );
      expect(SLACK_RATE_LIMITS["users.list"].requestsPerMinute).toBe(20);

      // Tier 3
      expect(SLACK_RATE_LIMITS["conversations.info"].requestsPerMinute).toBe(
        50
      );
      expect(SLACK_RATE_LIMITS["users.info"].requestsPerMinute).toBe(50);
      expect(SLACK_RATE_LIMITS["auth.test"].requestsPerMinute).toBe(50);

      // Events API
      expect(SLACK_RATE_LIMITS["events"].requestsPerMinute).toBe(500);
    });
  });

  describe("SlackRateLimitStore", () => {
    it("should allow first request for any method", async () => {
      const result = await slackRateLimitStore.checkLimit(
        testTeamId,
        "conversations.info"
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(49); // 50 - 1
    });

    it("should track requests per team and method", async () => {
      const method = "conversations.info";

      // First request
      const result1 = await slackRateLimitStore.checkLimit(testTeamId, method);
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(49);

      // Second request
      const result2 = await slackRateLimitStore.checkLimit(testTeamId, method);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(48);
    });

    it("should enforce rate limits when exceeded", async () => {
      const method = "conversations.history"; // Only 1 request per minute

      // First request should be allowed
      const result1 = await slackRateLimitStore.checkLimit(testTeamId, method);
      expect(result1.allowed).toBe(true);

      // Second request should be blocked
      const result2 = await slackRateLimitStore.checkLimit(testTeamId, method);
      expect(result2.allowed).toBe(false);
      expect(result2.retryAfter).toBeGreaterThan(0);
      expect(result2.remaining).toBe(0);
    });

    it("should handle per-channel limits for chat.postMessage", async () => {
      const method = "chat.postMessage";

      // Should allow request to channel 1
      const result1 = await slackRateLimitStore.checkLimit(
        testTeamId,
        method,
        "C111"
      );
      expect(result1.allowed).toBe(true);

      // Should allow request to channel 2 (different channel)
      const result2 = await slackRateLimitStore.checkLimit(
        testTeamId,
        method,
        "C222"
      );
      expect(result2.allowed).toBe(true);

      // Rapid requests to same channel should be rate limited
      const result3 = await slackRateLimitStore.checkLimit(
        testTeamId,
        method,
        "C111"
      );
      expect(result3.allowed).toBe(false);
      expect(result3.retryAfter).toBe(1); // 1 second interval
    });

    it("should reset limits after window expires", async () => {
      const method = "conversations.history";

      // Use up the limit
      const result1 = await slackRateLimitStore.checkLimit(testTeamId, method);
      expect(result1.allowed).toBe(true);

      const result2 = await slackRateLimitStore.checkLimit(testTeamId, method);
      expect(result2.allowed).toBe(false);

      // Fast-forward time (simulate window expiry)
      vi.useFakeTimers();
      vi.advanceTimersByTime(61 * 1000); // 61 seconds

      const result3 = await slackRateLimitStore.checkLimit(testTeamId, method);
      expect(result3.allowed).toBe(true);

      vi.useRealTimers();
    });

    it("should allow unlimited requests for unconfigured methods", async () => {
      const result = await slackRateLimitStore.checkLimit(
        testTeamId,
        "unknown.method"
      );
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeUndefined();
    });
  });

  describe("RateLimitedSlackClient", () => {
    let client: RateLimitedSlackClient;

    beforeEach(() => {
      client = new RateLimitedSlackClient(testTeamId);

      // Mock fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: "mock response" }),
        headers: new Headers(),
      } as Response);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should check rate limits before making requests", async () => {
      const response = await client.makeRequest(
        "conversations.info",
        "https://slack.com/api/conversations.info",
        { method: "GET" },
        testChannelId
      );

      expect(global.fetch).toHaveBeenCalledWith(
        "https://slack.com/api/conversations.info",
        { method: "GET" }
      );
    });

    it("should throw error when rate limited", async () => {
      const method = "conversations.history";

      // Use up the rate limit
      await client.makeRequest(
        method,
        "https://slack.com/api/conversations.history",
        {}
      );

      // Second request should fail
      await expect(
        client.makeRequest(
          method,
          "https://slack.com/api/conversations.history",
          {}
        )
      ).rejects.toThrow(/Rate limit exceeded/);
    });

    it("should call Slack API methods with rate limiting", async () => {
      const mockToken = "xoxb-test-token";

      const response = await client.callMethod("auth.test", mockToken);

      expect(global.fetch).toHaveBeenCalledWith(
        "https://slack.com/api/auth.test",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockToken}`,
            "Content-Type": "application/x-www-form-urlencoded",
          }),
        })
      );
    });
  });
});
