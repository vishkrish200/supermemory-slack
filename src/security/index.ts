/**
 * Security Services Integration
 *
 * Centralized export and coordination of all security services for
 * easy integration throughout the application.
 */

import type { DrizzleD1Database } from "drizzle-orm/d1";
import { TokenManager } from "./encryption";
import { SecurityAuditLogger } from "./auditLogger";
import { SecureTokenStorage } from "./tokenStorage";
import { TokenRotationService } from "./tokenRotation";
import { GDPRDeletionService } from "./gdprDeletion";
import { TokenRevocationService } from "./tokenRevocation";
import { DataRetentionService } from "./dataRetention";

// Re-export all security services
export { TokenManager } from "./encryption";
export { SecurityAuditLogger } from "./auditLogger";
export { SecureTokenStorage } from "./tokenStorage";
export { TokenRotationService } from "./tokenRotation";
export { GDPRDeletionService } from "./gdprDeletion";
export { TokenRevocationService } from "./tokenRevocation";
export { DataRetentionService } from "./dataRetention";

// Re-export types
export type {
  SecurityEventType,
  ActorType,
  AuditEventOptions,
  AuditSearchOptions,
  AuditStatistics,
  IntegrityCheck,
} from "./auditLogger";

export type {
  RetentionPolicy,
  LegalHold,
  RetentionReport,
  RetentionSummary,
} from "./dataRetention";

export type { RevocationRequest, RevocationResponse } from "./tokenRevocation";

export type { GDPRDeletionRequest } from "./gdprDeletion";

/**
 * Security Services Container
 *
 * Provides a unified interface to all security services with proper
 * dependency injection and service coordination.
 */
export class SecurityServices {
  public readonly tokenManager: TokenManager;
  public readonly auditLogger: SecurityAuditLogger;
  public readonly tokenStorage: SecureTokenStorage;
  public readonly tokenRotation: TokenRotationService;
  public readonly gdprDeletion: GDPRDeletionService;
  public readonly tokenRevocation: TokenRevocationService;
  public readonly dataRetention: DataRetentionService;

  constructor(
    private readonly db: DrizzleD1Database,
    encryptionSecret?: string
  ) {
    // Initialize core services
    this.tokenManager = new TokenManager(encryptionSecret);
    this.auditLogger = new SecurityAuditLogger(db, encryptionSecret);

    // Initialize services that depend on core services
    this.tokenStorage = new SecureTokenStorage(
      db,
      this.tokenManager,
      this.auditLogger
    );
    this.tokenRotation = new TokenRotationService(
      db,
      this.tokenStorage,
      this.auditLogger
    );
    this.gdprDeletion = new GDPRDeletionService(db, this.auditLogger);
    this.tokenRevocation = new TokenRevocationService(
      db,
      this.tokenStorage,
      this.auditLogger
    );
    this.dataRetention = new DataRetentionService(db, this.auditLogger);
  }

  /**
   * Initialize default retention policies and perform initial security checks
   */
  async initialize(): Promise<void> {
    try {
      // Verify audit log integrity for the last 7 days
      const integrityCheck = await this.auditLogger.verifyAuditIntegrity(
        undefined,
        7
      );

      if (!integrityCheck.isValid) {
        console.warn(
          `Security Warning: ${integrityCheck.tamperedLogs.length} audit logs failed integrity verification`
        );

        // Log the tamper detection
        await this.auditLogger.logSecurityAlert(
          "audit_log_tamper_detected",
          "system",
          `Detected ${integrityCheck.tamperedLogs.length} tampered audit logs during initialization`,
          {
            tamperedLogIds: integrityCheck.tamperedLogs,
            totalChecked: integrityCheck.totalChecked,
          },
          "critical"
        );
      }

      // Log successful security services initialization
      await this.auditLogger.logEvent({
        eventType: "system_startup",
        actorType: "system",
        success: true,
        severity: "low",
        category: "security",
        details: {
          operation: "security_services_initialization",
          servicesLoaded: [
            "TokenManager",
            "SecurityAuditLogger",
            "SecureTokenStorage",
            "TokenRotationService",
            "GDPRDeletionService",
            "TokenRevocationService",
            "DataRetentionService",
          ],
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("Failed to initialize security services:", error);

      // Try to log the failure
      try {
        await this.auditLogger.logEvent({
          eventType: "system_startup",
          actorType: "system",
          success: false,
          severity: "critical",
          category: "security",
          errorMessage:
            error instanceof Error
              ? error.message
              : "Unknown initialization error",
          details: {
            operation: "security_services_initialization_failed",
            timestamp: new Date().toISOString(),
          },
        });
      } catch (auditError) {
        console.error(
          "Critical: Failed to log security initialization failure:",
          auditError
        );
      }

      throw error;
    }
  }

  /**
   * Perform comprehensive security health check
   */
  async performHealthCheck(): Promise<{
    status: "healthy" | "warning" | "critical";
    checks: Record<
      string,
      { status: "pass" | "warn" | "fail"; message: string }
    >;
    timestamp: Date;
  }> {
    const checks: Record<
      string,
      { status: "pass" | "warn" | "fail"; message: string }
    > = {};
    let overallStatus: "healthy" | "warning" | "critical" = "healthy";

    try {
      // Check audit log integrity
      const integrityCheck = await this.auditLogger.verifyAuditIntegrity(
        undefined,
        1
      );
      if (integrityCheck.isValid) {
        checks.auditIntegrity = {
          status: "pass",
          message: `Verified ${integrityCheck.totalChecked} audit logs`,
        };
      } else {
        checks.auditIntegrity = {
          status: "fail",
          message: `${integrityCheck.tamperedLogs.length} tampered logs detected`,
        };
        overallStatus = "critical";
      }

      // Check retention compliance
      const retentionSummary = await this.dataRetention.getRetentionSummary();
      if (retentionSummary.complianceStatus === "compliant") {
        checks.retentionCompliance = {
          status: "pass",
          message: "All retention policies compliant",
        };
      } else if (retentionSummary.complianceStatus === "warning") {
        checks.retentionCompliance = {
          status: "warn",
          message: retentionSummary.issues.join(", "),
        };
        if (overallStatus === "healthy") overallStatus = "warning";
      } else {
        checks.retentionCompliance = {
          status: "fail",
          message: retentionSummary.issues.join(", "),
        };
        overallStatus = "critical";
      }

      // Check for security statistics
      const stats = await this.auditLogger.getAuditStatistics(undefined, 1);
      if (stats.securityAlertsLast24h === 0) {
        checks.securityAlerts = {
          status: "pass",
          message: "No security alerts in last 24h",
        };
      } else if (stats.securityAlertsLast24h < 5) {
        checks.securityAlerts = {
          status: "warn",
          message: `${stats.securityAlertsLast24h} security alerts in last 24h`,
        };
        if (overallStatus === "healthy") overallStatus = "warning";
      } else {
        checks.securityAlerts = {
          status: "fail",
          message: `${stats.securityAlertsLast24h} security alerts in last 24h`,
        };
        overallStatus = "critical";
      }

      // Log health check results
      await this.auditLogger.logEvent({
        eventType: "system_startup", // Using existing event type
        actorType: "system",
        success: overallStatus !== "critical",
        severity:
          overallStatus === "critical"
            ? "high"
            : overallStatus === "warning"
            ? "medium"
            : "low",
        category: "security",
        details: {
          operation: "security_health_check",
          overallStatus,
          checksPerformed: Object.keys(checks).length,
          failedChecks: Object.values(checks).filter((c) => c.status === "fail")
            .length,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      checks.healthCheckExecution = {
        status: "fail",
        message:
          error instanceof Error
            ? error.message
            : "Health check execution failed",
      };
      overallStatus = "critical";
    }

    return {
      status: overallStatus,
      checks,
      timestamp: new Date(),
    };
  }

  /**
   * Execute scheduled maintenance tasks
   */
  async performScheduledMaintenance(): Promise<{
    success: boolean;
    tasks: Array<{
      name: string;
      success: boolean;
      message: string;
      duration: number;
    }>;
  }> {
    const tasks: Array<{
      name: string;
      success: boolean;
      message: string;
      duration: number;
    }> = [];

    // Token rotation health check
    const rotationStart = Date.now();
    try {
      await this.tokenRotation.performHealthChecks();
      tasks.push({
        name: "token_rotation_health_check",
        success: true,
        message: "Token health checks completed successfully",
        duration: Date.now() - rotationStart,
      });
    } catch (error) {
      tasks.push({
        name: "token_rotation_health_check",
        success: false,
        message:
          error instanceof Error ? error.message : "Token health check failed",
        duration: Date.now() - rotationStart,
      });
    }

    // Data retention cleanup
    const retentionStart = Date.now();
    try {
      const reports = await this.dataRetention.executeRetentionPolicies(false);
      const totalDeleted = reports.reduce((sum, r) => sum + r.itemsDeleted, 0);
      tasks.push({
        name: "data_retention_cleanup",
        success: reports.every((r) => r.errors.length === 0),
        message: `Retention cleanup completed: ${totalDeleted} items removed`,
        duration: Date.now() - retentionStart,
      });
    } catch (error) {
      tasks.push({
        name: "data_retention_cleanup",
        success: false,
        message:
          error instanceof Error ? error.message : "Retention cleanup failed",
        duration: Date.now() - retentionStart,
      });
    }

    const allSuccessful = tasks.every((t) => t.success);

    // Log maintenance completion
    await this.auditLogger.logEvent({
      eventType: "system_startup", // Using existing event type
      actorType: "system",
      success: allSuccessful,
      severity: "low",
      category: "configuration",
      details: {
        operation: "scheduled_maintenance",
        tasksCompleted: tasks.length,
        successfulTasks: tasks.filter((t) => t.success).length,
        totalDuration: tasks.reduce((sum, t) => sum + t.duration, 0),
        timestamp: new Date().toISOString(),
      },
    });

    return {
      success: allSuccessful,
      tasks,
    };
  }
}

/**
 * Create and initialize security services
 */
export async function createSecurityServices(
  db: DrizzleD1Database,
  encryptionSecret?: string
): Promise<SecurityServices> {
  const services = new SecurityServices(db, encryptionSecret);
  await services.initialize();
  return services;
}
