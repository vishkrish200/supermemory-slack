/**
 * Data Retention Service
 *
 * Manages automated cleanup and retention policies for all sensitive data
 * including tokens, audit logs, sync logs, and temporary data.
 * Ensures compliance with legal and organizational requirements.
 */

import { eq, and, lte, gte } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { SecurityAuditLogger } from "./auditLogger";
import {
  slackToken,
  slackSyncLog,
  slackBackfill,
  securityAuditLog,
  type SlackToken,
} from "../db/schema";

export interface RetentionPolicy {
  name: string;
  description: string;
  enabled: boolean;
  dataType: "tokens" | "audit_logs" | "sync_logs" | "backfills" | "temp_data";
  retentionDays: number;
  criticalRetentionDays?: number; // Extended retention for critical data
  teamSpecific?: Record<string, number>; // Team-specific overrides
  legalHoldExempt?: boolean; // Whether this policy respects legal holds
  autoCleanup: boolean;
  preserveCount?: number; // Minimum number of records to always preserve
  cleanupSchedule: "daily" | "weekly" | "monthly";
  lastRun?: Date;
  nextRun?: Date;
}

export interface LegalHold {
  id: string;
  teamId?: string;
  dataTypes: string[];
  reason: string;
  requestedBy: string;
  startDate: Date;
  endDate?: Date;
  isActive: boolean;
  exemptions?: string[]; // Specific data IDs that can be cleaned up despite hold
}

export interface RetentionReport {
  policyName: string;
  dataType: string;
  itemsEvaluated: number;
  itemsDeleted: number;
  itemsRetained: number;
  itemsOnLegalHold: number;
  oldestRetained: Date | null;
  storageFreed: number; // Estimated bytes
  executionTime: number; // Milliseconds
  errors: string[];
  warnings: string[];
}

export interface RetentionSummary {
  totalPolicies: number;
  activePolicies: number;
  lastRunDate: Date;
  totalItemsDeleted: number;
  totalStorageFreed: number;
  activeLegalHolds: number;
  upcomingRetentions: Array<{
    policyName: string;
    dataType: string;
    itemsToDelete: number;
    scheduledDate: Date;
  }>;
  complianceStatus: "compliant" | "warning" | "violation";
  issues: string[];
}

export class DataRetentionService {
  private readonly auditLogger: SecurityAuditLogger;
  private readonly policies: Map<string, RetentionPolicy> = new Map();
  private readonly legalHolds: Map<string, LegalHold> = new Map();

  constructor(
    private readonly db: DrizzleD1Database,
    auditLogger: SecurityAuditLogger
  ) {
    this.auditLogger = auditLogger;
    this.initializeDefaultPolicies();
  }

  /**
   * Initialize default retention policies based on best practices
   */
  private initializeDefaultPolicies(): void {
    const defaultPolicies: RetentionPolicy[] = [
      {
        name: "revoked_tokens",
        description: "Cleanup revoked tokens after extended retention period",
        enabled: true,
        dataType: "tokens",
        retentionDays: 90, // Keep revoked tokens for 90 days for audit purposes
        autoCleanup: true,
        cleanupSchedule: "weekly",
        legalHoldExempt: false,
      },
      {
        name: "audit_logs_standard",
        description: "Standard audit log retention for compliance",
        enabled: true,
        dataType: "audit_logs",
        retentionDays: 365, // 1 year standard retention
        criticalRetentionDays: 2555, // 7 years for critical security events
        autoCleanup: true,
        cleanupSchedule: "monthly",
        legalHoldExempt: false,
      },
      {
        name: "sync_logs_cleanup",
        description: "Cleanup old sync operation logs",
        enabled: true,
        dataType: "sync_logs",
        retentionDays: 180, // 6 months for sync logs
        preserveCount: 1000, // Always keep at least 1000 most recent logs
        autoCleanup: true,
        cleanupSchedule: "weekly",
        legalHoldExempt: true,
      },
      {
        name: "backfill_logs_cleanup",
        description: "Cleanup completed backfill operation logs",
        enabled: true,
        dataType: "backfills",
        retentionDays: 90, // 3 months for backfill logs
        autoCleanup: true,
        cleanupSchedule: "monthly",
        legalHoldExempt: true,
      },
      {
        name: "temp_data_cleanup",
        description: "Aggressive cleanup of temporary and ephemeral data",
        enabled: true,
        dataType: "temp_data",
        retentionDays: 7, // 1 week for temporary data
        autoCleanup: true,
        cleanupSchedule: "daily",
        legalHoldExempt: true,
      },
    ];

    for (const policy of defaultPolicies) {
      this.policies.set(policy.name, policy);
    }
  }

  /**
   * Add or update a retention policy
   */
  async setRetentionPolicy(policy: RetentionPolicy): Promise<void> {
    // Validate policy
    if (policy.retentionDays < 1) {
      throw new Error("Retention period must be at least 1 day");
    }

    if (
      policy.criticalRetentionDays &&
      policy.criticalRetentionDays < policy.retentionDays
    ) {
      throw new Error(
        "Critical retention period must be longer than standard retention"
      );
    }

    this.policies.set(policy.name, policy);

    // Log policy update
    await this.auditLogger.logEvent({
      eventType: "config_changed",
      actorType: "admin",
      success: true,
      severity: "medium",
      category: "configuration",
      details: {
        operation: "retention_policy_updated",
        policyName: policy.name,
        dataType: policy.dataType,
        retentionDays: policy.retentionDays,
        enabled: policy.enabled,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Get a specific retention policy
   */
  getRetentionPolicy(policyName: string): RetentionPolicy | undefined {
    return this.policies.get(policyName);
  }

  /**
   * Get all retention policies
   */
  getAllRetentionPolicies(): RetentionPolicy[] {
    return Array.from(this.policies.values());
  }

  /**
   * Add a legal hold to prevent data deletion
   */
  async addLegalHold(hold: Omit<LegalHold, "id">): Promise<string> {
    const id = crypto.randomUUID();
    const legalHold: LegalHold = {
      id,
      ...hold,
      isActive: true,
    };

    this.legalHolds.set(id, legalHold);

    // Log legal hold creation
    await this.auditLogger.logEvent({
      eventType: "config_changed",
      teamId: hold.teamId,
      actorType: "admin",
      success: true,
      severity: "high",
      category: "compliance",
      details: {
        operation: "legal_hold_created",
        legalHoldId: id,
        reason: hold.reason,
        dataTypes: hold.dataTypes,
        requestedBy: hold.requestedBy,
        timestamp: new Date().toISOString(),
      },
    });

    return id;
  }

  /**
   * Remove or deactivate a legal hold
   */
  async removeLegalHold(holdId: string, reason: string): Promise<void> {
    const hold = this.legalHolds.get(holdId);
    if (!hold) {
      throw new Error(`Legal hold ${holdId} not found`);
    }

    hold.isActive = false;
    hold.endDate = new Date();

    // Log legal hold removal
    await this.auditLogger.logEvent({
      eventType: "config_changed",
      teamId: hold.teamId,
      actorType: "admin",
      success: true,
      severity: "high",
      category: "compliance",
      details: {
        operation: "legal_hold_removed",
        legalHoldId: holdId,
        reason,
        originalReason: hold.reason,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Check if data is subject to legal hold
   */
  private isOnLegalHold(
    dataType: string,
    teamId?: string,
    itemId?: string
  ): boolean {
    for (const hold of this.legalHolds.values()) {
      if (!hold.isActive) continue;

      // Check if legal hold covers this data type
      if (!hold.dataTypes.includes(dataType)) continue;

      // Check team-specific holds
      if (hold.teamId && hold.teamId !== teamId) continue;

      // Check item-specific exemptions
      if (itemId && hold.exemptions?.includes(itemId)) continue;

      // Check if hold is still valid (not expired)
      if (hold.endDate && hold.endDate < new Date()) continue;

      return true;
    }

    return false;
  }

  /**
   * Execute all enabled retention policies
   */
  async executeRetentionPolicies(
    dryRun = false
  ): Promise<RetentionReport[]> {
    const reports: RetentionReport[] = [];

    for (const policy of this.policies.values()) {
      if (!policy.enabled) continue;

      try {
        const report = await this.executeRetentionPolicy(policy, dryRun);
        reports.push(report);

        // Update policy execution time
        policy.lastRun = new Date();
        policy.nextRun = this.calculateNextRun(policy);
      } catch (error) {
        const errorReport: RetentionReport = {
          policyName: policy.name,
          dataType: policy.dataType,
          itemsEvaluated: 0,
          itemsDeleted: 0,
          itemsRetained: 0,
          itemsOnLegalHold: 0,
          oldestRetained: null,
          storageFreed: 0,
          executionTime: 0,
          errors: [error instanceof Error ? error.message : "Unknown error"],
          warnings: [],
        };
        reports.push(errorReport);
      }
    }

    // Log overall retention execution
    const totalDeleted = reports.reduce((sum, r) => sum + r.itemsDeleted, 0);
    const totalFreed = reports.reduce((sum, r) => sum + r.storageFreed, 0);

    await this.auditLogger.logEvent({
      eventType: "data_retention_cleanup",
      actorType: "system",
      success: reports.every((r) => r.errors.length === 0),
      severity: "low",
      category: "configuration",
      details: {
        operation: "retention_policy_execution",
        policiesExecuted: reports.length,
        totalItemsDeleted: totalDeleted,
        totalStorageFreed: totalFreed,
        dryRun,
        timestamp: new Date().toISOString(),
      },
    });

    return reports;
  }

  /**
   * Execute a specific retention policy
   */
  private async executeRetentionPolicy(
    policy: RetentionPolicy,
    dryRun: boolean
  ): Promise<RetentionReport> {
    const startTime = Date.now();
    let itemsEvaluated = 0;
    let itemsDeleted = 0;
    let itemsRetained = 0;
    let itemsOnLegalHold = 0;
    let oldestRetained: Date | null = null;
    let storageFreed = 0;
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      switch (policy.dataType) {
        case "tokens": {
          const tokenResults = await this.cleanupTokens(policy, dryRun);
          itemsEvaluated = tokenResults.evaluated;
          itemsDeleted = tokenResults.deleted;
          itemsRetained = tokenResults.retained;
          itemsOnLegalHold = tokenResults.legalHold;
          oldestRetained = tokenResults.oldestRetained;
          storageFreed = tokenResults.storageFreed;
          break;
        }

        case "audit_logs": {
          const auditResults = await this.auditLogger.cleanupOldLogs(
            policy.retentionDays,
            dryRun
          );
          itemsDeleted = auditResults.deletedCount;
          itemsRetained = auditResults.retainedCriticalCount;
          errors.push(...auditResults.errors);
          break;
        }

        case "sync_logs": {
          const syncResults = await this.cleanupSyncLogs(policy, dryRun);
          itemsEvaluated = syncResults.evaluated;
          itemsDeleted = syncResults.deleted;
          itemsRetained = syncResults.retained;
          itemsOnLegalHold = syncResults.legalHold;
          oldestRetained = syncResults.oldestRetained;
          storageFreed = syncResults.storageFreed;
          break;
        }

        case "backfills": {
          const backfillResults = await this.cleanupBackfills(policy, dryRun);
          itemsEvaluated = backfillResults.evaluated;
          itemsDeleted = backfillResults.deleted;
          itemsRetained = backfillResults.retained;
          itemsOnLegalHold = backfillResults.legalHold;
          oldestRetained = backfillResults.oldestRetained;
          storageFreed = backfillResults.storageFreed;
          break;
        }

        case "temp_data":
          // Temporary data cleanup would involve Workers KV and other ephemeral storage
          warnings.push(
            "Temporary data cleanup not yet implemented for Workers KV"
          );
          break;

        default:
          errors.push(`Unknown data type: ${policy.dataType}`);
      }
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : "Unknown error during cleanup"
      );
    }

    const executionTime = Date.now() - startTime;

    return {
      policyName: policy.name,
      dataType: policy.dataType,
      itemsEvaluated,
      itemsDeleted,
      itemsRetained,
      itemsOnLegalHold,
      oldestRetained,
      storageFreed,
      executionTime,
      errors,
      warnings,
    };
  }

  /**
   * Cleanup revoked tokens based on retention policy
   */
  private async cleanupTokens(
    policy: RetentionPolicy,
    dryRun: boolean
  ): Promise<{
    evaluated: number;
    deleted: number;
    retained: number;
    legalHold: number;
    oldestRetained: Date | null;
    storageFreed: number;
  }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);

    // Only delete revoked tokens that are past retention period
    const candidateTokens = await this.db
      .select()
      .from(slackToken)
      .where(
        and(
          eq(slackToken.isRevoked, true),
          lte(slackToken.revokedAt, cutoffDate)
        )
      );

    let deleted = 0;
    let retained = 0;
    let legalHold = 0;
    let oldestRetained: Date | null = null;
    let storageFreed = 0;

    for (const token of candidateTokens) {
      // Check legal hold
      if (this.isOnLegalHold("tokens", token.teamId, token.id)) {
        legalHold++;
        continue;
      }

      // Check team-specific retention overrides
      const teamRetentionDays =
        policy.teamSpecific?.[token.teamId] || policy.retentionDays;
      const teamCutoffDate = new Date();
      teamCutoffDate.setDate(teamCutoffDate.getDate() - teamRetentionDays);

      if (token.revokedAt && token.revokedAt > teamCutoffDate) {
        retained++;
        if (!oldestRetained || token.revokedAt < oldestRetained) {
          oldestRetained = token.revokedAt;
        }
        continue;
      }

      if (!dryRun) {
        try {
          await this.db.delete(slackToken).where(eq(slackToken.id, token.id));

          // Estimate storage freed (encrypted token + metadata)
          storageFreed += token.encryptedToken.length + 200; // Rough estimate
          deleted++;
        } catch (error) {
          console.warn(`Failed to delete token ${token.id}:`, error);
          retained++;
        }
      } else {
        deleted++; // Would delete in real run
      }
    }

    return {
      evaluated: candidateTokens.length,
      deleted,
      retained,
      legalHold,
      oldestRetained,
      storageFreed,
    };
  }

  /**
   * Cleanup old sync logs based on retention policy
   */
  private async cleanupSyncLogs(
    policy: RetentionPolicy,
    dryRun: boolean
  ): Promise<{
    evaluated: number;
    deleted: number;
    retained: number;
    legalHold: number;
    oldestRetained: Date | null;
    storageFreed: number;
  }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);

    const candidateLogs = await this.db
      .select()
      .from(slackSyncLog)
      .where(lte(slackSyncLog.createdAt, cutoffDate));

    // Sort by creation date to preserve the most recent if preserveCount is set
    candidateLogs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    let deleted = 0;
    let retained = 0;
    let legalHold = 0;
    let oldestRetained: Date | null = null;
    let storageFreed = 0;

    for (let i = 0; i < candidateLogs.length; i++) {
      const log = candidateLogs[i];

      // Check preserve count
      if (policy.preserveCount && i < policy.preserveCount) {
        retained++;
        if (!oldestRetained || log.createdAt < oldestRetained) {
          oldestRetained = log.createdAt;
        }
        continue;
      }

      // Check legal hold
      if (this.isOnLegalHold("sync_logs", log.teamId, log.id)) {
        legalHold++;
        continue;
      }

      if (!dryRun) {
        try {
          await this.db.delete(slackSyncLog).where(eq(slackSyncLog.id, log.id));

          storageFreed += 500; // Rough estimate for sync log size
          deleted++;
        } catch (error) {
          console.warn(`Failed to delete sync log ${log.id}:`, error);
          retained++;
        }
      } else {
        deleted++; // Would delete in real run
      }
    }

    return {
      evaluated: candidateLogs.length,
      deleted,
      retained,
      legalHold,
      oldestRetained,
      storageFreed,
    };
  }

  /**
   * Cleanup old backfill logs based on retention policy
   */
  private async cleanupBackfills(
    policy: RetentionPolicy,
    dryRun: boolean
  ): Promise<{
    evaluated: number;
    deleted: number;
    retained: number;
    legalHold: number;
    oldestRetained: Date | null;
    storageFreed: number;
  }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);

    // Only cleanup completed or failed backfills
    const candidateBackfills = await this.db
      .select()
      .from(slackBackfill)
      .where(
        and(
          lte(slackBackfill.createdAt, cutoffDate),
          eq(slackBackfill.status, "completed") // Only delete completed backfills
        )
      );

    let deleted = 0;
    let retained = 0;
    let legalHold = 0;
    let oldestRetained: Date | null = null;
    let storageFreed = 0;

    for (const backfill of candidateBackfills) {
      // Check legal hold
      if (this.isOnLegalHold("backfills", backfill.teamId, backfill.id)) {
        legalHold++;
        continue;
      }

      if (!dryRun) {
        try {
          await this.db
            .delete(slackBackfill)
            .where(eq(slackBackfill.id, backfill.id));

          storageFreed += 1000; // Rough estimate for backfill log size
          deleted++;
        } catch (error) {
          console.warn(`Failed to delete backfill ${backfill.id}:`, error);
          retained++;
          if (!oldestRetained || backfill.createdAt < oldestRetained) {
            oldestRetained = backfill.createdAt;
          }
        }
      } else {
        deleted++; // Would delete in real run
      }
    }

    return {
      evaluated: candidateBackfills.length,
      deleted,
      retained,
      legalHold,
      oldestRetained,
      storageFreed,
    };
  }

  /**
   * Calculate next scheduled run for a policy
   */
  private calculateNextRun(policy: RetentionPolicy): Date {
    const now = new Date();
    const next = new Date(now);

    switch (policy.cleanupSchedule) {
      case "daily":
        next.setDate(next.getDate() + 1);
        break;
      case "weekly":
        next.setDate(next.getDate() + 7);
        break;
      case "monthly":
        next.setMonth(next.getMonth() + 1);
        break;
    }

    return next;
  }

  /**
   * Generate a comprehensive retention summary
   */
  async getRetentionSummary(): Promise<RetentionSummary> {
    const policies = this.getAllRetentionPolicies();
    const activePolicies = policies.filter((p) => p.enabled);
    const activeLegalHolds = Array.from(this.legalHolds.values()).filter(
      (h) => h.isActive
    );

    // Calculate upcoming retentions (simplified)
    const upcomingRetentions = activePolicies
      .filter((p) => p.nextRun)
      .map((p) => ({
        policyName: p.name,
        dataType: p.dataType,
        itemsToDelete: 0, // Would require actual data analysis
        scheduledDate: p.nextRun!,
      }))
      .sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime())
      .slice(0, 5);

    // Determine compliance status
    let complianceStatus: "compliant" | "warning" | "violation" = "compliant";
    const issues: string[] = [];

    // Check for overdue policies
    const now = new Date();
    const overduePolicies = activePolicies.filter(
      (p) => p.nextRun && p.nextRun < now
    );

    if (overduePolicies.length > 0) {
      complianceStatus = "warning";
      issues.push(`${overduePolicies.length} retention policies are overdue`);
    }

    // Check for conflicting legal holds
    const conflictingHolds = activeLegalHolds.filter(
      (h) =>
        !h.legalHoldExempt &&
        h.startDate < new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    );

    if (conflictingHolds.length > 0) {
      complianceStatus = "violation";
      issues.push(
        `${conflictingHolds.length} legal holds may conflict with retention policies`
      );
    }

    return {
      totalPolicies: policies.length,
      activePolicies: activePolicies.length,
      lastRunDate: new Date(), // Would track actual last run
      totalItemsDeleted: 0, // Would require historical data
      totalStorageFreed: 0, // Would require historical data
      activeLegalHolds: activeLegalHolds.length,
      upcomingRetentions,
      complianceStatus,
      issues,
    };
  }

  /**
   * Get all active legal holds
   */
  getActiveLegalHolds(): LegalHold[] {
    return Array.from(this.legalHolds.values()).filter((h) => h.isActive);
  }

  /**
   * Preview what would be deleted by a specific policy (dry run)
   */
  async previewPolicyExecution(policyName: string): Promise<RetentionReport> {
    const policy = this.policies.get(policyName);
    if (!policy) {
      throw new Error(`Policy ${policyName} not found`);
    }

    return await this.executeRetentionPolicy(policy, true);
  }
}
