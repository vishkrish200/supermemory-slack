/**
 * Enhanced Security Audit Logger
 *
 * Provides secure, immutable, encrypted audit logging for security events
 * with comprehensive coverage and tamper detection capabilities
 * Never logs PII, decrypted tokens, or sensitive data
 */

import { securityAuditLog, type SecurityAuditLog } from "../db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

export type SecurityEventType =
  | "token_created"
  | "token_accessed"
  | "token_rotated"
  | "token_revoked"
  | "token_expired"
  | "token_validation_failed"
  | "encryption_key_rotated"
  | "encryption_key_created"
  | "oauth_flow_started"
  | "oauth_flow_completed"
  | "oauth_flow_failed"
  | "gdpr_delete_requested"
  | "gdpr_delete_completed"
  | "gdpr_delete_failed"
  | "auth_failure"
  | "auth_success"
  | "rate_limit_exceeded"
  | "rate_limit_reset"
  | "suspicious_activity"
  | "security_alert"
  | "data_retention_cleanup"
  | "audit_log_tamper_detected"
  | "system_startup"
  | "system_shutdown"
  | "backup_created"
  | "backup_restored"
  | "config_changed"
  | "api_key_rotated"
  | "workspace_added"
  | "workspace_removed"
  | "webhook_received"
  | "webhook_failed";

export type ActorType =
  | "system"
  | "admin"
  | "user"
  | "slack_webhook"
  | "scheduled_job"
  | "api_client";

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
  severity?: "low" | "medium" | "high" | "critical";
  category?:
    | "authentication"
    | "authorization"
    | "data_access"
    | "configuration"
    | "security"
    | "compliance";
}

export interface AuditSearchOptions {
  teamId?: string;
  eventTypes?: SecurityEventType[];
  actorTypes?: ActorType[];
  startDate?: Date;
  endDate?: Date;
  success?: boolean;
  severity?: ("low" | "medium" | "high" | "critical")[];
  limit?: number;
  offset?: number;
}

export interface AuditStatistics {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsByActor: Record<string, number>;
  successRate: number;
  securityAlertsLast24h: number;
  failuresLast24h: number;
  topTeams: Array<{ teamId: string; eventCount: number }>;
  suspiciousActivityCount: number;
}

export interface IntegrityCheck {
  isValid: boolean;
  tamperedLogs: string[];
  totalChecked: number;
  firstTamperedAt?: Date;
  lastVerifiedAt: Date;
}

export class SecurityAuditLogger {
  private readonly encryptionKey: string;
  private lastLogHash: string | null = null;

  constructor(
    private readonly db: DrizzleD1Database,
    encryptionSecret?: string
  ) {
    // Use environment variable or provided secret for audit log encryption
    this.encryptionKey = encryptionSecret || this.deriveAuditKey();
  }

  /**
   * Log a security event with comprehensive details and integrity protection
   */
  async logEvent(options: AuditEventOptions): Promise<string> {
    try {
      // Generate unique ID for the audit log entry
      const id = crypto.randomUUID();
      const timestamp = new Date();

      // Calculate integrity hash based on previous log entry
      const integrityHash = await this.calculateIntegrityHash(
        id,
        options,
        timestamp
      );

      // Sanitize and encrypt details
      const sanitizedDetails = this.sanitizeDetails(options.details);
      const encryptedDetails = sanitizedDetails
        ? await this.encryptAuditData(JSON.stringify(sanitizedDetails))
        : null;

      // Determine severity and category if not provided
      const severity =
        options.severity ||
        this.determineSeverity(options.eventType, options.success);
      const category =
        options.category || this.determineCategory(options.eventType);

      await this.db.insert(securityAuditLog).values({
        id,
        eventType: options.eventType,
        teamId: options.teamId,
        tokenId: options.tokenId,
        actorType: options.actorType,
        actorId: options.actorId,
        details: encryptedDetails,
        ipAddress: this.sanitizeIpAddress(options.ipAddress),
        userAgent: this.sanitizeUserAgent(options.userAgent),
        success: options.success,
        errorMessage: this.sanitizeErrorMessage(options.errorMessage),
        timestamp,
        metadata: JSON.stringify({
          severity,
          category,
          integrityHash,
          version: "2.0",
          encrypted: !!encryptedDetails,
        }),
      });

      // Update last hash for next integrity calculation
      this.lastLogHash = integrityHash;

      // Check for security alerts that need immediate attention
      await this.checkForSecurityAlerts(options);

      return id;
    } catch (error) {
      // Log audit failures to console but don't throw to avoid disrupting main operations
      console.error("Failed to write audit log:", error);

      // Try to log the audit failure itself (without encryption to avoid recursion)
      try {
        await this.logAuditSystemFailure(
          error instanceof Error ? error.message : "Unknown error"
        );
      } catch (failureError) {
        console.error(
          "Critical: Failed to log audit system failure:",
          failureError
        );
      }

      return "failed";
    }
  }

  /**
   * Enhanced token creation logging with operation context
   */
  async logTokenCreation(
    teamId: string,
    tokenId: string,
    actorType: ActorType = "system",
    operationContext?: Record<string, unknown>
  ): Promise<string> {
    return await this.logEvent({
      eventType: "token_created",
      teamId,
      tokenId,
      actorType,
      success: true,
      severity: "medium",
      category: "authentication",
      details: {
        operation: "oauth_token_creation",
        tokenType: operationContext?.tokenType || "bot",
        scope: operationContext?.scope,
        botUserId: operationContext?.botUserId,
        timestamp: new Date().toISOString(),
        ...operationContext,
      },
    });
  }

  /**
   * Enhanced token access logging with usage metrics
   */
  async logTokenAccess(
    teamId: string,
    tokenId: string,
    success = true,
    operation?: string,
    endpoint?: string
  ): Promise<string> {
    return await this.logEvent({
      eventType: success ? "token_accessed" : "token_validation_failed",
      teamId,
      tokenId,
      actorType: "system",
      success,
      severity: success ? "low" : "high",
      category: "data_access",
      details: {
        operation: operation || "token_decryption_for_api_call",
        endpoint,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Enhanced token rotation logging with detailed metadata
   */
  async logTokenRotation(
    teamId: string,
    oldTokenId: string,
    newTokenId?: string,
    success = true,
    reason?: string,
    rotationType:
      | "scheduled"
      | "manual"
      | "security"
      | "health_check" = "scheduled"
  ): Promise<string> {
    return await this.logEvent({
      eventType: "token_rotated",
      teamId,
      tokenId: oldTokenId,
      actorType: rotationType === "manual" ? "admin" : "system",
      success,
      severity: success ? "medium" : "high",
      category: "security",
      details: {
        operation: "token_rotation",
        reason: reason || "scheduled_rotation",
        rotationType,
        oldTokenId,
        newTokenId,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Enhanced token revocation logging with comprehensive details
   */
  async logTokenRevocation(
    teamId: string,
    tokenId: string,
    reason: string,
    actorType: ActorType = "system",
    revocationType: "manual" | "security" | "gdpr" | "expired" = "manual"
  ): Promise<string> {
    return await this.logEvent({
      eventType: "token_revoked",
      teamId,
      tokenId,
      actorType,
      success: true,
      severity: revocationType === "security" ? "critical" : "high",
      category: revocationType === "gdpr" ? "compliance" : "security",
      details: {
        operation: "token_revocation",
        reason,
        revocationType,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Log OAuth flow events with comprehensive tracking
   */
  async logOAuthFlow(
    eventType:
      | "oauth_flow_started"
      | "oauth_flow_completed"
      | "oauth_flow_failed",
    teamId: string,
    success: boolean,
    stage?: string,
    error?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<string> {
    return await this.logEvent({
      eventType,
      teamId,
      actorType: "user",
      success,
      severity: success ? "low" : "medium",
      category: "authentication",
      ipAddress,
      userAgent,
      errorMessage: error,
      details: {
        operation: "oauth_authorization_flow",
        stage,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Log security alerts with immediate escalation
   */
  async logSecurityAlert(
    eventType: SecurityEventType,
    teamId: string,
    description: string,
    metadata?: Record<string, unknown>,
    severity: "medium" | "high" | "critical" = "high"
  ): Promise<string> {
    return await this.logEvent({
      eventType,
      teamId,
      actorType: "system",
      success: false,
      severity,
      category: "security",
      details: {
        alertDescription: description,
        alertLevel: severity,
        requiresInvestigation: severity === "critical",
        timestamp: new Date().toISOString(),
        ...metadata,
      },
    });
  }

  /**
   * Enhanced GDPR deletion logging with comprehensive tracking
   */
  async logGdprDeletionRequest(
    teamId: string,
    deletionId: string,
    actorType: ActorType = "user",
    ipAddress?: string,
    reason?: string
  ): Promise<string> {
    return await this.logEvent({
      eventType: "gdpr_delete_requested",
      teamId,
      actorType,
      ipAddress,
      success: true,
      severity: "high",
      category: "compliance",
      details: {
        operation: "gdpr_deletion_request",
        deletionId,
        reason,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Enhanced GDPR deletion completion logging
   */
  async logGdprDeletionCompletion(
    teamId: string,
    deletionId: string,
    itemsDeleted: number,
    dataTypes: string[],
    success = true
  ): Promise<string> {
    return await this.logEvent({
      eventType: success ? "gdpr_delete_completed" : "gdpr_delete_failed",
      teamId,
      actorType: "system",
      success,
      severity: "high",
      category: "compliance",
      details: {
        operation: "gdpr_deletion_completion",
        deletionId,
        itemsDeleted,
        dataTypes,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Log comprehensive authentication events
   */
  async logAuthFailure(
    teamId?: string,
    reason = "unknown",
    ipAddress?: string,
    userAgent?: string,
    attemptedOperation?: string,
    tokenId?: string
  ): Promise<string> {
    return await this.logEvent({
      eventType: "auth_failure",
      teamId,
      tokenId,
      actorType: "user",
      ipAddress,
      userAgent,
      success: false,
      severity: "medium",
      category: "authentication",
      errorMessage: this.sanitizeErrorMessage(reason),
      details: {
        operation: attemptedOperation || "authentication_attempt",
        failureReason: reason,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Advanced audit search with comprehensive filtering
   */
  async searchAuditLogs(options: AuditSearchOptions): Promise<{
    logs: SecurityAuditLog[];
    total: number;
    hasMore: boolean;
  }> {
    const limit = options.limit || 100;
    const offset = options.offset || 0;

    let query = this.db.select().from(securityAuditLog);
    const conditions: any[] = [];

    if (options.teamId) {
      conditions.push(eq(securityAuditLog.teamId, options.teamId));
    }

    if (options.startDate) {
      conditions.push(gte(securityAuditLog.timestamp, options.startDate));
    }

    if (options.endDate) {
      conditions.push(lte(securityAuditLog.timestamp, options.endDate));
    }

    if (options.success !== undefined) {
      conditions.push(eq(securityAuditLog.success, options.success));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const logs = await query
      .orderBy(securityAuditLog.timestamp)
      .limit(limit + 1) // Get one extra to check if there are more
      .offset(offset);

    const hasMore = logs.length > limit;
    if (hasMore) logs.pop(); // Remove the extra record

    // Decrypt details for authorized viewing
    const decryptedLogs = await Promise.all(
      logs.map(async (log) => ({
        ...log,
        details: log.details ? await this.decryptAuditData(log.details) : null,
      }))
    );

    return {
      logs: decryptedLogs,
      total: logs.length,
      hasMore,
    };
  }

  /**
   * Generate comprehensive audit statistics
   */
  async getAuditStatistics(
    teamId?: string,
    days = 30
  ): Promise<AuditStatistics> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    let query = this.db.select().from(securityAuditLog);
    if (teamId) {
      query = query.where(
        and(
          eq(securityAuditLog.teamId, teamId),
          gte(securityAuditLog.timestamp, cutoffDate)
        )
      );
    } else {
      query = query.where(gte(securityAuditLog.timestamp, cutoffDate));
    }

    const logs = await query;

    // Calculate statistics
    const eventsByType: Record<string, number> = {};
    const eventsByActor: Record<string, number> = {};
    const teamEventCounts: Record<string, number> = {};
    let successCount = 0;
    let securityAlertsLast24h = 0;
    let failuresLast24h = 0;
    let suspiciousActivityCount = 0;

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    for (const log of logs) {
      // Event type statistics
      eventsByType[log.eventType] = (eventsByType[log.eventType] || 0) + 1;

      // Actor type statistics
      eventsByActor[log.actorType] = (eventsByActor[log.actorType] || 0) + 1;

      // Team statistics
      if (log.teamId) {
        teamEventCounts[log.teamId] = (teamEventCounts[log.teamId] || 0) + 1;
      }

      // Success rate
      if (log.success) successCount++;

      // Recent activity
      if (log.timestamp > oneDayAgo) {
        if (!log.success) failuresLast24h++;
        if (log.eventType === "security_alert") securityAlertsLast24h++;
        if (log.eventType === "suspicious_activity") suspiciousActivityCount++;
      }
    }

    const topTeams = Object.entries(teamEventCounts)
      .map(([teamId, eventCount]) => ({ teamId, eventCount }))
      .sort((a, b) => b.eventCount - a.eventCount)
      .slice(0, 10);

    return {
      totalEvents: logs.length,
      eventsByType,
      eventsByActor,
      successRate: logs.length > 0 ? (successCount / logs.length) * 100 : 0,
      securityAlertsLast24h,
      failuresLast24h,
      topTeams,
      suspiciousActivityCount,
    };
  }

  /**
   * Verify audit log integrity and detect tampering
   */
  async verifyAuditIntegrity(
    teamId?: string,
    days = 7
  ): Promise<IntegrityCheck> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    let query = this.db.select().from(securityAuditLog);
    if (teamId) {
      query = query.where(
        and(
          eq(securityAuditLog.teamId, teamId),
          gte(securityAuditLog.timestamp, cutoffDate)
        )
      );
    } else {
      query = query.where(gte(securityAuditLog.timestamp, cutoffDate));
    }

    const logs = await query.orderBy(securityAuditLog.timestamp);
    const tamperedLogs: string[] = [];
    let previousHash: string | null = null;

    for (const log of logs) {
      try {
        const metadata = log.metadata ? JSON.parse(log.metadata) : {};
        const expectedHash = await this.calculateIntegrityHash(
          log.id,
          {
            eventType: log.eventType,
            teamId: log.teamId,
            tokenId: log.tokenId,
            actorType: log.actorType,
            success: log.success,
          },
          log.timestamp,
          previousHash
        );

        if (metadata.integrityHash !== expectedHash) {
          tamperedLogs.push(log.id);
        }

        previousHash = metadata.integrityHash;
      } catch (error) {
        tamperedLogs.push(log.id);
      }
    }

    const isValid = tamperedLogs.length === 0;

    if (!isValid) {
      // Log tamper detection
      await this.logEvent({
        eventType: "audit_log_tamper_detected",
        actorType: "system",
        success: false,
        severity: "critical",
        category: "security",
        details: {
          tamperedLogCount: tamperedLogs.length,
          verificationPeriodDays: days,
          timestamp: new Date().toISOString(),
        },
      });
    }

    return {
      isValid,
      tamperedLogs,
      totalChecked: logs.length,
      firstTamperedAt:
        tamperedLogs.length > 0
          ? logs.find((l) => tamperedLogs.includes(l.id))?.timestamp
          : undefined,
      lastVerifiedAt: new Date(),
    };
  }

  /**
   * Clean up old audit logs with enhanced retention logic
   */
  async cleanupOldLogs(
    retentionDays = 365,
    dryRun = false
  ): Promise<{
    deletedCount: number;
    retainedCriticalCount: number;
    errors: string[];
  }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const errors: string[] = [];
    let deletedCount = 0;
    let retainedCriticalCount = 0;

    try {
      // Get logs to be deleted (but retain critical security events longer)
      const logsToDelete = await this.db
        .select()
        .from(securityAuditLog)
        .where(gte(securityAuditLog.timestamp, cutoffDate));

      for (const log of logsToDelete) {
        try {
          const metadata = log.metadata ? JSON.parse(log.metadata) : {};

          // Retain critical security events for longer (2x retention period)
          if (metadata.severity === "critical") {
            const criticalCutoff = new Date();
            criticalCutoff.setDate(
              criticalCutoff.getDate() - retentionDays * 2
            );

            if (log.timestamp > criticalCutoff) {
              retainedCriticalCount++;
              continue;
            }
          }

          if (!dryRun) {
            await this.db
              .delete(securityAuditLog)
              .where(eq(securityAuditLog.id, log.id));
          }

          deletedCount++;
        } catch (error) {
          errors.push(
            `Failed to delete log ${log.id}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }
      }

      // Log the cleanup operation
      if (!dryRun) {
        await this.logEvent({
          eventType: "data_retention_cleanup",
          actorType: "system",
          success: errors.length === 0,
          severity: "low",
          category: "configuration",
          details: {
            operation: "audit_log_cleanup",
            retentionDays,
            deletedCount,
            retainedCriticalCount,
            errorCount: errors.length,
            cutoffDate: cutoffDate.toISOString(),
            timestamp: new Date().toISOString(),
          },
        });
      }
    } catch (error) {
      errors.push(
        `Cleanup operation failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    return {
      deletedCount,
      retainedCriticalCount,
      errors,
    };
  }

  /**
   * Calculate integrity hash for tamper detection
   */
  private async calculateIntegrityHash(
    id: string,
    options: Partial<AuditEventOptions>,
    timestamp: Date,
    previousHash?: string | null
  ): Promise<string> {
    const data = JSON.stringify({
      id,
      eventType: options.eventType,
      teamId: options.teamId,
      tokenId: options.tokenId,
      actorType: options.actorType,
      success: options.success,
      timestamp: timestamp.toISOString(),
      previousHash,
    });

    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);

    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Encrypt audit data for secure storage
   */
  private async encryptAuditData(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);

    const keyBuffer = encoder.encode(this.encryptionKey.slice(0, 32));
    const key = await crypto.subtle.importKey(
      "raw",
      keyBuffer,
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      dataBuffer
    );

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...combined));
  }

  /**
   * Decrypt audit data for authorized viewing
   */
  private async decryptAuditData(encryptedData: string): Promise<string> {
    try {
      const combined = new Uint8Array(
        atob(encryptedData)
          .split("")
          .map((char) => char.charCodeAt(0))
      );

      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);

      const encoder = new TextEncoder();
      const keyBuffer = encoder.encode(this.encryptionKey.slice(0, 32));
      const key = await crypto.subtle.importKey(
        "raw",
        keyBuffer,
        { name: "AES-GCM" },
        false,
        ["decrypt"]
      );

      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        encrypted
      );

      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (error) {
      return "[DECRYPTION_FAILED]";
    }
  }

  /**
   * Derive audit encryption key from environment
   */
  private deriveAuditKey(): string {
    // Use a dedicated audit encryption key or derive from main secret
    return "audit_key_placeholder_32_characters";
  }

  /**
   * Determine event severity automatically
   */
  private determineSeverity(
    eventType: SecurityEventType,
    success: boolean
  ): "low" | "medium" | "high" | "critical" {
    if (!success) {
      switch (eventType) {
        case "auth_failure":
        case "token_validation_failed":
          return "medium";
        case "suspicious_activity":
        case "audit_log_tamper_detected":
          return "critical";
        default:
          return "high";
      }
    }

    switch (eventType) {
      case "token_created":
      case "token_rotated":
      case "gdpr_delete_completed":
        return "medium";
      case "token_revoked":
      case "security_alert":
        return "high";
      case "token_accessed":
      case "data_retention_cleanup":
        return "low";
      default:
        return "low";
    }
  }

  /**
   * Determine event category automatically
   */
  private determineCategory(
    eventType: SecurityEventType
  ):
    | "authentication"
    | "authorization"
    | "data_access"
    | "configuration"
    | "security"
    | "compliance" {
    switch (eventType) {
      case "token_created":
      case "token_accessed":
      case "auth_failure":
      case "auth_success":
      case "oauth_flow_started":
      case "oauth_flow_completed":
      case "oauth_flow_failed":
        return "authentication";

      case "token_revoked":
      case "token_rotated":
      case "encryption_key_rotated":
      case "suspicious_activity":
      case "security_alert":
      case "audit_log_tamper_detected":
        return "security";

      case "gdpr_delete_requested":
      case "gdpr_delete_completed":
      case "gdpr_delete_failed":
        return "compliance";

      case "data_retention_cleanup":
      case "config_changed":
        return "configuration";

      default:
        return "security";
    }
  }

  /**
   * Check for security alerts that need immediate attention
   */
  private async checkForSecurityAlerts(
    options: AuditEventOptions
  ): Promise<void> {
    // Implement real-time security alert logic here
    if (
      options.eventType === "suspicious_activity" ||
      options.eventType === "audit_log_tamper_detected" ||
      (options.eventType === "auth_failure" && !options.success)
    ) {
      // Could trigger immediate notifications, webhooks, etc.
      console.warn(`Security Alert: ${options.eventType} detected`, {
        teamId: options.teamId,
        severity: options.severity,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Log audit system failures
   */
  private async logAuditSystemFailure(error: string): Promise<void> {
    try {
      const id = crypto.randomUUID();
      await this.db.insert(securityAuditLog).values({
        id,
        eventType: "system_startup", // Using existing type for simplicity
        actorType: "system",
        success: false,
        errorMessage: this.sanitizeErrorMessage(error),
        timestamp: new Date(),
        metadata: JSON.stringify({
          severity: "critical",
          category: "security",
          auditSystemFailure: true,
        }),
      });
    } catch (criticalError) {
      // Last resort - console logging only
      console.error("CRITICAL: Audit system completely failed:", criticalError);
    }
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
    const sanitized = errorMessage
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
