import { Hono } from "hono";
import type { User, Session } from "../db/schema";
import {
  verifySlackSignature,
  validateSlackEvent,
  shouldProcessEvent,
} from "./utils/signature";
import { SlackApiClient } from "./services/client";
import { MessageTransformerService } from "./services/transformer";
import type {
  SlackEvent,
  SlackEventPayload,
  SupermemoryPayload,
} from "./types";

export const slackRouter = new Hono<{
  Bindings: Env;
  Variables: {
    user: User;
    session: Session;
  };
}>()
  // Slack OAuth initiation
  .get("/oauth/start", async (c) => {
    const { SLACK_CLIENT_ID, BETTER_AUTH_URL } = c.env;

    if (!SLACK_CLIENT_ID) {
      return c.json({ error: "Slack client ID not configured" }, 500);
    }

    const state = crypto.randomUUID();
    const redirectUri = `${BETTER_AUTH_URL}/slack/oauth/callback`;

    const scopes = [
      "channels:history",
      "groups:history",
      "im:history",
      "files:read",
      "channels:read",
      "groups:read",
      "users:read",
    ].join(",");

    const authUrl = new URL("https://slack.com/oauth/v2/authorize");
    authUrl.searchParams.set("client_id", SLACK_CLIENT_ID);
    authUrl.searchParams.set("scope", scopes);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("user_scope", "");

    // Store state in session or KV for verification
    // TODO: Implement state storage for security

    return c.redirect(authUrl.toString());
  })

  // Slack OAuth callback
  .get("/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const _state = c.req.query("state");
    const error = c.req.query("error");

    if (error) {
      return c.json({ error: `OAuth error: ${error}` }, 400);
    }

    if (!code) {
      return c.json({ error: "Authorization code not provided" }, 400);
    }

    // TODO: Verify state parameter for security

    try {
      const { SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, BETTER_AUTH_URL } = c.env;
      const redirectUri = `${BETTER_AUTH_URL}/slack/oauth/callback`;

      const slackClient = new SlackApiClient();
      const oauthResponse = await slackClient.exchangeOAuthCode(
        code,
        SLACK_CLIENT_ID,
        SLACK_CLIENT_SECRET,
        redirectUri
      );

      // TODO: Store tokens securely in database with encryption
      console.log("OAuth successful for team:", oauthResponse.team.name);

      return c.json({
        success: true,
        team: oauthResponse.team.name,
        message: "Slack workspace connected successfully!",
      });
    } catch (error) {
      console.error("OAuth callback error:", error);
      return c.json(
        {
          error: "Failed to complete OAuth flow",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  })

  // Slack Events API endpoint
  .post("/events", async (c) => {
    const { SLACK_SIGNING_SECRET } = c.env;

    if (!SLACK_SIGNING_SECRET) {
      return c.json({ error: "Slack signing secret not configured" }, 500);
    }

    // Clone the request for signature verification
    const requestClone = c.req.raw.clone();

    try {
      // Verify the request signature
      const isValidSignature = await verifySlackSignature(
        requestClone,
        SLACK_SIGNING_SECRET
      );

      if (!isValidSignature) {
        console.warn("Invalid Slack signature received");
        return c.json({ error: "Invalid signature" }, 401);
      }

      const payload = await c.req.json();

      // Validate the event payload
      if (!validateSlackEvent(payload)) {
        return c.json({ error: "Invalid event payload" }, 400);
      }

      // Handle URL verification challenge
      if (payload.type === "url_verification") {
        const challengePayload = payload as unknown as { challenge: string };
        return c.json({ challenge: challengePayload.challenge });
      }

      // Handle event callbacks
      if (payload.type === "event_callback") {
        const event = payload.event;

        // Check if we should process this event
        if (!shouldProcessEvent(event)) {
          return c.json({ status: "ignored" });
        }

        // Process the event asynchronously
        c.executionCtx.waitUntil(processSlackEvent(payload, c.env));

        return c.json({ status: "received" });
      }

      return c.json({ status: "unknown_event_type" });
    } catch (error) {
      console.error("Slack events error:", error);
      return c.json(
        {
          error: "Failed to process event",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  })

  // Health check for Slack integration
  .get("/health", async (c) => {
    return c.json({
      status: "ok",
      service: "slack-connector",
      timestamp: new Date().toISOString(),
    });
  })

  // Test endpoint for development
  .get("/test", async (c) => {
    const { SLACK_BOT_TOKEN } = c.env;

    if (!SLACK_BOT_TOKEN) {
      return c.json({ error: "Bot token not configured" }, 500);
    }

    try {
      const slackClient = new SlackApiClient(SLACK_BOT_TOKEN);
      const authTest = await slackClient.testAuth();

      return c.json({
        status: "authenticated",
        team: authTest.team,
        user: authTest.user,
      });
    } catch (error) {
      return c.json(
        {
          error: "Authentication failed",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  });

/**
 * Process Slack events asynchronously
 */
async function processSlackEvent(payload: SlackEvent, env: Env): Promise<void> {
  try {
    const event = payload.event;
    const teamId = payload.team_id;

    // TODO: Get team's access token from database
    const accessToken = env.SLACK_BOT_TOKEN; // Temporary fallback

    if (!accessToken) {
      console.error("No access token available for team:", teamId);
      return;
    }

    const slackClient = new SlackApiClient(accessToken);
    const transformer = new MessageTransformerService();

    // Handle different event types
    switch (event.type) {
      case "message":
        await handleMessageEvent(event, teamId, slackClient, transformer, env);
        break;

      case "file_shared":
        await handleFileSharedEvent(
          event,
          teamId,
          slackClient,
          transformer,
          env
        );
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    console.error("Error processing Slack event:", error);
  }
}

/**
 * Handle message events
 */
async function handleMessageEvent(
  event: SlackEventPayload,
  teamId: string,
  slackClient: SlackApiClient,
  transformer: MessageTransformerService,
  env: Env
): Promise<void> {
  try {
    // Get additional context
    const [channelInfo, userInfo] = await Promise.all([
      event.channel
        ? slackClient.getChannel(event.channel).catch(() => null)
        : null,
      event.user ? slackClient.getUser(event.user).catch(() => null) : null,
    ]);

    // Transform the message
    const payload = transformer.transformMessage(
      event as SlackEventPayload & {
        ts: string;
        text: string;
        channel: string;
        user: string;
      },
      teamId,
      undefined, // Team name - TODO: get from database
      channelInfo?.name,
      userInfo?.real_name || userInfo?.name
    );

    // Send to Supermemory
    await sendToSupermemory(payload, env);

    console.log(`Processed message from ${event.user} in ${event.channel}`);
  } catch (error) {
    console.error("Error handling message event:", error);
  }
}

/**
 * Handle file shared events
 */
async function handleFileSharedEvent(
  event: SlackEventPayload,
  teamId: string,
  slackClient: SlackApiClient,
  transformer: MessageTransformerService,
  env: Env
): Promise<void> {
  // TODO: Implement file handling
  console.log("File shared event received:", event);
}

/**
 * Send transformed data to Supermemory API
 */
async function sendToSupermemory(
  payload: SupermemoryPayload,
  env: Env
): Promise<void> {
  const { SUPERMEMORY_API_URL, SUPERMEMORY_API_KEY } = env;

  if (!SUPERMEMORY_API_URL || !SUPERMEMORY_API_KEY) {
    console.error("Supermemory API configuration missing");
    return;
  }

  try {
    const response = await fetch(`${SUPERMEMORY_API_URL}/v3/memories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPERMEMORY_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Supermemory API error: ${response.status} ${await response.text()}`
      );
    }

    const result = await response.json();
    console.log("Successfully sent to Supermemory:", result);
  } catch (error) {
    console.error("Error sending to Supermemory:", error);
    throw error;
  }
}
