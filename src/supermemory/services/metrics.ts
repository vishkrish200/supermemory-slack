/**
 * Metrics data structure for tracking API performance
 */
export interface SupermemoryMetrics {
  // Request counters
  requests: {
    total: number;
    successful: number;
    failed: number;
    retries: number;
    rateLimited: number;
  };

  // Response time statistics (in milliseconds)
  responseTime: {
    total: number; // Sum for calculating average
    count: number; // Number of recorded times
    min: number;
    max: number;
    average: number;
  };

  // Batch processing statistics
  batches: {
    total: number;
    totalItems: number;
    averageSize: number;
    successful: number;
    failed: number;
  };

  // Rate limiting statistics
  rateLimiting: {
    tokensConsumed: number;
    waitTime: number; // Total time spent waiting (ms)
    waitEvents: number; // Number of times we had to wait
  };

  // Error breakdown
  errors: {
    client: number; // 4xx errors
    server: number; // 5xx errors
    network: number; // Network/timeout errors
    unknown: number; // Other errors
  };

  // Time-based tracking
  timestamps: {
    firstRequest: number;
    lastRequest: number;
    lastReset: number;
  };
}

/**
 * Metrics event types for tracking different operations
 */
export enum MetricsEventType {
  REQUEST_START = "request_start",
  REQUEST_SUCCESS = "request_success",
  REQUEST_FAILURE = "request_failure",
  REQUEST_RETRY = "request_retry",
  RATE_LIMITED = "rate_limited",
  RATE_LIMIT_WAIT = "rate_limit_wait",
  BATCH_START = "batch_start",
  BATCH_SUCCESS = "batch_success",
  BATCH_FAILURE = "batch_failure",
}

/**
 * Event data for different metric events
 */
export interface MetricsEvent {
  type: MetricsEventType;
  timestamp: number;
  data?: {
    duration?: number; // Response time in ms
    statusCode?: number;
    errorType?: "client" | "server" | "network" | "unknown";
    batchSize?: number;
    waitTime?: number;
    retryAttempt?: number;
  };
}

/**
 * Configuration for metrics collection
 */
export interface SupermemoryMetricsConfig {
  enabled: boolean;
  resetInterval?: number; // Auto-reset interval in milliseconds
  maxEventHistory?: number; // Max events to keep in memory
  enableEventHistory?: boolean; // Whether to keep detailed event history
}

/**
 * Supermemory API metrics collector
 * Tracks performance, errors, and usage statistics for monitoring and alerting
 */
export class SupermemoryMetricsCollector {
  private metrics: SupermemoryMetrics;
  private eventHistory: MetricsEvent[] = [];
  private config: SupermemoryMetricsConfig;
  private resetTimer?: NodeJS.Timeout;

  constructor(config: SupermemoryMetricsConfig = { enabled: true }) {
    this.config = {
      maxEventHistory: 1000,
      enableEventHistory: true,
      ...config,
    };

    this.metrics = this.createEmptyMetrics();

    // Set up auto-reset if configured
    if (this.config.resetInterval && this.config.resetInterval > 0) {
      this.resetTimer = setInterval(() => {
        this.reset();
      }, this.config.resetInterval);
    }
  }

  /**
   * Record a metrics event
   */
  recordEvent(event: MetricsEvent): void {
    if (!this.config.enabled) return;

    // Update timestamps
    this.metrics.timestamps.lastRequest = event.timestamp;
    if (this.metrics.timestamps.firstRequest === 0) {
      this.metrics.timestamps.firstRequest = event.timestamp;
    }

    // Process the event based on type
    switch (event.type) {
      case MetricsEventType.REQUEST_START:
        this.metrics.requests.total++;
        break;

      case MetricsEventType.REQUEST_SUCCESS:
        this.metrics.requests.successful++;
        this.recordResponseTime(event.data?.duration || 0);
        break;

      case MetricsEventType.REQUEST_FAILURE:
        this.metrics.requests.failed++;
        this.recordError(event.data?.errorType || "unknown");
        this.recordResponseTime(event.data?.duration || 0);
        break;

      case MetricsEventType.REQUEST_RETRY:
        this.metrics.requests.retries++;
        break;

      case MetricsEventType.RATE_LIMITED:
        this.metrics.requests.rateLimited++;
        break;

      case MetricsEventType.RATE_LIMIT_WAIT:
        this.metrics.rateLimiting.waitEvents++;
        this.metrics.rateLimiting.waitTime += event.data?.waitTime || 0;
        break;

      case MetricsEventType.BATCH_START:
        this.metrics.batches.total++;
        if (event.data?.batchSize) {
          this.metrics.batches.totalItems += event.data.batchSize;
          this.updateBatchAverage();
        }
        break;

      case MetricsEventType.BATCH_SUCCESS:
        this.metrics.batches.successful++;
        break;

      case MetricsEventType.BATCH_FAILURE:
        this.metrics.batches.failed++;
        break;
    }

    // Add to event history if enabled
    if (this.config.enableEventHistory) {
      this.eventHistory.push(event);

      // Trim history if it exceeds max size
      if (
        this.config.maxEventHistory &&
        this.eventHistory.length > this.config.maxEventHistory
      ) {
        this.eventHistory = this.eventHistory.slice(
          -this.config.maxEventHistory
        );
      }
    }
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics(): SupermemoryMetrics {
    return { ...this.metrics };
  }

  /**
   * Get metrics formatted for monitoring/alerting
   */
  getFormattedMetrics(): {
    summary: string;
    successRate: number;
    averageResponseTime: number;
    errorRate: number;
    rateLimitRate: number;
  } {
    const total = this.metrics.requests.total;
    const successful = this.metrics.requests.successful;
    const failed = this.metrics.requests.failed;
    const rateLimited = this.metrics.requests.rateLimited;

    const successRate = total > 0 ? (successful / total) * 100 : 0;
    const errorRate = total > 0 ? (failed / total) * 100 : 0;
    const rateLimitRate = total > 0 ? (rateLimited / total) * 100 : 0;

    return {
      summary: `${total} requests, ${successful} successful, ${failed} failed, ${rateLimited} rate limited`,
      successRate: Number.parseFloat(successRate.toFixed(2)),
      averageResponseTime: this.metrics.responseTime.average,
      errorRate: Number.parseFloat(errorRate.toFixed(2)),
      rateLimitRate: Number.parseFloat(rateLimitRate.toFixed(2)),
    };
  }

  /**
   * Get recent event history
   */
  getEventHistory(limit?: number): MetricsEvent[] {
    if (!this.config.enableEventHistory) return [];

    if (limit && limit < this.eventHistory.length) {
      return this.eventHistory.slice(-limit);
    }

    return [...this.eventHistory];
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics = this.createEmptyMetrics();
    this.eventHistory = [];
  }

  /**
   * Check if metrics indicate potential issues
   */
  getHealthStatus(): {
    status: "healthy" | "warning" | "critical";
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];

    const formatted = this.getFormattedMetrics();
    const total = this.metrics.requests.total;

    // Only analyze if we have meaningful data
    if (total < 10) {
      return {
        status: "healthy",
        issues: ["Insufficient data for health analysis"],
        recommendations: ["Continue monitoring"],
      };
    }

    // Check error rate
    if (formatted.errorRate > 20) {
      issues.push(`High error rate: ${formatted.errorRate}%`);
      recommendations.push(
        "Investigate API errors and implement better error handling"
      );
    } else if (formatted.errorRate > 10) {
      issues.push(`Elevated error rate: ${formatted.errorRate}%`);
      recommendations.push("Monitor error patterns closely");
    }

    // Check rate limiting
    if (formatted.rateLimitRate > 10) {
      issues.push(`High rate limiting: ${formatted.rateLimitRate}%`);
      recommendations.push(
        "Consider implementing more aggressive rate limiting or request batching"
      );
    }

    // Check response time
    if (formatted.averageResponseTime > 5000) {
      issues.push(
        `Slow response times: ${formatted.averageResponseTime}ms average`
      );
      recommendations.push(
        "Investigate API latency and consider timeout adjustments"
      );
    }

    // Check retry rate
    const retryRate =
      total > 0 ? (this.metrics.requests.retries / total) * 100 : 0;
    if (retryRate > 15) {
      issues.push(`High retry rate: ${retryRate.toFixed(2)}%`);
      recommendations.push("Investigate underlying causes of request failures");
    }

    // Determine status
    let status: "healthy" | "warning" | "critical" = "healthy";
    if (formatted.errorRate > 20 || formatted.rateLimitRate > 15) {
      status = "critical";
    } else if (issues.length > 0) {
      status = "warning";
    }

    return { status, issues, recommendations };
  }

  /**
   * Get rate limiting statistics
   */
  getRateLimitingStats(): {
    tokensConsumed: number;
    averageWaitTime: number;
    waitEventRate: number;
  } {
    const total = this.metrics.requests.total;
    const waitEvents = this.metrics.rateLimiting.waitEvents;

    return {
      tokensConsumed: this.metrics.rateLimiting.tokensConsumed,
      averageWaitTime:
        waitEvents > 0 ? this.metrics.rateLimiting.waitTime / waitEvents : 0,
      waitEventRate: total > 0 ? (waitEvents / total) * 100 : 0,
    };
  }

  /**
   * Export metrics for external monitoring systems
   */
  exportMetrics(format: "json" | "prometheus" = "json"): string {
    if (format === "prometheus") {
      return this.exportPrometheusMetrics();
    }

    return JSON.stringify(
      {
        metrics: this.getMetrics(),
        formatted: this.getFormattedMetrics(),
        health: this.getHealthStatus(),
        rateLimiting: this.getRateLimitingStats(),
        timestamp: Date.now(),
      },
      null,
      2
    );
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.resetTimer) {
      clearInterval(this.resetTimer);
    }
  }

  /**
   * Record response time and update statistics
   */
  private recordResponseTime(duration: number): void {
    if (duration <= 0) return;

    this.metrics.responseTime.total += duration;
    this.metrics.responseTime.count++;
    this.metrics.responseTime.average =
      this.metrics.responseTime.total / this.metrics.responseTime.count;

    if (
      duration < this.metrics.responseTime.min ||
      this.metrics.responseTime.min === 0
    ) {
      this.metrics.responseTime.min = duration;
    }

    if (duration > this.metrics.responseTime.max) {
      this.metrics.responseTime.max = duration;
    }
  }

  /**
   * Record error by type
   */
  private recordError(
    errorType: "client" | "server" | "network" | "unknown"
  ): void {
    this.metrics.errors[errorType]++;
  }

  /**
   * Update batch size average
   */
  private updateBatchAverage(): void {
    if (this.metrics.batches.total > 0) {
      this.metrics.batches.averageSize =
        this.metrics.batches.totalItems / this.metrics.batches.total;
    }
  }

  /**
   * Create empty metrics structure
   */
  private createEmptyMetrics(): SupermemoryMetrics {
    return {
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        retries: 0,
        rateLimited: 0,
      },
      responseTime: {
        total: 0,
        count: 0,
        min: 0,
        max: 0,
        average: 0,
      },
      batches: {
        total: 0,
        totalItems: 0,
        averageSize: 0,
        successful: 0,
        failed: 0,
      },
      rateLimiting: {
        tokensConsumed: 0,
        waitTime: 0,
        waitEvents: 0,
      },
      errors: {
        client: 0,
        server: 0,
        network: 0,
        unknown: 0,
      },
      timestamps: {
        firstRequest: 0,
        lastRequest: 0,
        lastReset: Date.now(),
      },
    };
  }

  /**
   * Export metrics in Prometheus format
   */
  private exportPrometheusMetrics(): string {
    const metrics = this.metrics;
    const timestamp = Date.now();

    return `
# HELP supermemory_requests_total Total number of requests made to Supermemory API
# TYPE supermemory_requests_total counter
supermemory_requests_total ${metrics.requests.total} ${timestamp}

# HELP supermemory_requests_successful Total number of successful requests
# TYPE supermemory_requests_successful counter  
supermemory_requests_successful ${metrics.requests.successful} ${timestamp}

# HELP supermemory_requests_failed Total number of failed requests
# TYPE supermemory_requests_failed counter
supermemory_requests_failed ${metrics.requests.failed} ${timestamp}

# HELP supermemory_response_time_average Average response time in milliseconds
# TYPE supermemory_response_time_average gauge
supermemory_response_time_average ${metrics.responseTime.average} ${timestamp}

# HELP supermemory_batches_total Total number of batch operations
# TYPE supermemory_batches_total counter
supermemory_batches_total ${metrics.batches.total} ${timestamp}

# HELP supermemory_rate_limit_events Total number of rate limit wait events
# TYPE supermemory_rate_limit_events counter
supermemory_rate_limit_events ${metrics.rateLimiting.waitEvents} ${timestamp}
`.trim();
  }
}

/**
 * Factory function to create metrics collector with default configuration
 */
export function createSupermemoryMetricsCollector(
  config: Partial<SupermemoryMetricsConfig> = {}
): SupermemoryMetricsCollector {
  return new SupermemoryMetricsCollector({
    enabled: true,
    resetInterval: 0, // No auto-reset by default
    maxEventHistory: 1000,
    enableEventHistory: true,
    ...config,
  });
}

/**
 * Global metrics collector instance
 */
let globalMetricsCollector: SupermemoryMetricsCollector | null = null;

/**
 * Get or create the global metrics collector
 */
export function getGlobalSupermemoryMetrics(): SupermemoryMetricsCollector {
  if (!globalMetricsCollector) {
    globalMetricsCollector = createSupermemoryMetricsCollector();
  }
  return globalMetricsCollector;
}
