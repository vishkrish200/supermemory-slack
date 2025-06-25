/**
 * Slack Socket Mode Client
 *
 * Provides WebSocket-based event handling as an alternative to HTTP Events API.
 * Primarily for development environments or scenarios where HTTP webhooks aren't feasible.
 *
 * Note: In Cloudflare Workers, persistent WebSocket connections have limitations.
 * This implementation is designed for use with Durable Objects or external WebSocket servers.
 */

export interface SocketModeMessage {
  envelope_id?: string;
  type: string;
  accepts_response_payload?: boolean;
  payload?: any;
  retry_attempt?: number;
  retry_reason?: string;
}

export interface SocketModeConfig {
  appToken: string; // App-level token (starts with xapp-)
  logger?: (level: string, message: string, ...args: any[]) => void;
  autoReconnect?: boolean;
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Simplified Socket Mode Client for Reference
 *
 * Note: This is a basic implementation that may require adaptation
 * for specific environments like Cloudflare Workers.
 */
export class SlackSocketModeClient {
  private config: SocketModeConfig;
  private isConnected = false;
  private eventHandlers: Map<string, (payload: any) => Promise<void>> =
    new Map();

  constructor(config: SocketModeConfig) {
    this.config = {
      autoReconnect: true,
      maxRetries: 5,
      retryDelay: 1000,
      logger: console.log,
      ...config,
    };
  }

  /**
   * Start the Socket Mode connection
   * Note: This is a placeholder implementation
   */
  async start(): Promise<void> {
    this.log("info", "Socket Mode start requested");
    this.log("warn", "Socket Mode has limited support in Cloudflare Workers");
    this.log(
      "info",
      "Consider using HTTP Events API for production deployments"
    );

    // Simulate connection for development
    this.isConnected = true;
    this.log("info", "Socket Mode client started (development mode)");
  }

  /**
   * Stop the Socket Mode connection
   */
  async stop(): Promise<void> {
    this.isConnected = false;
    this.log("info", "Socket Mode client stopped");
  }

  /**
   * Register an event handler for specific event types
   */
  onEvent(eventType: string, handler: (payload: any) => Promise<void>): void {
    this.eventHandlers.set(eventType, handler);
    this.log("debug", `Registered handler for event type: ${eventType}`);
  }

  /**
   * Remove an event handler
   */
  removeEventHandler(eventType: string): void {
    this.eventHandlers.delete(eventType);
    this.log("debug", `Removed handler for event type: ${eventType}`);
  }

  /**
   * Get WebSocket URL from Slack API
   */
  async getWebSocketUrl(): Promise<string> {
    const response = await fetch(
      "https://slack.com/api/apps.connections.open",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.appToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to get WebSocket URL: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as {
      ok: boolean;
      error?: string;
      url?: string;
    };

    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }

    return data.url!;
  }

  /**
   * Process a Socket Mode message (for external implementations)
   */
  async processMessage(message: SocketModeMessage): Promise<void> {
    try {
      this.log("debug", "Processing Socket Mode message:", message.type);

      switch (message.type) {
        case "hello":
          this.log("info", "Received hello message, Socket Mode ready");
          break;

        case "events_api":
          await this.handleEventsApi(message);
          break;

        case "interactive":
          await this.handleInteractive(message);
          break;

        case "slash_commands":
          await this.handleSlashCommand(message);
          break;

        default:
          this.log("warn", "Unknown message type:", message.type);
      }
    } catch (error) {
      this.log("error", "Error processing Socket Mode message:", error);
    }
  }

  /**
   * Handle Events API messages
   */
  private async handleEventsApi(message: SocketModeMessage): Promise<void> {
    if (!message.payload) {
      this.log("warn", "Events API message missing payload");
      return;
    }

    try {
      const eventHandler = this.eventHandlers.get("events_api");
      if (eventHandler) {
        await eventHandler(message.payload);
      } else {
        this.log("debug", "No handler registered for events_api");
      }
    } catch (error) {
      this.log("error", "Error handling Events API message:", error);
    }
  }

  /**
   * Handle interactive component messages
   */
  private async handleInteractive(message: SocketModeMessage): Promise<void> {
    try {
      const interactiveHandler = this.eventHandlers.get("interactive");
      if (interactiveHandler) {
        await interactiveHandler(message.payload);
      }
    } catch (error) {
      this.log("error", "Error handling interactive message:", error);
    }
  }

  /**
   * Handle slash command messages
   */
  private async handleSlashCommand(message: SocketModeMessage): Promise<void> {
    try {
      const slashHandler = this.eventHandlers.get("slash_commands");
      if (slashHandler) {
        await slashHandler(message.payload);
      }
    } catch (error) {
      this.log("error", "Error handling slash command:", error);
    }
  }

  /**
   * Utility logging method
   */
  private log(level: string, message: string, ...args: any[]): void {
    if (this.config.logger) {
      this.config.logger(level, `[SocketMode] ${message}`, ...args);
    }
  }

  /**
   * Get connection status
   */
  get connected(): boolean {
    return this.isConnected;
  }
}

/**
 * Factory function to create a Socket Mode client for development
 */
export async function createSocketModeClient(
  appToken: string,
  env: Env
): Promise<SlackSocketModeClient> {
  const client = new SlackSocketModeClient({
    appToken,
    logger: (level: string, message: string, ...args: any[]) => {
      const logMethod =
        level === "error"
          ? console.error
          : level === "warn"
          ? console.warn
          : level === "debug"
          ? console.debug
          : console.log;
      logMethod(`[SocketMode] ${message}`, ...args);
    },
    autoReconnect: true,
    maxRetries: 3,
    retryDelay: 2000,
  });

  // Register default event handler for Events API
  client.onEvent("events_api", async (payload) => {
    // Process events using the existing HTTP Events API logic
    // Import the existing event processing function
    try {
      // Note: This would need to be adapted based on your specific implementation
      console.log("[SocketMode] Would process event:", payload.event?.type);
    } catch (error) {
      console.error("[SocketMode] Error processing event:", error);
    }
  });

  return client;
}

/**
 * Utility function to check Socket Mode availability
 */
export function checkSocketModeSupport(env: Env): {
  supported: boolean;
  reason?: string;
  recommendations: string[];
} {
  const appToken = env.SLACK_APP_TOKEN;

  if (!appToken) {
    return {
      supported: false,
      reason: "SLACK_APP_TOKEN not configured",
      recommendations: [
        "Add SLACK_APP_TOKEN to your environment variables",
        "Generate an app-level token in your Slack app settings",
        'Ensure the token starts with "xapp-"',
      ],
    };
  }

  if (!appToken.startsWith("xapp-")) {
    return {
      supported: false,
      reason: "Invalid app token format",
      recommendations: [
        'App-level tokens must start with "xapp-"',
        "Generate a new app-level token in your Slack app settings",
        'Do not use bot tokens (starting with "xoxb-") for Socket Mode',
      ],
    };
  }

  // Check environment capabilities
  if (typeof WebSocket === "undefined") {
    return {
      supported: false,
      reason: "WebSocket not available in this environment",
      recommendations: [
        "Use HTTP Events API instead (already implemented)",
        "Consider Cloudflare Durable Objects for persistent connections",
        "Deploy to an environment with WebSocket support for development",
      ],
    };
  }

  return {
    supported: true,
    recommendations: [
      "Socket Mode is primarily for development",
      "Use HTTP Events API for production deployments",
      "Ensure your firewall allows WebSocket connections",
    ],
  };
}

/**
 * Development utility to test Socket Mode setup
 */
export async function testSocketModeSetup(env: Env): Promise<void> {
  console.log("🔍 Testing Socket Mode setup...\n");

  const support = checkSocketModeSupport(env);

  console.log("📋 Socket Mode Support Check:");
  console.log(`   Supported: ${support.supported ? "✅" : "❌"}`);

  if (support.reason) {
    console.log(`   Reason: ${support.reason}`);
  }

  console.log("\n💡 Recommendations:");
  support.recommendations.forEach((rec) => {
    console.log(`   • ${rec}`);
  });

  if (support.supported && env.SLACK_APP_TOKEN) {
    try {
      const client = await createSocketModeClient(env.SLACK_APP_TOKEN, env);
      const wsUrl = await client.getWebSocketUrl();
      console.log(
        `\n✅ Successfully retrieved WebSocket URL: ${wsUrl.substring(
          0,
          50
        )}...`
      );
    } catch (error) {
      console.log(`\n❌ Failed to get WebSocket URL: ${error}`);
    }
  }

  console.log("\n📌 Note: HTTP Events API is recommended for production use");
  console.log("   Your HTTP Events API endpoint: /slack/events");
}
