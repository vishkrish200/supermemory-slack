import { describe, it, expect, beforeEach, vi, MockedFunction } from "vitest";
import {
  SupermemoryApiClient,
  createSupermemoryClient,
} from "../src/supermemory/services/client";
import { SupermemoryRateLimiter } from "../src/supermemory/services/rateLimiter";
import {
  createSupermemoryMetricsCollector,
  MetricsEventType,
} from "../src/supermemory/services/metrics";

// Mock fetch globally
const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe("Supermemory API Integration", () => {
  describe("SupermemoryApiClient", () => {
    let client: SupermemoryApiClient;
    const mockConfig = {
      baseUrl: "https://api.supermemory.ai",
      apiKey: "test-api-key",
      timeout: 30000,
    };

    beforeEach(() => {
      vi.clearAllMocks();
      client = new SupermemoryApiClient(mockConfig);
    });

    describe("constructor", () => {
      it("should create client with default config", () => {
        expect(client).toBeInstanceOf(SupermemoryApiClient);
        expect((client as any).config).toEqual(mockConfig);
      });

      it("should use default base URL when none provided", () => {
        const clientWithDefaults = new SupermemoryApiClient({
          apiKey: "test-key",
        });
        expect(clientWithDefaults).toBeInstanceOf(SupermemoryApiClient);
      });

      it("should throw error for invalid baseUrl", () => {
        expect(
          () =>
            new SupermemoryApiClient({ ...mockConfig, baseUrl: "invalid-url" })
        ).toThrow("Invalid base URL provided");
      });

      it("should throw error for missing API key", () => {
        expect(
          () => new SupermemoryApiClient({ ...mockConfig, apiKey: "" })
        ).toThrow("API key is required");
      });
    });

    describe("createMemory", () => {
      const mockPayload = {
        content: "Test message content",
        metadata: {
          provider: "slack-connector",
          author: "john.doe",
          timestamp: "2024-01-15T10:30:00Z",
          channel: "general",
          message_type: "message",
        },
        tags: ["slack", "general"],
      };

      it("should successfully create memory", async () => {
        const mockResponse = {
          id: "memory-123",
          status: "created",
          title: "Test memory",
          createdAt: "2024-01-15T10:30:00Z",
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockResponse,
          headers: new Headers(),
        } as Response);

        const result = await client.createMemory(mockPayload);

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.supermemory.ai/v3/memories",
          expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({
              Authorization: "Bearer test-api-key",
              "Content-Type": "application/json",
            }),
            body: JSON.stringify({
              content: mockPayload.content,
              metadata: mockPayload.metadata,
              containerTags: mockPayload.tags,
            }),
          })
        );

        expect(result).toEqual(mockResponse);
      });

      it("should handle API errors", async () => {
        const errorResponse = {
          error: "Invalid memory format",
          message: "Content is required",
          status: 400,
        };

        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: async () => JSON.stringify(errorResponse),
          headers: new Headers(),
        } as Response);

        await expect(client.createMemory(mockPayload)).rejects.toThrow(
          "Supermemory API error: Invalid memory format - Content is required"
        );
      });

      it("should handle timeout errors with retry", async () => {
        // Mock timeout (AbortError)
        const abortError = new Error("The operation was aborted");
        abortError.name = "AbortError";

        mockFetch
          .mockRejectedValueOnce(abortError)
          .mockRejectedValueOnce(abortError)
          .mockRejectedValueOnce(abortError)
          .mockRejectedValueOnce(abortError); // All retries fail

        await expect(client.createMemory(mockPayload)).rejects.toThrow(
          "Request timeout after 3 attempts"
        );

        expect(mockFetch).toHaveBeenCalledTimes(4); // Initial + 3 retries
      });

      it("should handle rate limiting with retry", async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: false,
            status: 429,
            headers: new Headers({ "Retry-After": "2" }),
            text: async () => JSON.stringify({ error: "Rate limited" }),
          } as Response)
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ id: "memory-123", status: "created" }),
            headers: new Headers(),
          } as Response);

        const result = await client.createMemory(mockPayload);
        expect(result.id).toBe("memory-123");
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });

    describe("createMemories", () => {
      const mockPayloads = [
        {
          content: "Message 1",
          metadata: {
            provider: "slack-connector",
            author: "user1",
            timestamp: "2024-01-15T10:30:00Z",
            channel: "general",
            message_type: "message",
          },
          tags: ["slack", "general"],
        },
        {
          content: "Message 2",
          metadata: {
            provider: "slack-connector",
            author: "user2",
            timestamp: "2024-01-15T10:31:00Z",
            channel: "general",
            message_type: "message",
          },
          tags: ["slack", "general"],
        },
      ];

      it("should successfully create multiple memories", async () => {
        const mockResponses = [
          { id: "memory-1", status: "created" },
          { id: "memory-2", status: "created" },
        ];

        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockResponses[0],
            headers: new Headers(),
          } as Response)
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => mockResponses[1],
            headers: new Headers(),
          } as Response);

        const results = await client.createMemories(mockPayloads);

        expect(results).toHaveLength(2);
        expect(results[0].id).toBe("memory-1");
        expect(results[1].id).toBe("memory-2");
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      it("should handle partial failures gracefully", async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ id: "memory-1", status: "created" }),
            headers: new Headers(),
          } as Response)
          .mockResolvedValueOnce({
            ok: false,
            status: 400,
            text: async () => JSON.stringify({ error: "Invalid format" }),
            headers: new Headers(),
          } as Response);

        const results = await client.createMemories(mockPayloads);

        expect(results).toHaveLength(1); // Only successful one
        expect(results[0].id).toBe("memory-1");
      });
    });

    describe("testConnection", () => {
      it("should return true for successful connection", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: "test-123", status: "created" }),
          headers: new Headers(),
        } as Response);

        const result = await client.testConnection();
        expect(result).toBe(true);
      });

      it("should return false for failed connection", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ error: "Unauthorized" }),
          headers: new Headers(),
        } as Response);

        const result = await client.testConnection();
        expect(result).toBe(false);
      });
    });

    describe("getHealth", () => {
      it("should return healthy status for successful connection", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: "test-123", status: "created" }),
          headers: new Headers(),
        } as Response);

        const result = await client.getHealth();
        expect(result.status).toBe("healthy");
        expect(result.timestamp).toBeDefined();
      });

      it("should return unhealthy status for failed connection", async () => {
        mockFetch.mockRejectedValueOnce(new Error("Network error"));

        const result = await client.getHealth();
        expect(result.status).toBe("unhealthy");
        expect(result.timestamp).toBeDefined();
      });
    });
  });

  describe("SupermemoryRateLimiter", () => {
    let rateLimiter: SupermemoryRateLimiter;

    beforeEach(() => {
      rateLimiter = new SupermemoryRateLimiter({
        requestsPerMinute: 60,
        burstCapacity: 100,
      });
    });

    it("should allow requests within limits", () => {
      const result = rateLimiter.tryConsume();
      expect(result).toBe(true);
    });

    it("should track token consumption", () => {
      rateLimiter.tryConsume();
      rateLimiter.tryConsume();

      const status = rateLimiter.getStatus();
      expect(status.availableTokens).toBe(98);
      expect(status.capacity).toBe(100);
    });

    it("should block requests when limit exceeded", () => {
      // Consume all tokens
      for (let i = 0; i < 100; i++) {
        rateLimiter.tryConsume();
      }

      const result = rateLimiter.tryConsume();
      expect(result).toBe(false);
    });

    it("should reset tokens after time window", async () => {
      vi.useFakeTimers();

      // Consume all tokens
      for (let i = 0; i < 100; i++) {
        rateLimiter.tryConsume();
      }

      // Advance time by 61 seconds to allow refill
      vi.advanceTimersByTime(61 * 1000);

      const result = rateLimiter.tryConsume();
      expect(result).toBe(true);

      vi.useRealTimers();
    });

    it("should handle waiting for tokens", async () => {
      vi.useFakeTimers();

      // Consume all tokens
      for (let i = 0; i < 100; i++) {
        rateLimiter.tryConsume();
      }

      // Start waiting for token (should resolve after time advances)
      const waitPromise = rateLimiter.waitForToken(5000);

      // Advance time to allow refill
      vi.advanceTimersByTime(61 * 1000);

      await expect(waitPromise).resolves.toBeUndefined();

      vi.useRealTimers();
    });
  });

  describe("Metrics Collector", () => {
    let metricsCollector: ReturnType<typeof createSupermemoryMetricsCollector>;

    beforeEach(() => {
      metricsCollector = createSupermemoryMetricsCollector();
    });

    it("should record events", () => {
      const event = {
        type: MetricsEventType.REQUEST_START,
        timestamp: Date.now(),
      };

      metricsCollector.recordEvent(event);

      const metrics = metricsCollector.getMetrics();
      expect(metrics.requests.total).toBe(1);
    });

    it("should track different event types", () => {
      metricsCollector.recordEvent({
        type: MetricsEventType.REQUEST_START,
        timestamp: Date.now(),
      });
      metricsCollector.recordEvent({
        type: MetricsEventType.REQUEST_SUCCESS,
        timestamp: Date.now(),
      });
      metricsCollector.recordEvent({
        type: MetricsEventType.REQUEST_FAILURE,
        timestamp: Date.now(),
      });

      const metrics = metricsCollector.getMetrics();
      expect(metrics.requests.total).toBe(1);
      expect(metrics.requests.successful).toBe(1);
      expect(metrics.requests.failed).toBe(1);
    });

    it("should reset metrics", () => {
      metricsCollector.recordEvent({
        type: MetricsEventType.REQUEST_START,
        timestamp: Date.now(),
      });

      metricsCollector.reset();

      const metrics = metricsCollector.getMetrics();
      expect(metrics.requests.total).toBe(0);
    });

    it("should export metrics in JSON format", () => {
      metricsCollector.recordEvent({
        type: MetricsEventType.REQUEST_START,
        timestamp: Date.now(),
      });

      const exported = metricsCollector.exportMetrics("json");
      expect(exported).toContain('"total":1');
    });
  });

  describe("createSupermemoryClient factory", () => {
    const mockEnv = {
      SUPERMEMORY_API_KEY: "test-key",
      SUPERMEMORY_API_URL: "https://api.supermemory.ai",
      SUPERMEMORY_RATE_LIMIT: "100",
    };

    it("should create client with environment config", () => {
      const client = createSupermemoryClient(mockEnv as any);
      expect(client).toBeInstanceOf(SupermemoryApiClient);
    });

    it("should use default values for missing env vars", () => {
      const client = createSupermemoryClient({
        SUPERMEMORY_API_KEY: "test-key",
      } as any);
      expect(client).toBeInstanceOf(SupermemoryApiClient);
    });

    it("should handle invalid timeout values", () => {
      const client = createSupermemoryClient({
        SUPERMEMORY_API_KEY: "test-key",
        SUPERMEMORY_INVALID_PROP: "invalid",
      } as any);
      expect(client).toBeInstanceOf(SupermemoryApiClient);
    });
  });

  describe("Integration Tests", () => {
    let client: SupermemoryApiClient;
    let rateLimiter: SupermemoryRateLimiter;
    let metrics: ReturnType<typeof createSupermemoryMetricsCollector>;

    beforeEach(() => {
      client = new SupermemoryApiClient({
        apiKey: "test-api-key",
        baseUrl: "https://api.supermemory.ai",
        timeout: 30000,
        enableMetrics: true,
        enableProactiveRateLimit: true,
        rateLimiter: {
          requestsPerMinute: 60,
          burstCapacity: 100,
        },
      });

      rateLimiter = new SupermemoryRateLimiter({
        requestsPerMinute: 60,
        burstCapacity: 100,
      });

      metrics = createSupermemoryMetricsCollector();
    });

    it("should handle complete workflow with rate limiting and metrics", async () => {
      // Mock successful API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "memory-123", status: "created" }),
        headers: new Headers(),
      } as Response);

      const payload = {
        content: "Test message",
        metadata: {
          provider: "slack-connector",
          author: "test-user",
          timestamp: "2024-01-15T10:30:00Z",
          channel: "general",
          message_type: "message",
        },
        tags: ["slack", "test"],
      };

      // Check rate limit
      const canProceed = rateLimiter.tryConsume();
      expect(canProceed).toBe(true);

      // Make API request
      const startTime = Date.now();
      const result = await client.createMemory(payload);
      const endTime = Date.now();

      // Record metrics
      metrics.recordEvent({
        type: MetricsEventType.REQUEST_SUCCESS,
        timestamp: endTime,
        data: { duration: endTime - startTime, statusCode: 200 },
      });

      // Verify results
      expect(result.id).toBe("memory-123");
      expect(result.status).toBe("created");

      const metricsData = metrics.getMetrics();
      expect(metricsData.requests.successful).toBe(1);
    });

    it("should handle API errors with proper metrics recording", async () => {
      // Mock API error response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: "Invalid format",
            message: "Content is required",
          }),
        headers: new Headers(),
      } as Response);

      const payload = {
        content: "",
        metadata: {
          provider: "slack-connector",
          author: "test-user",
          timestamp: "2024-01-15T10:30:00Z",
          channel: "general",
          message_type: "message",
        },
        tags: ["slack", "test"],
      };

      try {
        await client.createMemory(payload);
      } catch (error) {
        // Record error metrics
        metrics.recordEvent({
          type: MetricsEventType.REQUEST_FAILURE,
          timestamp: Date.now(),
          data: { statusCode: 400, errorType: "client" },
        });
      }

      const metricsData = metrics.getMetrics();
      expect(metricsData.requests.failed).toBe(1);
    });

    it("should handle rate limiting scenarios", async () => {
      // Simulate hitting rate limit
      for (let i = 0; i < 101; i++) {
        rateLimiter.tryConsume();
      }

      const canProceed = rateLimiter.tryConsume();
      expect(canProceed).toBe(false);

      // Record rate limit event
      metrics.recordEvent({
        type: MetricsEventType.RATE_LIMITED,
        timestamp: Date.now(),
        data: { waitTime: 1000 },
      });

      const status = rateLimiter.getStatus();
      expect(status.availableTokens).toBe(0);

      const metricsData = metrics.getMetrics();
      expect(metricsData.requests.rateLimited).toBe(1);
    });

    it("should test connection successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: "connection-test", status: "created" }),
        headers: new Headers(),
      } as Response);

      const isConnected = await client.testConnection();
      expect(isConnected).toBe(true);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.supermemory.ai/v3/memories",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("API connection test"),
        })
      );
    });

    it("should get client status and metrics", () => {
      // Test rate limiter status
      const rateLimiterStatus = client.getRateLimiterStatus();
      expect(rateLimiterStatus).toBeDefined();
      expect(rateLimiterStatus?.availableTokens).toBeDefined();

      // Test metrics
      const metricsCollector = client.getMetricsCollector();
      expect(metricsCollector).toBeDefined();

      const clientMetrics = client.getMetrics();
      expect(clientMetrics).toBeDefined();

      // Test metrics status
      expect(client.isMetricsEnabled()).toBe(true);
      expect(client.isRateLimitingEnabled()).toBe(true);
    });
  });
});
