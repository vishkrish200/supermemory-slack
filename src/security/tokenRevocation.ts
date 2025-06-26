/**
 * Token Revocation Service
 *
 * Provides comprehensive token revocation capabilities with immediate invalidation,
 * audit logging, and optional Slack notifications for security events
 */

import { eq, and } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { SecurityAuditLogger } from "./auditLogger";
import { SecureTokenStorage } from "./tokenStorage";
import { slackToken, type SlackToken } from "../db/schema";
import { SlackApiClient } from "../slack/services/client";

export interface RevocationRequest {
  teamId?: string;
  tokenId?: string;
  reason: string;
  requestedBy: string; // User ID or system identifier
  notifySlack?: boolean;
  slackChannelId?: string;
  immediate?: boolean; // Default: true
}

export interface RevocationResult {
  success: boolean;
  revocationId: string;
  revokedTokens: number;
  revokedTokenIds: string[];
  teamId?: string;
  notificationSent: boolean;
  auditLogId?: string;
  error?: string;
  revokedAt: Date;
}

export interface RevocationStatus {
  tokenId: string;
  isRevoked: boolean;
  revokedAt?: Date;
  revokedReason?: string;
  revokedBy?: string;
  canBeUsed: boolean;
  warningMessage?: string;
}

export class TokenRevocationService {
  private readonly db: DrizzleD1Database;
  private readonly auditLogger: SecurityAuditLogger;
  private readonly tokenStorage: SecureTokenStorage;

  constructor(
    db: DrizzleD1Database,
    auditLogger: SecurityAuditLogger,
    secret: string
  ) {
    this.db = db;
    this.auditLogger = auditLogger;
    this.tokenStorage = new SecureTokenStorage(db, secret);
  }

  /**
   * Revoke specific token by ID
   */
  async revokeToken(
    request: RevocationRequest & { tokenId: string }
  ): Promise<RevocationResult> {
    const revocationId = `rev_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 11)}`;

    try {
      // Get token details before revocation
      const tokenRecord = await this.db
        .select()
        .from(slackToken)
        .where(eq(slackToken.id, request.tokenId))
        .limit(1);

      if (tokenRecord.length === 0) {
        return {
          success: false,
          revocationId,
          revokedTokens: 0,
          revokedTokenIds: [],
          notificationSent: false,
          error: "Token not found",
          revokedAt: new Date(),
        };
      }

      const token = tokenRecord[0];

      // Check if already revoked
      if (token.isRevoked) {
        await this.auditLogger.logEvent({
          eventType: "token_revoked",
          teamId: token.teamId,
          metadata: {
            revocationId,
            tokenId: request.tokenId,
            reason: request.reason,
            alreadyRevoked: true,
          },
          details: `Attempted to revoke already revoked token ${request.tokenId}`,
        });

        return {
          success: true,
          revocationId,
          revokedTokens: 0,
          revokedTokenIds: [],
          teamId: token.teamId,
          notificationSent: false,
          error: "Token was already revoked",
          revokedAt: new Date(),
        };
      }

      // Perform revocation using SecureTokenStorage
      await this.tokenStorage.revokeToken(
        request.tokenId,
        request.reason,
        "system"
      );

      // Send Slack notification if requested
      let notificationSent = false;
      if (request.notifySlack && request.slackChannelId) {
        try {
          notificationSent = await this.sendSlackNotification(
            token.teamId,
            request.slackChannelId,
            request.reason,
            1
          );
        } catch (notificationError) {
          console.warn("Failed to send Slack notification:", notificationError);
        }
      }

      return {
        success: true,
        revocationId,
        revokedTokens: 1,
        revokedTokenIds: [request.tokenId],
        teamId: token.teamId,
        notificationSent,
        revokedAt: new Date(),
      };
    } catch (error) {
      await this.auditLogger.logEvent({
        eventType: "auth_failure",
        metadata: {
          operation: "token_revocation",
          revocationId,
          tokenId: request.tokenId,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        details: `Token revocation failed for token ${request.tokenId}`,
      });

      return {
        success: false,
        revocationId,
        revokedTokens: 0,
        revokedTokenIds: [],
        notificationSent: false,
        error: error instanceof Error ? error.message : "Unknown error",
        revokedAt: new Date(),
      };
    }
  }

  /**
   * Revoke all tokens for a specific team
   */
  async revokeTeamTokens(
    request: RevocationRequest & { teamId: string }
  ): Promise<RevocationResult> {
    const revocationId = `team_rev_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 11)}`;

    try {
      // Get all active tokens for the team
      const activeTokens = await this.db
        .select()
        .from(slackToken)
        .where(
          and(
            eq(slackToken.teamId, request.teamId),
            eq(slackToken.isRevoked, false)
          )
        );

      if (activeTokens.length === 0) {
        await this.auditLogger.logEvent({
          eventType: "token_revoked",
          teamId: request.teamId,
          metadata: {
            revocationId,
            reason: request.reason,
            noActiveTokens: true,
          },
          details: `No active tokens found for team ${request.teamId}`,
        });

        return {
          success: true,
          revocationId,
          revokedTokens: 0,
          revokedTokenIds: [],
          teamId: request.teamId,
          notificationSent: false,
          error: "No active tokens found",
          revokedAt: new Date(),
        };
      }

      const revokedTokenIds: string[] = [];
      let revocationErrors = 0;

      // Revoke each token individually for proper audit trails
      for (const token of activeTokens) {
        try {
          await this.tokenStorage.revokeToken(
            token.id,
            `Team revocation: ${request.reason}`,
            "system"
          );
          revokedTokenIds.push(token.id);
        } catch (tokenError) {
          revocationErrors++;
          console.warn(`Error revoking token ${token.id}:`, tokenError);
        }
      }

      // Log team-wide revocation
      await this.auditLogger.logEvent({
        eventType: "token_revoked",
        teamId: request.teamId,
        metadata: {
          revocationId,
          reason: request.reason,
          requestedBy: request.requestedBy,
          totalTokens: activeTokens.length,
          revokedTokens: revokedTokenIds.length,
          errors: revocationErrors,
        },
        details: `Team-wide token revocation for ${request.teamId}. Revoked ${revokedTokenIds.length}/${activeTokens.length} tokens`,
      });

      // Send Slack notification if requested
      let notificationSent = false;
      if (request.notifySlack && request.slackChannelId) {
        try {
          notificationSent = await this.sendSlackNotification(
            request.teamId,
            request.slackChannelId,
            request.reason,
            revokedTokenIds.length
          );
        } catch (notificationError) {
          console.warn("Failed to send Slack notification:", notificationError);
        }
      }

      return {
        success: revocationErrors === 0,
        revocationId,
        revokedTokens: revokedTokenIds.length,
        revokedTokenIds,
        teamId: request.teamId,
        notificationSent,
        error:
          revocationErrors > 0
            ? `${revocationErrors} tokens failed to revoke`
            : undefined,
        revokedAt: new Date(),
      };
    } catch (error) {
      await this.auditLogger.logEvent({
        eventType: "auth_failure",
        teamId: request.teamId,
        metadata: {
          operation: "team_token_revocation",
          revocationId,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        details: `Team token revocation failed for team ${request.teamId}`,
      });

      return {
        success: false,
        revocationId,
        revokedTokens: 0,
        revokedTokenIds: [],
        teamId: request.teamId,
        notificationSent: false,
        error: error instanceof Error ? error.message : "Unknown error",
        revokedAt: new Date(),
      };
    }
  }

  /**
   * Check if a token is revoked and can be used
   */
  async checkRevocationStatus(tokenId: string): Promise<RevocationStatus> {
    try {
      const tokenRecord = await this.db
        .select()
        .from(slackToken)
        .where(eq(slackToken.id, tokenId))
        .limit(1);

      if (tokenRecord.length === 0) {
        return {
          tokenId,
          isRevoked: true,
          canBeUsed: false,
          warningMessage: "Token not found in database",
        };
      }

      const token = tokenRecord[0];

      if (token.isRevoked) {
        return {
          tokenId,
          isRevoked: true,
          revokedAt: token.revokedAt || undefined,
          revokedReason: token.revokedReason || undefined,
          canBeUsed: false,
          warningMessage: "Token has been revoked and cannot be used",
        };
      }

      return {
        tokenId,
        isRevoked: false,
        canBeUsed: true,
      };
    } catch (error) {
      console.error("Error checking revocation status:", error);
      return {
        tokenId,
        isRevoked: true,
        canBeUsed: false,
        warningMessage:
          "Error checking token status - denying access for security",
      };
    }
  }

  /**
   * Validate token before use (comprehensive check)
   */
  async validateTokenForUse(
    tokenId: string,
    operation = "general"
  ): Promise<{
    isValid: boolean;
    canProceed: boolean;
    reason?: string;
    auditLogged: boolean;
  }> {
    try {
      const status = await this.checkRevocationStatus(tokenId);

      if (!status.canBeUsed) {
        // Log attempted use of revoked token
        const tokenRecord = await this.db
          .select()
          .from(slackToken)
          .where(eq(slackToken.id, tokenId))
          .limit(1);

        if (tokenRecord.length > 0) {
          await this.auditLogger.logTokenAccess(
            tokenRecord[0].teamId,
            tokenId,
            false
          );

          await this.auditLogger.logEvent({
            eventType: "suspicious_activity",
            teamId: tokenRecord[0].teamId,
            metadata: {
              operation,
              tokenId,
              revocationStatus: status.isRevoked,
              attemptedUse: true,
            },
            details: `Attempted use of revoked token ${tokenId} for operation: ${operation}`,
          });
        }

        return {
          isValid: false,
          canProceed: false,
          reason: status.warningMessage || "Token is revoked",
          auditLogged: true,
        };
      }

      // Log successful token validation
      const tokenRecord = await this.db
        .select()
        .from(slackToken)
        .where(eq(slackToken.id, tokenId))
        .limit(1);

      if (tokenRecord.length > 0) {
        await this.auditLogger.logTokenAccess(
          tokenRecord[0].teamId,
          tokenId,
          true
        );
      }

      return {
        isValid: true,
        canProceed: true,
        auditLogged: true,
      };
    } catch (error) {
      console.error("Error validating token for use:", error);
      return {
        isValid: false,
        canProceed: false,
        reason: "Token validation error - access denied for security",
        auditLogged: false,
      };
    }
  }

  /**
   * Send Slack notification about token revocation
   */
  private async sendSlackNotification(
    teamId: string,
    channelId: string,
    reason: string,
    tokenCount: number
  ): Promise<boolean> {
    try {
      // Get the team bot token to send the notification
      const tokenData = await this.tokenStorage.getTeamBotToken(teamId);

      if (!tokenData) {
        // No tokens available to send notification
        return false;
      }

      const slackClient = new SlackApiClient(tokenData.decryptedToken);

      const message =
        tokenCount === 1
          ? `🚨 Security Alert: A token has been revoked for your workspace.\n\nReason: ${reason}\n\nIf this was unexpected, please contact your administrator.`
          : `🚨 Security Alert: ${tokenCount} tokens have been revoked for your workspace.\n\nReason: ${reason}\n\nIf this was unexpected, please contact your administrator.`;

      await slackClient.postMessage(channelId, message);

      return true;
    } catch (error) {
      console.warn("Failed to send Slack notification:", error);
      return false;
    }
  }

  /**
   * Get revocation statistics for monitoring
   */
  async getRevocationStats(teamId?: string): Promise<{
    totalTokens: number;
    activeTokens: number;
    revokedTokens: number;
    revocationRate: number;
    recentRevocations: number; // Last 24 hours
  }> {
    try {
      const baseQuery = this.db.select().from(slackToken);
      const query = teamId
        ? baseQuery.where(eq(slackToken.teamId, teamId))
        : baseQuery;

      const allTokens = await query;
      const activeTokens = allTokens.filter((token) => !token.isRevoked);
      const revokedTokens = allTokens.filter((token) => token.isRevoked);

      // Recent revocations (last 24 hours)
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentRevocations = revokedTokens.filter(
        (token) => token.revokedAt && token.revokedAt > twentyFourHoursAgo
      ).length;

      const revocationRate =
        allTokens.length > 0
          ? (revokedTokens.length / allTokens.length) * 100
          : 0;

      return {
        totalTokens: allTokens.length,
        activeTokens: activeTokens.length,
        revokedTokens: revokedTokens.length,
        revocationRate: Math.round(revocationRate * 100) / 100,
        recentRevocations,
      };
    } catch (error) {
      console.error("Error getting revocation stats:", error);
      return {
        totalTokens: 0,
        activeTokens: 0,
        revokedTokens: 0,
        revocationRate: 0,
        recentRevocations: 0,
      };
    }
  }
}
