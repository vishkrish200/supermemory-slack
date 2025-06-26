/**
 * Security Audit Logger
 *
 * Provides secure, GDPR-compliant audit logging for security events
 * Never logs PII, decrypted tokens, or sensitive data
 */

import { securityAuditLog, type SecurityAuditLog } from "../db/schema";
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

export type SecurityEventType =
  | "token_created"
  | "token_accessed"
  | "token_rotated"
  | "token_revoked"
  | "gdpr_delete_requested"
  | "gdpr_delete_completed"
  | "encryption_key_rotated"
  | "auth_failure"
  | "rate_limit_exceeded"
  | "suspicious_activity"
  | "data_retention_cleanup";

export type ActorType = "system" | "admin" | "user" | "slack_webhook";

export interface AuditEventOptions {
  eventType: SecurityEventType;
  teamId?: string;
  tokenId?: string;
  actorType: ActorType;
  actorId?: string;
  details?: Record<string, unknown>; // Non-sensitive details only
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
}

export class SecurityAuditLogger {
  constructor(private readonly db: DrizzleD1Database) {}

  /**
   * Log a security event with proper sanitization
   */
  async logEvent(options: AuditEventOptions): Promise<void> {
    try {
      // Sanitize details to ensure no sensitive data is included
      const sanitizedDetails = this.sanitizeDetails(options.details);

      // Generate unique ID for the audit log entry
      const id = crypto.randomUUID();

      await this.db.insert(securityAuditLog).values({
        id,
        eventType: options.eventType,
        teamId: options.teamId,
        tokenId: options.tokenId,
        actorType: options.actorType,
        actorId: options.actorId,
        details: sanitizedDetails ? JSON.stringify(sanitizedDetails) : null,
        ipAddress: this.sanitizeIpAddress(options.ipAddress),
        userAgent: this.sanitizeUserAgent(options.userAgent),
        success: options.success,
        errorMessage: this.sanitizeErrorMessage(options.errorMessage),
        createdAt: new Date(),
      });
    } catch (error) {
      // Log audit failures to console but don't throw to avoid disrupting main operations
      console.error("Failed to write audit log:", error);
    }
  }

  /**
   * Log token creation event
   */
  async logTokenCreation(
    teamId: string,
    tokenId: string,
    actorType = "system" as ActorType
  ): Promise<void> {
    await this.logEvent({
      eventType: "token_created",
      teamId,
      tokenId,
      actorType,
      success: true,
      details: {
        operation: "oauth_token_creation",
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Log token access event
   */
  async logTokenAccess(
    teamId: string,
    tokenId: string,
    success = true
  ): Promise<void> {
    await this.logEvent({
      eventType: "token_accessed",
      teamId,
      tokenId,
      actorType: "system",
      success,
      details: {
        operation: "token_decryption_for_api_call",
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Log token rotation event
   */
  async logTokenRotation(
    teamId: string,
    tokenId: string,
    success: boolean,
    reason?: string
  ): Promise<void> {
    await this.logEvent({
      eventType: "token_rotated",
      teamId,
      tokenId,
      actorType: "system",
      success,
      details: {
        operation: "token_rotation",
        reason: reason || "scheduled_rotation",
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Log token revocation event
   */
  async logTokenRevocation(
    teamId: string,
    tokenId: string,
    reason: string,
    actorType = "system" as ActorType
  ): Promise<void> {
    await this.logEvent({
      eventType: "token_revoked",
      teamId,
      tokenId,
      actorType,
      success: true,
      details: {
        operation: "token_revocation",
        reason,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Log GDPR deletion request
   */
  async logGdprDeletionRequest(
    teamId: string,
    actorType: ActorType = "user",
    ipAddress?: string
  ): Promise<void> {
    await this.logEvent({
      eventType: "gdpr_delete_requested",
      teamId,
      actorType,
      ipAddress,
      success: true,
      details: {
        operation: "gdpr_deletion_request",
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Log GDPR deletion completion
   */
  async logGdprDeletionCompletion(
    teamId: string,
    itemsDeleted: number
  ): Promise<void> {
    await this.logEvent({
      eventType: "gdpr_delete_completed",
      teamId,
      actorType: "system",
      success: true,
      details: {
        operation: "gdpr_deletion_completion",
        itemsDeleted,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Log authentication failures
   */
  async logAuthFailure(
    teamId?: string,
    reason: string = "unknown",
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.logEvent({
      eventType: "auth_failure",
      teamId,
      actorType: "user",
      ipAddress,
      userAgent,
      success: false,
      errorMessage: this.sanitizeErrorMessage(reason),
      details: {
        operation: "authentication_attempt",
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Get audit logs for a specific team (for compliance reporting)
   */
  async getTeamAuditLogs(
    teamId: string,
    limit: number = 100
  ): Promise<SecurityAuditLog[]> {
    return await this.db
      .select()
      .from(securityAuditLog)
      .where(eq(securityAuditLog.teamId, teamId))
      .orderBy(securityAuditLog.createdAt)
      .limit(limit);
  }

  /**
   * Clean up old audit logs based on retention policy
   */
  async cleanupOldLogs(retentionDays: number = 365): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await this.db
      .delete(securityAuditLog)
      .where(eq(securityAuditLog.createdAt, cutoffDate));

    // Log the cleanup operation
    await this.logEvent({
      eventType: "data_retention_cleanup",
      actorType: "system",
      success: true,
      details: {
        operation: "audit_log_cleanup",
        retentionDays,
        cutoffDate: cutoffDate.toISOString(),
        timestamp: new Date().toISOString(),
      },
    });

    return result.changes || 0;
  }

  /**
   * Sanitize details object to remove sensitive data
   */
  private sanitizeDetails(
    details?: Record<string, unknown>
  ): Record<string, unknown> | null {
    if (!details) return null;

    const sanitized: Record<string, unknown> = {};
    const forbiddenKeys = [
      "token",
      "secret",
      "password",
      "key",
      "credential",
      "authorization",
    ];

    for (const [key, value] of Object.entries(details)) {
      // Skip keys that might contain sensitive data
      if (
        forbiddenKeys.some((forbidden) => key.toLowerCase().includes(forbidden))
      ) {
        continue;
      }

      // Sanitize string values
      if (typeof value === "string") {
        // Remove potential tokens or secrets from strings
        if (value.length > 100 || /^[a-zA-Z0-9+/]+=*$/.test(value)) {
          sanitized[key] = "[REDACTED]";
        } else {
          sanitized[key] = value;
        }
      } else if (typeof value === "object" && value !== null) {
        // Recursively sanitize nested objects
        sanitized[key] = this.sanitizeDetails(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Sanitize IP address for logging (optional masking for privacy)
   */
  private sanitizeIpAddress(ipAddress?: string): string | null {
    if (!ipAddress) return null;

    // For GDPR compliance, you might want to mask the last octet of IPv4 addresses
    // Example: 192.168.1.100 -> 192.168.1.xxx
    if (ipAddress.includes(".")) {
      const parts = ipAddress.split(".");
      if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
      }
    }

    return ipAddress;
  }

  /**
   * Sanitize user agent string
   */
  private sanitizeUserAgent(userAgent?: string): string | null {
    if (!userAgent) return null;

    // Truncate extremely long user agent strings
    return userAgent.length > 500
      ? userAgent.substring(0, 500) + "..."
      : userAgent;
  }

  /**
   * Sanitize error messages to prevent sensitive data leakage
   */
  private sanitizeErrorMessage(errorMessage?: string): string | null {
    if (!errorMessage) return null;

    // Remove potential sensitive data patterns from error messages
    let sanitized = errorMessage
      .replace(/token[:\s]+[a-zA-Z0-9+/=]+/gi, "token: [REDACTED]")
      .replace(/key[:\s]+[a-zA-Z0-9+/=]+/gi, "key: [REDACTED]")
      .replace(/secret[:\s]+[a-zA-Z0-9+/=]+/gi, "secret: [REDACTED]")
      .replace(/password[:\s]+[a-zA-Z0-9+/=]+/gi, "password: [REDACTED]");

    // Truncate if too long
    return sanitized.length > 1000
      ? sanitized.substring(0, 1000) + "..."
      : sanitized;
  }
}
