import { describe, it, expect, beforeEach, vi } from "vitest";
import { SlackDatabase, type SlackOAuthResponse } from "../src/db/slackOperations";

// Mock the database and encryption dependencies
const mockDatabase = {
  prepare: vi.fn(),
  exec: vi.fn(),
} as unknown as D1Database;

// Mock drizzle
vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  })),
}));

// Mock encryption utilities
vi.mock("../src/utils/cipher", () => ({
  encrypt: vi.fn().mockResolvedValue("encrypted_token"),
  decrypt: vi.fn().mockResolvedValue("decrypted_token"),
}));

describe("SlackDatabase", () => {
  let slackDb: SlackDatabase;
  const encryptionKey = "test-encryption-key";

  beforeEach(() => {
    slackDb = new SlackDatabase(mockDatabase, encryptionKey);
    vi.clearAllMocks();
  });

  describe("storeOAuthData", () => {
    it("should store OAuth response data successfully", async () => {
      const mockOAuthResponse: SlackOAuthResponse = {
        access_token: "xoxb-test-token",
        token_type: "bearer",
        scope: "channels:read,chat:write",
        bot_user_id: "B123456789",
        app_id: "A123456789",
        team: {
          id: "T123456789",
          name: "Test Team",
          domain: "test-team",
        },
        authed_user: {
          id: "U123456789",
          scope: "identify",
        },
      };

      await expect(
        slackDb.storeOAuthData(mockOAuthResponse)
      ).resolves.not.toThrow();
    });

    it("should handle OAuth response with user token", async () => {
      const mockOAuthResponse: SlackOAuthResponse = {
        access_token: "xoxb-test-token",
        token_type: "bearer",
        scope: "channels:read,chat:write",
        bot_user_id: "B123456789",
        app_id: "A123456789",
        team: {
          id: "T123456789",
          name: "Test Team",
          domain: "test-team",
        },
        authed_user: {
          id: "U123456789",
          scope: "identify",
          access_token: "xoxp-user-token",
          token_type: "bearer",
        },
      };

      await expect(
        slackDb.storeOAuthData(mockOAuthResponse, "user123")
      ).resolves.not.toThrow();
    });

    it("should handle enterprise team data", async () => {
      const mockOAuthResponse: SlackOAuthResponse = {
        access_token: "xoxb-test-token",
        token_type: "bearer",
        scope: "channels:read,chat:write",
        bot_user_id: "B123456789",
        app_id: "A123456789",
        team: {
          id: "T123456789",
          name: "Test Team",
          domain: "test-team",
        },
        enterprise: {
          id: "E123456789",
          name: "Test Enterprise",
        },
        authed_user: {
          id: "U123456789",
          scope: "identify",
        },
      };

      await expect(
        slackDb.storeOAuthData(mockOAuthResponse)
      ).resolves.not.toThrow();
    });
  });

  describe("getTeamBotToken", () => {
    it("should return null when no token found", async () => {
      const result = await slackDb.getTeamBotToken("T123456789");
      expect(result).toBeNull();
    });
  });

  describe("revokeToken", () => {
    it("should revoke a token successfully", async () => {
      await expect(slackDb.revokeToken("token123")).resolves.not.toThrow();
    });
  });

  describe("revokeTeamTokens", () => {
    it("should revoke all team tokens successfully", async () => {
      await expect(
        slackDb.revokeTeamTokens("T123456789")
      ).resolves.not.toThrow();
    });
  });

  describe("storeChannel", () => {
    it("should store channel data successfully", async () => {
      const channelData = {
        id: "C123456789",
        teamId: "T123456789",
        name: "general",
        isPrivate: false,
        isArchived: false,
        isSyncEnabled: true,
        documentLimit: 1000,
      };

      await expect(slackDb.storeChannel(channelData)).resolves.not.toThrow();
    });
  });

  describe("updateChannelSyncSettings", () => {
    it("should update channel sync settings successfully", async () => {
      await expect(
        slackDb.updateChannelSyncSettings("C123456789", true, 500)
      ).resolves.not.toThrow();
    });
  });

  describe("logMessageSync", () => {
    it("should log message sync successfully", async () => {
      await expect(
        slackDb.logMessageSync(
          "T123456789",
          "C123456789",
          "1234567890.123456",
          "success",
          "supermemory123"
        )
      ).resolves.not.toThrow();
    });

    it("should log failed message sync with error", async () => {
      await expect(
        slackDb.logMessageSync(
          "T123456789",
          "C123456789",
          "1234567890.123456",
          "failed",
          undefined,
          "API rate limit exceeded"
        )
      ).resolves.not.toThrow();
    });
  });
});
