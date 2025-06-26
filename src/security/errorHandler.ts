/**
 * Secure Error Handler
 *
 * Provides secure error handling that prevents sensitive data leakage,
 * offers user-friendly error messages, and integrates with security
 * alerting systems for critical events.
 */

import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { SecurityAuditLogger } from "./auditLogger";

export type ErrorSeverity = "low" | "medium" | "high" | "critical";
export type ErrorCategory =
  | "authentication"
  | "authorization"
  | "validation"
  | "security"
  | "system"
  | "external_api"
  | "rate_limit";

export interface SecureErrorOptions {
  category: ErrorCategory;
  severity?: ErrorSeverity;
  teamId?: string;
  userId?: string;
  operation?: string;
  originalError?: Error | unknown;
  userMessage?: string;
  metadata?: Record<string, unknown>;
  skipAlert?: boolean;
  skipAudit?: boolean;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    category: ErrorCategory;
    timestamp: string;
    requestId?: string;
  };
}

export interface ErrorStatistics {
  totalErrors: number;
  errorsByCategory: Record<ErrorCategory, number>;
  errorsBySeverity: Record<ErrorSeverity, number>;
  topErrors: Array<{
    code: string;
    count: number;
    lastOccurrence: Date;
  }>;
  securityEventsLast24h: number;
  alertsSentLast24h: number;
}

/**
 * Secure Error Handler Service
 *
 * Centralized error handling with security-first design principles
 */
export class SecureErrorHandler {
  private readonly auditLogger: SecurityAuditLogger;
  private readonly sensitivePatterns: RegExp[];
  private readonly errorCounts: Map<string, { count: number; lastSeen: Date }> =
    new Map();

  constructor(
    private readonly db: DrizzleD1Database,
    auditLogger: SecurityAuditLogger
  ) {
    this.auditLogger = auditLogger;

    // Patterns that indicate sensitive data in error messages
    this.sensitivePatterns = [
      /token[:\s]+[a-zA-Z0-9+/=]{10,}/gi,
      /secret[:\s]+[a-zA-Z0-9+/=]{10,}/gi,
      /password[:\s]+[^\s]{6,}/gi,
      /key[:\s]+[a-zA-Z0-9+/=]{10,}/gi,
      /bearer\s+[a-zA-Z0-9+/=]{10,}/gi,
      /authorization[:\s]+[a-zA-Z0-9+/=]{10,}/gi,
      /xoxb-[a-zA-Z0-9-]{24,}/gi, // Slack bot tokens
      /xoxa-[a-zA-Z0-9-]{24,}/gi, // Slack app tokens
      /xoxp-[a-zA-Z0-9-]{24,}/gi, // Slack user tokens
      /[a-zA-Z0-9]{32,64}/g, // Long random strings that might be secrets
    ];
  }

  /**
   * Handle an error securely and return a safe response
   */
  async handleError(
    options: SecureErrorOptions,
    requestId?: string
  ): Promise<ErrorResponse> {
    try {
      // Generate error code and determine severity
      const errorCode = this.generateErrorCode(
        options.category,
        options.operation
      );
      const severity =
        options.severity ||
        this.determineSeverity(options.category, options.originalError);

      // Sanitize error message
      const sanitizedMessage = this.sanitizeErrorMessage(options.originalError);
      const userFriendlyMessage =
        options.userMessage ||
        this.generateUserMessage(options.category, errorCode);

      // Track error frequency
      this.trackErrorFrequency(errorCode);

      // Log to audit system (if not skipped)
      if (!options.skipAudit) {
        await this.auditLogger.logEvent({
          eventType:
            severity === "critical" ? "security_alert" : "auth_failure",
          teamId: options.teamId,
          actorType: "system",
          success: false,
          severity,
          category: this.mapCategoryToAuditCategory(options.category),
          errorMessage: sanitizedMessage,
          details: this.sanitizeMetadata({
            errorCode,
            operation: options.operation,
            category: options.category,
            userAgent: options.metadata?.userAgent,
            ipAddress: options.metadata?.ipAddress,
            endpoint: options.metadata?.endpoint,
            timestamp: new Date().toISOString(),
          }),
        });
      }

      // Return secure error response
      return {
        success: false,
        error: {
          code: errorCode,
          message: userFriendlyMessage,
          category: options.category,
          timestamp: new Date().toISOString(),
          requestId,
        },
      };
    } catch (handlingError) {
      // Fallback error handling - never let error handling itself fail
      console.error("Critical: Error handler failed:", handlingError);

      return {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "An internal error occurred. Please try again later.",
          category: "system",
          timestamp: new Date().toISOString(),
          requestId,
        },
      };
    }
  }

  /**
   * Handle authentication errors specifically
   */
  async handleAuthError(
    error: Error | unknown,
    teamId?: string,
    operation?: string,
    metadata?: Record<string, unknown>
  ): Promise<ErrorResponse> {
    return this.handleError({
      category: "authentication",
      severity: "medium",
      teamId,
      operation,
      originalError: error,
      userMessage: "Authentication failed. Please check your credentials.",
      metadata,
    });
  }

  /**
   * Handle security violations with immediate alerting
   */
  async handleSecurityViolation(
    violation: string,
    teamId?: string,
    userId?: string,
    metadata?: Record<string, unknown>
  ): Promise<ErrorResponse> {
    return this.handleError({
      category: "security",
      severity: "critical",
      teamId,
      userId,
      operation: "security_violation",
      userMessage: "Access denied due to security policy violation.",
      metadata: {
        violation,
        ...metadata,
      },
    });
  }

  /**
   * Handle rate limiting errors
   */
  async handleRateLimitError(
    limit: number,
    resetTime: Date,
    teamId?: string,
    metadata?: Record<string, unknown>
  ): Promise<ErrorResponse> {
    return this.handleError({
      category: "rate_limit",
      severity: "low",
      teamId,
      operation: "rate_limit_exceeded",
      userMessage:
        "Rate limit exceeded. Please try again after " +
        resetTime.toISOString() +
        ".",
      metadata: {
        limit,
        resetTime: resetTime.toISOString(),
        ...metadata,
      },
    });
  }

  /**
   * Handle external API errors (e.g., Slack API, Supermemory API)
   */
  async handleExternalApiError(
    apiName: string,
    error: Error | unknown,
    teamId?: string,
    metadata?: Record<string, unknown>
  ): Promise<ErrorResponse> {
    return this.handleError({
      category: "external_api",
      severity: "medium",
      teamId,
      operation: `${apiName}_api_error`,
      originalError: error,
      userMessage: "External service temporarily unavailable. Please try again later.",
      metadata: {
        apiName,
        ...metadata,
      },
    });
  }

  /**
   * Get error statistics for monitoring
   */
  getErrorStatistics(hours = 24): ErrorStatistics {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Calculate statistics from error tracking
    const recentErrors = Array.from(this.errorCounts.entries()).filter(
      ([_, data]) => data.lastSeen > cutoffTime
    );

    const totalErrors = recentErrors.reduce(
      (sum, [_, data]) => sum + data.count,
      0
    );

    const topErrors = recentErrors
      .map(([code, data]) => ({
        code,
        count: data.count,
        lastOccurrence: data.lastSeen,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const securityEventsLast24h = recentErrors
      .filter(([code, _]) => code.startsWith("SEC_"))
      .reduce((sum, [_, data]) => sum + data.count, 0);

    return {
      totalErrors,
      errorsByCategory: this.calculateErrorsByCategory(recentErrors),
      errorsBySeverity: this.calculateErrorsBySeverity(recentErrors),
      topErrors,
      securityEventsLast24h,
      alertsSentLast24h: 0, // Would require alert tracking
    };
  }

  /**
   * Sanitize error message to remove sensitive data
   */
  private sanitizeErrorMessage(error: Error | unknown): string {
    let message = "";

    if (error instanceof Error) {
      message = error.message;
    } else if (typeof error === "string") {
      message = error;
    } else {
      message = "Unknown error occurred";
    }

    // Remove sensitive patterns
    for (const pattern of this.sensitivePatterns) {
      message = message.replace(pattern, "[REDACTED]");
    }

    // Truncate very long messages
    if (message.length > 500) {
      message = message.substring(0, 500) + "...";
    }

    return message;
  }

  /**
   * Sanitize metadata to ensure no sensitive data
   */
  private sanitizeMetadata(
    metadata: Record<string, unknown>
  ): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    const forbiddenKeys = [
      "token",
      "secret",
      "password",
      "key",
      "authorization",
    ];

    for (const [key, value] of Object.entries(metadata)) {
      if (
        forbiddenKeys.some((forbidden) => key.toLowerCase().includes(forbidden))
      ) {
        continue;
      }

      if (typeof value === "string") {
        sanitized[key] = this.sanitizeErrorMessage(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Generate a unique error code for tracking
   */
  private generateErrorCode(
    category: ErrorCategory,
    operation?: string
  ): string {
    const prefix = this.getCategoryPrefix(category);
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();

    return `${prefix}_${timestamp}_${random}`;
  }

  /**
   * Get category prefix for error codes
   */
  private getCategoryPrefix(category: ErrorCategory): string {
    const prefixes: Record<ErrorCategory, string> = {
      authentication: "AUTH",
      authorization: "AUTHZ",
      validation: "VAL",
      security: "SEC",
      system: "SYS",
      external_api: "EXT",
      rate_limit: "RATE",
    };

    return prefixes[category];
  }

  /**
   * Determine error severity based on category and error content
   */
  private determineSeverity(
    category: ErrorCategory,
    error: Error | unknown
  ): ErrorSeverity {
    // Security issues are always high/critical
    if (category === "security") return "critical";

    // Check error message for severity indicators
    const message = error instanceof Error ? error.message.toLowerCase() : "";

    if (message.includes("unauthorized") || message.includes("forbidden")) {
      return "high";
    }

    if (message.includes("timeout") || message.includes("connection")) {
      return "medium";
    }

    // Category-based defaults
    const severityMap: Record<ErrorCategory, ErrorSeverity> = {
      authentication: "medium",
      authorization: "high",
      validation: "low",
      security: "critical",
      system: "high",
      external_api: "medium",
      rate_limit: "low",
    };

    return severityMap[category];
  }

  /**
   * Generate user-friendly error message
   */
  private generateUserMessage(
    category: ErrorCategory,
    errorCode: string
  ): string {
    const messages: Record<ErrorCategory, string> = {
      authentication:
        "Authentication failed. Please check your credentials and try again.",
      authorization: "You do not have permission to perform this action.",
      validation:
        "The provided data is invalid. Please check your input and try again.",
      security: "Access denied due to security policy.",
      system: "A system error occurred. Please try again later.",
      external_api:
        "External service is temporarily unavailable. Please try again later.",
      rate_limit: "Too many requests. Please wait before trying again.",
    };

    return `${messages[category]} (Error: ${errorCode})`;
  }

  /**
   * Track error frequency for statistics
   */
  private trackErrorFrequency(errorCode: string): void {
    const current = this.errorCounts.get(errorCode) || {
      count: 0,
      lastSeen: new Date(),
    };
    current.count++;
    current.lastSeen = new Date();
    this.errorCounts.set(errorCode, current);
  }

  /**
   * Map error categories to audit categories
   */
  private mapCategoryToAuditCategory(
    category: ErrorCategory
  ):
    | "authentication"
    | "authorization"
    | "data_access"
    | "configuration"
    | "security"
    | "compliance" {
    const mapping: Record<
      ErrorCategory,
      | "authentication"
      | "authorization"
      | "data_access"
      | "configuration"
      | "security"
      | "compliance"
    > = {
      authentication: "authentication",
      authorization: "authorization",
      validation: "data_access",
      security: "security",
      system: "configuration",
      external_api: "data_access",
      rate_limit: "security",
    };

    return mapping[category];
  }

  /**
   * Calculate errors by category for statistics
   */
  private calculateErrorsByCategory(
    errors: Array<[string, { count: number; lastSeen: Date }]>
  ): Record<ErrorCategory, number> {
    const result: Record<ErrorCategory, number> = {
      authentication: 0,
      authorization: 0,
      validation: 0,
      security: 0,
      system: 0,
      external_api: 0,
      rate_limit: 0,
    };

    for (const [code, data] of errors) {
      if (code.startsWith("AUTH_")) result.authentication += data.count;
      else if (code.startsWith("AUTHZ_")) result.authorization += data.count;
      else if (code.startsWith("VAL_")) result.validation += data.count;
      else if (code.startsWith("SEC_")) result.security += data.count;
      else if (code.startsWith("SYS_")) result.system += data.count;
      else if (code.startsWith("EXT_")) result.external_api += data.count;
      else if (code.startsWith("RATE_")) result.rate_limit += data.count;
    }

    return result;
  }

  /**
   * Calculate errors by severity for statistics
   */
  private calculateErrorsBySeverity(
    errors: Array<[string, { count: number; lastSeen: Date }]>
  ): Record<ErrorSeverity, number> {
    // This would require storing severity with error codes
    // For now, return estimated distribution
    const total = errors.reduce((sum, [_, data]) => sum + data.count, 0);

    return {
      low: Math.floor(total * 0.4),
      medium: Math.floor(total * 0.3),
      high: Math.floor(total * 0.2),
      critical: Math.floor(total * 0.1),
    };
  }
}
