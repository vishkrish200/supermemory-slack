/**
 * Secure Token Storage Service
 *
 * Integrates encryption, audit logging, and database operations
 * for secure Slack token management following 2024-2025 best practices
 */

import { eq, and } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  TokenManager,
  type TokenMetadata,
  type EncryptedToken,
} from "./encryption";
import { SecurityAuditLogger } from "./auditLogger";
import { slackTeam, slackToken, type SlackToken } from "../db/schema";

export interface SlackOAuthResponse {
  access_token: string;
  token_type: string;
  scope: string;
  bot_user_id?: string;
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

export interface SecureTokenData {
  id: string;
  teamId: string;
  slackUserId: string;
  decryptedToken: string;
  tokenType: string;
  scope: string;
  botUserId?: string;
  appId: string;
  isRevoked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class SecureTokenStorage {
  private tokenManager: TokenManager;
  private auditLogger: SecurityAuditLogger;

  constructor(
    private readonly db: DrizzleD1Database,
    encryptionSecret: string
  ) {
    this.tokenManager = new TokenManager(encryptionSecret);
    this.auditLogger = new SecurityAuditLogger(db);
  }

  /**
   * Store OAuth response data with encryption and audit logging
   */
  async storeOAuthData(
    oauthResponse: SlackOAuthResponse,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    const now = new Date();

    try {
      // First, store or update team information
      await this.db
        .insert(slackTeam)
        .values({
          id: oauthResponse.team.id,
          name: oauthResponse.team.name,
          domain: oauthResponse.team.domain || null,
          enterpriseId: oauthResponse.enterprise?.id || null,
          enterpriseName: oauthResponse.enterprise?.name || null,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: slackTeam.id,
          set: {
            name: oauthResponse.team.name,
            domain: oauthResponse.team.domain || null,
            enterpriseId: oauthResponse.enterprise?.id || null,
            enterpriseName: oauthResponse.enterprise?.name || null,
            isActive: true,
            updatedAt: now,
          },
        });

      // Store the bot token with encryption
      const botTokenId = crypto.randomUUID();
      const botTokenMetadata: TokenMetadata = {
        teamId: oauthResponse.team.id,
        slackUserId: oauthResponse.authed_user.id,
        tokenType: "bot",
        scope: oauthResponse.scope,
        botUserId: oauthResponse.bot_user_id,
        appId: oauthResponse.app_id,
      };

      const { encryptedToken } = await this.tokenManager.prepareTokenForStorage(
        oauthResponse.access_token,
        botTokenMetadata
      );

      await this.db.insert(slackToken).values({
        id: botTokenId,
        teamId: oauthResponse.team.id,
        userId: null, // Optional: link to our user system
        slackUserId: oauthResponse.authed_user.id,
        encryptedToken: encryptedToken.encryptedData,
        encryptionAlgorithm: encryptedToken.algorithm,
        keyId: encryptedToken.keyId || "default",
        tokenType: oauthResponse.token_type,
        scope: oauthResponse.scope,
        botUserId: oauthResponse.bot_user_id || null,
        appId: oauthResponse.app_id,
        isRevoked: false,
        revokedAt: null,
        revokedReason: null,
        createdAt: now,
        updatedAt: now,
      });

      // Log the token creation
      await this.auditLogger.logTokenCreation(
        oauthResponse.team.id,
        botTokenId,
        "system"
      );

      // If there's a user token, store it separately
      if (oauthResponse.authed_user.access_token) {
        const userTokenId = crypto.randomUUID();
        const userTokenMetadata: TokenMetadata = {
          teamId: oauthResponse.team.id,
          slackUserId: oauthResponse.authed_user.id,
          tokenType: "user",
          scope: oauthResponse.authed_user.scope,
          appId: oauthResponse.app_id,
        };

        const { encryptedToken: encryptedUserToken } =
          await this.tokenManager.prepareTokenForStorage(
            oauthResponse.authed_user.access_token,
            userTokenMetadata
          );

        await this.db.insert(slackToken).values({
          id: userTokenId,
          teamId: oauthResponse.team.id,
          userId: null,
          slackUserId: oauthResponse.authed_user.id,
          encryptedToken: encryptedUserToken.encryptedData,
          encryptionAlgorithm: encryptedUserToken.algorithm,
          keyId: encryptedUserToken.keyId || "default",
          tokenType: oauthResponse.authed_user.token_type || "bearer",
          scope: oauthResponse.authed_user.scope,
          botUserId: null,
          appId: oauthResponse.app_id,
          isRevoked: false,
          revokedAt: null,
          revokedReason: null,
          createdAt: now,
          updatedAt: now,
        });

        await this.auditLogger.logTokenCreation(
          oauthResponse.team.id,
          userTokenId,
          "system"
        );
      }

      console.log(
        `✅ Stored encrypted credentials for team: ${oauthResponse.team.name}`
      );
    } catch (error) {
      console.error("❌ Error storing OAuth data:", error);
      await this.auditLogger.logAuthFailure(
        oauthResponse.team.id,
        `OAuth storage failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        ipAddress,
        userAgent
      );
      throw new Error("Failed to store OAuth data securely");
    }
  }

  /**
   * Get team's bot token (decrypted for use)
   */
  async getTeamBotToken(teamId: string): Promise<SecureTokenData | null> {
    try {
      const tokenRecords = await this.db
        .select()
        .from(slackToken)
        .where(
          and(eq(slackToken.teamId, teamId), eq(slackToken.isRevoked, false))
        )
        .orderBy(slackToken.createdAt)
        .limit(1);

      if (tokenRecords.length === 0) {
        return null;
      }

      const tokenRecord = tokenRecords[0];

      // Reconstruct the encrypted token object
      const encryptedToken: EncryptedToken = {
        encryptedData: tokenRecord.encryptedToken,
        algorithm: tokenRecord.encryptionAlgorithm as "AES-GCM-256",
        keyId: tokenRecord.keyId,
      };

      // Decrypt the token
      const decryptedToken = await this.tokenManager.retrieveToken(
        encryptedToken
      );

      // Log the token access
      await this.auditLogger.logTokenAccess(teamId, tokenRecord.id, true);

      return {
        id: tokenRecord.id,
        teamId: tokenRecord.teamId,
        slackUserId: tokenRecord.slackUserId,
        decryptedToken,
        tokenType: tokenRecord.tokenType,
        scope: tokenRecord.scope,
        botUserId: tokenRecord.botUserId || undefined,
        appId: tokenRecord.appId,
        isRevoked: tokenRecord.isRevoked,
        createdAt: tokenRecord.createdAt,
        updatedAt: tokenRecord.updatedAt,
      };
    } catch (error) {
      console.error("❌ Error retrieving team token:", error);
      await this.auditLogger.logTokenAccess(teamId, "unknown", false);
      throw new Error("Failed to retrieve team token securely");
    }
  }

  /**
   * Get user token for a specific team and user
   */
  async getUserToken(
    teamId: string,
    slackUserId: string
  ): Promise<SecureTokenData | null> {
    try {
      const tokenRecords = await this.db
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

      if (tokenRecords.length === 0) {
        return null;
      }

      const tokenRecord = tokenRecords[0];

      // Reconstruct the encrypted token object
      const encryptedToken: EncryptedToken = {
        encryptedData: tokenRecord.encryptedToken,
        algorithm: tokenRecord.encryptionAlgorithm as "AES-GCM-256",
        keyId: tokenRecord.keyId,
      };

      // Decrypt the token
      const decryptedToken = await this.tokenManager.retrieveToken(
        encryptedToken
      );

      // Log the token access
      await this.auditLogger.logTokenAccess(teamId, tokenRecord.id, true);

      return {
        id: tokenRecord.id,
        teamId: tokenRecord.teamId,
        slackUserId: tokenRecord.slackUserId,
        decryptedToken,
        tokenType: tokenRecord.tokenType,
        scope: tokenRecord.scope,
        botUserId: tokenRecord.botUserId || undefined,
        appId: tokenRecord.appId,
        isRevoked: tokenRecord.isRevoked,
        createdAt: tokenRecord.createdAt,
        updatedAt: tokenRecord.updatedAt,
      };
    } catch (error) {
      console.error("❌ Error retrieving user token:", error);
      await this.auditLogger.logTokenAccess(teamId, "unknown", false);
      throw new Error("Failed to retrieve user token securely");
    }
  }

  /**
   * Revoke a specific token
   */
  async revokeToken(
    tokenId: string,
    reason: string,
    actorType: "system" | "admin" | "user" = "system"
  ): Promise<void> {
    try {
      const now = new Date();

      // Get token info before revoking for audit
      const tokenRecord = await this.db
        .select()
        .from(slackToken)
        .where(eq(slackToken.id, tokenId))
        .limit(1);

      if (tokenRecord.length === 0) {
        throw new Error("Token not found");
      }

      const token = tokenRecord[0];

      // Mark token as revoked
      await this.db
        .update(slackToken)
        .set({
          isRevoked: true,
          revokedAt: now,
          revokedReason: reason,
          updatedAt: now,
        })
        .where(eq(slackToken.id, tokenId));

      // Log the revocation
      await this.auditLogger.logTokenRevocation(
        token.teamId,
        tokenId,
        reason,
        actorType
      );

      console.log(`✅ Token ${tokenId} revoked: ${reason}`);
    } catch (error) {
      console.error("❌ Error revoking token:", error);
      throw new Error("Failed to revoke token securely");
    }
  }

  /**
   * Revoke all tokens for a team (GDPR compliance)
   */
  async revokeTeamTokens(
    teamId: string,
    reason: string = "team_deletion"
  ): Promise<number> {
    try {
      const now = new Date();

      // Get all active tokens for the team
      const activeTokens = await this.db
        .select()
        .from(slackToken)
        .where(
          and(eq(slackToken.teamId, teamId), eq(slackToken.isRevoked, false))
        );

      // Revoke all tokens
      const result = await this.db
        .update(slackToken)
        .set({
          isRevoked: true,
          revokedAt: now,
          revokedReason: reason,
          updatedAt: now,
        })
        .where(
          and(eq(slackToken.teamId, teamId), eq(slackToken.isRevoked, false))
        );

      // Log each revocation
      for (const token of activeTokens) {
        await this.auditLogger.logTokenRevocation(
          teamId,
          token.id,
          reason,
          "system"
        );
      }

      console.log(
        `✅ Revoked ${activeTokens.length} tokens for team ${teamId}: ${reason}`
      );
      return activeTokens.length;
    } catch (error) {
      console.error("❌ Error revoking team tokens:", error);
      throw new Error("Failed to revoke team tokens securely");
    }
  }

  /**
   * Delete all team data for GDPR compliance
   */
  async deleteTeamData(teamId: string, ipAddress?: string): Promise<void> {
    try {
      // Log GDPR deletion request
      await this.auditLogger.logGdprDeletionRequest(teamId, "user", ipAddress);

      // Count items to be deleted for audit
      const tokenCount = await this.db
        .select()
        .from(slackToken)
        .where(eq(slackToken.teamId, teamId));

      // First revoke all tokens
      await this.revokeTeamTokens(teamId, "gdpr_deletion");

      // Delete all token records (permanent deletion for GDPR)
      await this.db.delete(slackToken).where(eq(slackToken.teamId, teamId));

      // Delete team record
      await this.db.delete(slackTeam).where(eq(slackTeam.id, teamId));

      // Log completion
      await this.auditLogger.logGdprDeletionCompletion(
        teamId,
        tokenCount.length + 1 // tokens + team record
      );

      console.log(`✅ Completed GDPR deletion for team ${teamId}`);
    } catch (error) {
      console.error("❌ Error deleting team data:", error);
      throw new Error("Failed to complete GDPR deletion");
    }
  }

  /**
   * Validate that a token is not revoked and can be used
   */
  async validateToken(tokenId: string): Promise<boolean> {
    try {
      const tokenRecord = await this.db
        .select()
        .from(slackToken)
        .where(and(eq(slackToken.id, tokenId), eq(slackToken.isRevoked, false)))
        .limit(1);

      return tokenRecord.length > 0;
    } catch (error) {
      console.error("❌ Error validating token:", error);
      return false;
    }
  }

  /**
   * Get audit logs for a team (compliance reporting)
   */
  async getTeamAuditLogs(teamId: string, limit = 100) {
    return await this.auditLogger.getTeamAuditLogs(teamId, limit);
  }

  /**
   * Clean up old audit logs (data retention)
   */
  async cleanupAuditLogs(retentionDays = 365) {
    return await this.auditLogger.cleanupOldLogs(retentionDays);
  }
}
