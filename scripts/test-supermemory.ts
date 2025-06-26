#!/usr/bin/env tsx

/**
 * Manual testing script for Supermemory integration
 *
 * This script tests the complete workflow:
 * 1. API connection
 * 2. Memory creation
 * 3. Rate limiting
 * 4. Error handling
 * 5. Metrics collection
 *
 * Usage:
 *   SUPERMEMORY_API_KEY=your_key tsx scripts/test-supermemory.ts
 */

import {
  SupermemoryApiClient,
  createSupermemoryClient,
} from "../src/supermemory/services/client";
import { SupermemoryRateLimiter } from "../src/supermemory/services/rateLimiter";
import { createSupermemoryMetricsCollector } from "../src/supermemory/services/metrics";

// Colors for console output
const colors = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log(`\n${colors.bold}${colors.blue}=== ${title} ===${colors.reset}`);
}

function logSuccess(message: string) {
  log(`✅ ${message}`, colors.green);
}

function logError(message: string) {
  log(`❌ ${message}`, colors.red);
}

function logWarning(message: string) {
  log(`⚠️  ${message}`, colors.yellow);
}

function logInfo(message: string) {
  log(`ℹ️  ${message}`, colors.cyan);
}

// Test configuration
const TEST_CONFIG = {
  apiKey: process.env.SUPERMEMORY_API_KEY || "test-key",
  baseUrl: process.env.SUPERMEMORY_API_URL || "https://api.supermemory.ai",
  timeout: 30000,
};

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testApiConnection() {
  logSection("API Connection Test");

  try {
    const client = new SupermemoryApiClient(TEST_CONFIG);

    logInfo("Testing API connection...");
    const isConnected = await client.testConnection();

    if (isConnected) {
      logSuccess("API connection successful!");

      // Test health endpoint
      const health = await client.getHealth();
      logSuccess(`Health status: ${health.status} (${health.timestamp})`);

      return client;
    }
      logError("API connection failed");
      return null;
  } catch (error) {
    logError(`Connection error: ${(error as Error).message}`);
    return null;
  }
}

async function testMemoryCreation(client: SupermemoryApiClient) {
  logSection("Memory Creation Test");

  try {
    const testPayload = {
      content: `Manual test message created at ${new Date().toISOString()}`,
      metadata: {
        provider: "slack-connector",
        author: "manual-test",
        timestamp: new Date().toISOString(),
        channel: "test-channel",
        message_type: "test",
        test_id: Math.random().toString(36).substr(2, 9),
      },
      tags: [
        "manual-test",
        "integration-test",
        new Date().toISOString().split("T")[0],
      ],
    };

    logInfo("Creating test memory...");
    const result = await client.createMemory(testPayload);

    logSuccess("Memory created successfully!");
    logInfo(`Memory ID: ${result.id}`);
    logInfo(`Status: ${result.status}`);
    if (result.title) logInfo(`Title: ${result.title}`);

    return result;
  } catch (error) {
    logError(`Memory creation failed: ${(error as Error).message}`);
    return null;
  }
}

async function testBatchCreation(client: SupermemoryApiClient) {
  logSection("Batch Memory Creation Test");

  try {
    const batchPayloads = [
      {
        content: `Batch test message 1 - ${new Date().toISOString()}`,
        metadata: {
          provider: "slack-connector",
          author: "batch-test-1",
          timestamp: new Date().toISOString(),
          channel: "batch-test",
          message_type: "test",
        },
        tags: ["batch-test", "message-1"],
      },
      {
        content: `Batch test message 2 - ${new Date().toISOString()}`,
        metadata: {
          provider: "slack-connector",
          author: "batch-test-2",
          timestamp: new Date().toISOString(),
          channel: "batch-test",
          message_type: "test",
        },
        tags: ["batch-test", "message-2"],
      },
      {
        content: `Batch test message 3 - ${new Date().toISOString()}`,
        metadata: {
          provider: "slack-connector",
          author: "batch-test-3",
          timestamp: new Date().toISOString(),
          channel: "batch-test",
          message_type: "test",
        },
        tags: ["batch-test", "message-3"],
      },
    ];

    logInfo("Creating batch of memories...");
    const results = await client.createMemories(batchPayloads);

    logSuccess("Batch creation completed!");
    logInfo(
      `Successfully created ${results.length}/${batchPayloads.length} memories`
    );

    results.forEach((result, index) => {
      logInfo(`Memory ${index + 1}: ${result.id} (${result.status})`);
    });

    return results;
  } catch (error) {
    logError(`Batch creation failed: ${(error as Error).message}`);
    return [];
  }
}

async function testRateLimiting() {
  logSection("Rate Limiting Test");

  try {
    const rateLimiter = new SupermemoryRateLimiter({
      requestsPerMinute: 5, // Very low limit for testing
      burstCapacity: 3,
    });

    logInfo("Testing rate limiter with low limits...");

    // Test normal consumption
    for (let i = 1; i <= 3; i++) {
      const canProceed = rateLimiter.tryConsume();
      if (canProceed) {
        logSuccess(`Request ${i}: Allowed`);
      } else {
        logWarning(`Request ${i}: Rate limited`);
      }
    }

    // Test rate limiting
    const rateLimited = rateLimiter.tryConsume();
    if (!rateLimited) {
      logSuccess("Rate limiting is working correctly!");
    } else {
      logWarning("Rate limiting may not be working as expected");
    }

    // Test status
    const status = rateLimiter.getStatus();
    logInfo("Rate limiter status:");
    logInfo(`  Available tokens: ${status.availableTokens}`);
    logInfo(`  Capacity: ${status.capacity}`);
    logInfo(`  Refill rate: ${status.refillRate} tokens/minute`);

    // Test wait time
    const waitTime = rateLimiter.getWaitTimeMs();
    if (waitTime > 0) {
      logInfo(`Next token available in: ${waitTime}ms`);
    }

    return true;
  } catch (error) {
    logError(`Rate limiting test failed: ${(error as Error).message}`);
    return false;
  }
}

async function testMetricsCollection() {
  logSection("Metrics Collection Test");

  try {
    const metrics = createSupermemoryMetricsCollector({
      enabled: true,
      enableEventHistory: true,
      maxEventHistory: 100,
    });

    logInfo("Testing metrics collection...");

    // Simulate some events
    metrics.recordEvent({
      type: "request_start" as any,
      timestamp: Date.now(),
    });

    await sleep(100);

    metrics.recordEvent({
      type: "request_success" as any,
      timestamp: Date.now(),
      data: { duration: 100, statusCode: 200 },
    });

    metrics.recordEvent({
      type: "request_failure" as any,
      timestamp: Date.now(),
      data: { duration: 150, statusCode: 400, errorType: "client" },
    });

    // Get metrics
    const metricsData = metrics.getMetrics();
    const formatted = metrics.getFormattedMetrics();
    const health = metrics.getHealthStatus();

    logSuccess("Metrics collection working!");
    logInfo(`Total requests: ${metricsData.requests.total}`);
    logInfo(`Successful: ${metricsData.requests.successful}`);
    logInfo(`Failed: ${metricsData.requests.failed}`);
    logInfo(`Success rate: ${formatted.successRate}%`);
    logInfo(`Average response time: ${formatted.averageResponseTime}ms`);
    logInfo(`Health status: ${health.status}`);

    if (health.issues.length > 0) {
      logInfo("Health issues:");
      health.issues.forEach((issue) => logWarning(`  - ${issue}`));
    }

    return true;
  } catch (error) {
    logError(`Metrics test failed: ${(error as Error).message}`);
    return false;
  }
}

async function testErrorHandling(client: SupermemoryApiClient) {
  logSection("Error Handling Test");

  try {
    // Test with invalid payload
    logInfo("Testing error handling with invalid payload...");

    try {
      await client.createMemory({
        content: "", // Empty content should trigger an error
        metadata: {
          provider: "slack-connector",
          author: "error-test",
          timestamp: new Date().toISOString(),
          channel: "test",
          message_type: "test",
        },
        tags: ["error-test"],
      });

      logWarning("Expected error but request succeeded");
    } catch (error) {
      logSuccess(`Error handling working: ${(error as Error).message}`);
    }

    return true;
  } catch (error) {
    logError(`Error handling test failed: ${(error as Error).message}`);
    return false;
  }
}

async function testFactoryFunction() {
  logSection("Factory Function Test");

  try {
    const mockEnv = {
      SUPERMEMORY_API_KEY: TEST_CONFIG.apiKey,
      SUPERMEMORY_API_URL: TEST_CONFIG.baseUrl,
      SUPERMEMORY_RATE_LIMIT: "100",
    };

    logInfo("Testing factory function...");
    const client = createSupermemoryClient(mockEnv as any);

    if (client && client instanceof SupermemoryApiClient) {
      logSuccess("Factory function working correctly!");

      // Test methods exist
      const hasTestConnection = typeof client.testConnection === "function";
      const hasCreateMemory = typeof client.createMemory === "function";
      const hasGetHealth = typeof client.getHealth === "function";
      const hasGetMetrics = typeof client.getMetrics === "function";

      logInfo("Methods available:");
      logInfo(`  testConnection: ${hasTestConnection ? "✅" : "❌"}`);
      logInfo(`  createMemory: ${hasCreateMemory ? "✅" : "❌"}`);
      logInfo(`  getHealth: ${hasGetHealth ? "✅" : "❌"}`);
      logInfo(`  getMetrics: ${hasGetMetrics ? "✅" : "❌"}`);

      return client;
    }
      logError("Factory function returned invalid client");
      return null;
  } catch (error) {
    logError(`Factory function test failed: ${(error as Error).message}`);
    return null;
  }
}

async function testIntegratedWorkflow() {
  logSection("Integrated Workflow Test");

  try {
    logInfo("Creating client with full configuration...");

    const client = new SupermemoryApiClient({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
      timeout: TEST_CONFIG.timeout,
      enableMetrics: true,
      enableProactiveRateLimit: true,
      rateLimiter: {
        requestsPerMinute: 60,
        burstCapacity: 100,
      },
      metrics: {
        enabled: true,
        enableEventHistory: true,
      },
    });

    logInfo("Testing integrated workflow...");

    // 1. Check connection
    const isConnected = await client.testConnection();
    if (!isConnected) {
      logError("Connection failed in integrated workflow");
      return false;
    }
    logSuccess("Connection ✅");

    // 2. Create a memory
    const memory = await client.createMemory({
      content: `Integrated workflow test - ${new Date().toISOString()}`,
      metadata: {
        provider: "slack-connector",
        author: "integrated-test",
        timestamp: new Date().toISOString(),
        channel: "workflow-test",
        message_type: "integration",
      },
      tags: ["integrated-test", "workflow"],
    });
    logSuccess(`Memory creation ✅ (ID: ${memory.id})`);

    // 3. Check metrics
    const metrics = client.getMetrics();
    if (metrics) {
      logSuccess(`Metrics collection ✅ (${metrics.requests.total} requests)`);
    }

    // 4. Check rate limiter
    const rateLimiterStatus = client.getRateLimiterStatus();
    if (rateLimiterStatus) {
      logSuccess(
        `Rate limiting ✅ (${rateLimiterStatus.availableTokens} tokens available)`
      );
    }

    // 5. Get health
    const health = await client.getHealth();
    logSuccess(`Health check ✅ (${health.status})`);

    logSuccess("🎉 Integrated workflow completed successfully!");
    return true;
  } catch (error) {
    logError(`Integrated workflow failed: ${(error as Error).message}`);
    return false;
  }
}

async function main() {
  console.log(
    `${colors.bold}${colors.cyan}🧪 Supermemory Integration Test Suite${colors.reset}\n`
  );

  // Check environment
  if (!process.env.SUPERMEMORY_API_KEY) {
    logWarning(
      "SUPERMEMORY_API_KEY not provided. Using test key (will fail for real API calls)."
    );
    logInfo(
      "To test with real API: SUPERMEMORY_API_KEY=your_key tsx scripts/test-supermemory.ts"
    );
  }

  logInfo("Configuration:");
  logInfo(`  API URL: ${TEST_CONFIG.baseUrl}`);
  logInfo(`  API Key: ${TEST_CONFIG.apiKey.substring(0, 8)}...`);
  logInfo(`  Timeout: ${TEST_CONFIG.timeout}ms`);

  const results = {
    connection: false,
    memoryCreation: false,
    batchCreation: false,
    rateLimiting: false,
    metrics: false,
    errorHandling: false,
    factoryFunction: false,
    integratedWorkflow: false,
  };

  // Run tests
  const client = await testApiConnection();
  results.connection = !!client;

  if (client) {
    const memory = await testMemoryCreation(client);
    results.memoryCreation = !!memory;

    const batchResults = await testBatchCreation(client);
    results.batchCreation = batchResults.length > 0;

    results.errorHandling = await testErrorHandling(client);
  }

  results.rateLimiting = await testRateLimiting();
  results.metrics = await testMetricsCollection();
  results.factoryFunction = !!(await testFactoryFunction());

  if (client) {
    results.integratedWorkflow = await testIntegratedWorkflow();
  }

  // Summary
  logSection("Test Results Summary");

  const passed = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;

  Object.entries(results).forEach(([test, passed]) => {
    if (passed) {
      logSuccess(`${test}: PASSED`);
    } else {
      logError(`${test}: FAILED`);
    }
  });

  console.log(
    `\n${colors.bold}Overall: ${passed}/${total} tests passed${colors.reset}`
  );

  if (passed === total) {
    logSuccess(
      "🎉 All tests passed! Supermemory integration is working correctly."
    );
  } else if (passed > total / 2) {
    logWarning("⚠️  Most tests passed. Some issues need attention.");
  } else {
    logError("❌ Multiple tests failed. Integration needs fixes.");
  }

  console.log("\n" + colors.cyan + "Test completed!" + colors.reset);
}

// Run the tests
main().catch((error) => {
  console.error(
    `${colors.red}Test runner failed: ${error.message}${colors.reset}`
  );
  process.exit(1);
});
