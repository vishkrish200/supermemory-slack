import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import {
  slackTeam,
  slackToken,
  slackChannel,
  slackSyncLog,
  type SlackTeam,
  SlackToken,
  type SlackChannel,
} from "./schema";
import { encrypt, decrypt } from "../utils/cipher";

export interface SlackOAuthResponse {
  access_token: string;
  token_type: string;
  scope: string;
  bot_user_id: string;
  app_id: string;
  team: {
    id: string;
    name: string;
    domain?: string;
  };
  enterprise?: {
    id: string;
    name: string;
  };
  authed_user: {
    id: string;
    scope: string;
    access_token?: string;
    token_type?: string;
  };
}

export interface StoredSlackToken {
  id: string;
  teamId: string;
  userId: string | null;
  slackUserId: string;
  accessToken: string; // This will be decrypted
  tokenType: string;
  scope: string;
  botUserId: string | null;
  appId: string;
  isRevoked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Database operations for Slack teams and tokens
 */
export class SlackDatabase {
  private db: ReturnType<typeof drizzle>;
  private encryptionKey: string;

  constructor(database: D1Database, encryptionKey: string) {
    this.db = drizzle(database);
    this.encryptionKey = encryptionKey;
  }

  /**
   * Store OAuth response data securely
   */
  async storeOAuthData(
    oauthResponse: SlackOAuthResponse,
    userId?: string
  ): Promise<void> {
    const now = new Date();

    try {
      // First, store or update team information
      await this.db
        .insert(slackTeam)
        .values({
          id: oauthResponse.team.id,
          name: oauthResponse.team.name,
          domain: oauthResponse.team.domain,
          enterpriseId: oauthResponse.enterprise?.id,
          enterpriseName: oauthResponse.enterprise?.name,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: slackTeam.id,
          set: {
            name: oauthResponse.team.name,
            domain: oauthResponse.team.domain,
            enterpriseId: oauthResponse.enterprise?.id,
            enterpriseName: oauthResponse.enterprise?.name,
            isActive: true,
            updatedAt: now,
          },
        });

      // Encrypt the access token before storing
      const encryptedAccessToken = await encrypt(
        oauthResponse.access_token,
        this.encryptionKey
      );

      // Store the bot token
      await this.db.insert(slackToken).values({
        id: `${oauthResponse.team.id}_bot_${Date.now()}`,
        teamId: oauthResponse.team.id,
        userId: userId,
        slackUserId: oauthResponse.authed_user.id,
        accessToken: encryptedAccessToken,
        tokenType: oauthResponse.token_type,
        scope: oauthResponse.scope,
        botUserId: oauthResponse.bot_user_id,
        appId: oauthResponse.app_id,
        isRevoked: false,
        createdAt: now,
        updatedAt: now,
      });

      // If there's a user token, store it separately
      if (oauthResponse.authed_user.access_token) {
        const encryptedUserToken = await encrypt(
          oauthResponse.authed_user.access_token,
          this.encryptionKey
        );

        await this.db.insert(slackToken).values({
          id: `${oauthResponse.team.id}_user_${
            oauthResponse.authed_user.id
          }_${Date.now()}`,
          teamId: oauthResponse.team.id,
          userId: userId,
          slackUserId: oauthResponse.authed_user.id,
          accessToken: encryptedUserToken,
          tokenType: oauthResponse.authed_user.token_type || "bearer",
          scope: oauthResponse.authed_user.scope,
          botUserId: null,
          appId: oauthResponse.app_id,
          isRevoked: false,
          createdAt: now,
          updatedAt: now,
        });
      }
    } catch (error) {
      console.error("Error storing OAuth data:", error);
      throw new Error("Failed to store OAuth data");
    }
  }

  /**
   * Retrieve and decrypt team's bot token
   */
  async getTeamBotToken(teamId: string): Promise<StoredSlackToken | null> {
    try {
      const tokenRecord = await this.db
        .select()
        .from(slackToken)
        .where(
          and(eq(slackToken.teamId, teamId), eq(slackToken.isRevoked, false))
        )
        .orderBy(slackToken.createdAt)
        .limit(1);

      if (tokenRecord.length === 0) {
        return null;
      }

      const token = tokenRecord[0];

      // Decrypt the access token
      const decryptedToken = await decrypt(
        token.accessToken,
        this.encryptionKey
      );

      return {
        ...token,
        accessToken: decryptedToken,
        createdAt: new Date(token.createdAt),
        updatedAt: new Date(token.updatedAt),
      };
    } catch (error) {
      console.error("Error retrieving team token:", error);
      throw new Error("Failed to retrieve team token");
    }
  }

  /**
   * Retrieve and decrypt user token for a specific team and user
   */
  async getUserToken(
    teamId: string,
    slackUserId: string
  ): Promise<StoredSlackToken | null> {
    try {
      const tokenRecord = await this.db
        .select()
        .from(slackToken)
        .where(
          and(
            eq(slackToken.teamId, teamId),
            eq(slackToken.slackUserId, slackUserId),
            eq(slackToken.isRevoked, false)
          )
        )
        .orderBy(slackToken.createdAt)
        .limit(1);

      if (tokenRecord.length === 0) {
        return null;
      }

      const token = tokenRecord[0];

      // Decrypt the access token
      const decryptedToken = await decrypt(
        token.accessToken,
        this.encryptionKey
      );

      return {
        ...token,
        accessToken: decryptedToken,
        createdAt: new Date(token.createdAt),
        updatedAt: new Date(token.updatedAt),
      };
    } catch (error) {
      console.error("Error retrieving user token:", error);
      throw new Error("Failed to retrieve user token");
    }
  }

  /**
   * Revoke a token (mark as revoked, don't delete for audit)
   */
  async revokeToken(tokenId: string): Promise<void> {
    try {
      await this.db
        .update(slackToken)
        .set({
          isRevoked: true,
          updatedAt: new Date(),
        })
        .where(eq(slackToken.id, tokenId));
    } catch (error) {
      console.error("Error revoking token:", error);
      throw new Error("Failed to revoke token");
    }
  }

  /**
   * Revoke all tokens for a team
   */
  async revokeTeamTokens(teamId: string): Promise<void> {
    try {
      await this.db
        .update(slackToken)
        .set({
          isRevoked: true,
          updatedAt: new Date(),
        })
        .where(eq(slackToken.teamId, teamId));
    } catch (error) {
      console.error("Error revoking team tokens:", error);
      throw new Error("Failed to revoke team tokens");
    }
  }

  /**
   * Get team information
   */
  async getTeam(teamId: string): Promise<SlackTeam | null> {
    try {
      const teamRecord = await this.db
        .select()
        .from(slackTeam)
        .where(eq(slackTeam.id, teamId))
        .limit(1);

      return teamRecord.length > 0 ? teamRecord[0] : null;
    } catch (error) {
      console.error("Error retrieving team:", error);
      throw new Error("Failed to retrieve team");
    }
  }

  /**
   * Update team status
   */
  async updateTeamStatus(teamId: string, isActive: boolean): Promise<void> {
    try {
      await this.db
        .update(slackTeam)
        .set({
          isActive,
          updatedAt: new Date(),
        })
        .where(eq(slackTeam.id, teamId));
    } catch (error) {
      console.error("Error updating team status:", error);
      throw new Error("Failed to update team status");
    }
  }

  /**
   * Store channel information
   */
  async storeChannel(channelData: {
    id: string;
    teamId: string;
    name: string;
    isPrivate: boolean;
    isArchived?: boolean;
    isSyncEnabled?: boolean;
    documentLimit?: number;
  }): Promise<void> {
    const now = new Date();

    try {
      await this.db
        .insert(slackChannel)
        .values({
          id: channelData.id,
          teamId: channelData.teamId,
          name: channelData.name,
          isPrivate: channelData.isPrivate,
          isArchived: channelData.isArchived || false,
          isSyncEnabled: channelData.isSyncEnabled || false,
          documentLimit: channelData.documentLimit || 1000,
          lastSyncAt: null,
          lastMessageTs: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: slackChannel.id,
          set: {
            name: channelData.name,
            isPrivate: channelData.isPrivate,
            isArchived: channelData.isArchived || false,
            updatedAt: now,
          },
        });
    } catch (error) {
      console.error("Error storing channel:", error);
      throw new Error("Failed to store channel");
    }
  }

  /**
   * Get channels for a team
   */
  async getTeamChannels(teamId: string): Promise<SlackChannel[]> {
    try {
      const channels = await this.db
        .select()
        .from(slackChannel)
        .where(eq(slackChannel.teamId, teamId));

      return channels;
    } catch (error) {
      console.error("Error retrieving team channels:", error);
      throw new Error("Failed to retrieve team channels");
    }
  }

  /**
   * Update channel sync settings
   */
  async updateChannelSyncSettings(
    channelId: string,
    isSyncEnabled: boolean,
    documentLimit?: number
  ): Promise<void> {
    try {
      const updateData: any = {
        isSyncEnabled,
        updatedAt: new Date(),
      };

      if (documentLimit !== undefined) {
        updateData.documentLimit = documentLimit;
      }

      await this.db
        .update(slackChannel)
        .set(updateData)
        .where(eq(slackChannel.id, channelId));
    } catch (error) {
      console.error("Error updating channel sync settings:", error);
      throw new Error("Failed to update channel sync settings");
    }
  }

  /**
   * Log message sync status
   */
  async logMessageSync(
    teamId: string,
    channelId: string | null,
    messageTs: string,
    status: "pending" | "success" | "failed",
    supermemoryId?: string,
    errorMessage?: string
  ): Promise<void> {
    const now = new Date();

    try {
      await this.db.insert(slackSyncLog).values({
        id: `sync_${teamId}_${messageTs}_${Date.now()}`,
        teamId,
        channelId,
        messageTs,
        supermemoryId,
        status,
        errorMessage,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      console.error("Error logging message sync:", error);
      throw new Error("Failed to log message sync");
    }
  }
}
