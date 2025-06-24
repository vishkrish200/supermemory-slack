import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import type { Session, User } from "../db/schema";
import * as schema from "../db/schema";
import { decrypt, encrypt } from "../utils/cipher";
import { SlackApiClient } from "./services/client";
import { MessageTransformerService } from "./services/transformer";
import type {
  SlackEvent,
  SlackEventPayload,
  SlackOAuthResponse,
  SupermemoryPayload,
} from "./types";
import {
  shouldProcessEvent,
  validateSlackEvent,
  verifySlackSignature,
} from "./utils/signature";

const db = (env: Env) => drizzle(env.USERS_DATABASE);

export const slackRouter = new Hono<{
  Bindings: Env;
  Variables: {
    user: User;
    session: Session;
  };
}>()
  // Slack OAuth initiation - now integrates with better-auth session
  .get("/oauth/start", async (c) => {
    const { SLACK_CLIENT_ID, BETTER_AUTH_URL } = c.env;

    if (!SLACK_CLIENT_ID) {
      return c.json({ error: "Slack client ID not configured" }, 500);
    }

    // Generate and store state parameter for CSRF protection
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
      "team:read",
    ].join(",");

    const authUrl = new URL("https://slack.com/oauth/v2/authorize");
    authUrl.searchParams.set("client_id", SLACK_CLIENT_ID);
    authUrl.searchParams.set("scope", scopes);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("user_scope", "");

    // Store state in KV with TTL for security verification
    // Using a 10-minute expiration for OAuth state
    await c.env.STATE_STORE?.put(`oauth_state:${state}`, "valid", {
      expirationTtl: 600,
    });

    return c.redirect(authUrl.toString());
  })

  // Slack OAuth callback - now stores tokens in database
  .get("/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    if (error) {
      return c.json({ error: `OAuth error: ${error}` }, 400);
    }

    if (!code || !state) {
      return c.json({ error: "Authorization code or state not provided" }, 400);
    }

    // Verify state parameter for CSRF protection
    const storedState = await c.env.STATE_STORE?.get(`oauth_state:${state}`);
    if (!storedState || storedState !== "valid") {
      return c.json({ error: "Invalid or expired state parameter" }, 400);
    }

    // Clean up the state
    await c.env.STATE_STORE?.delete(`oauth_state:${state}`);

    try {
      const { SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, BETTER_AUTH_URL, SECRET } =
        c.env;
      const redirectUri = `${BETTER_AUTH_URL}/slack/oauth/callback`;

      const slackClient = new SlackApiClient();
      const oauthResponse = await slackClient.exchangeOAuthCode(
        code,
        SLACK_CLIENT_ID,
        SLACK_CLIENT_SECRET,
        redirectUri
      );

      // Store team and token information in database
      await storeSlackCredentials(oauthResponse, SECRET, c.env);

      return c.json({
        success: true,
        team: oauthResponse.team.name,
        message: "Slack workspace connected successfully!",
        redirect: "/auth/slack/success",
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
    try {
      const teams = await db(c.env)
        .select()
        .from(schema.slackTeam)
        .where(eq(schema.slackTeam.isActive, true))
        .limit(1);

      if (teams.length === 0) {
        return c.json({ error: "No active Slack teams found" }, 404);
      }

      const team = teams[0];
      const tokens = await db(c.env)
        .select()
        .from(schema.slackToken)
        .where(
          and(
            eq(schema.slackToken.teamId, team.id),
            eq(schema.slackToken.isRevoked, false)
          )
        )
        .limit(1);

      if (tokens.length === 0) {
        return c.json({ error: "No active tokens found for team" }, 404);
      }

      const token = tokens[0];
      const decryptedToken = await decrypt(token.accessToken, c.env.SECRET);
      const slackClient = new SlackApiClient(decryptedToken);
      const authTest = await slackClient.testAuth();

      return c.json({
        status: "authenticated",
        team: authTest.team,
        user: authTest.user,
        teamName: team.name,
      });
    } catch (error) {
      return c.json(
        {
          error: "Authentication test failed",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  });

/**
 * Store Slack OAuth credentials in the database
 */
async function storeSlackCredentials(
  oauthResponse: SlackOAuthResponse,
  encryptionSecret: string,
  env: Env
): Promise<void> {
  const dbClient = db(env);

  try {
    // Encrypt the access token before storing
    const encryptedToken = await encrypt(
      oauthResponse.access_token,
      encryptionSecret
    );

    // Store or update team information
    await dbClient
      .insert(schema.slackTeam)
      .values({
        id: oauthResponse.team.id,
        name: oauthResponse.team.name,
        domain: null, // Domain not provided in OAuth response
        enterpriseId: oauthResponse.enterprise?.id || null,
        enterpriseName: oauthResponse.enterprise?.name || null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.slackTeam.id,
        set: {
          name: oauthResponse.team.name,
          domain: null, // Domain not provided in OAuth response
          isActive: true,
          updatedAt: new Date(),
        },
      });

    // Store the access token
    await dbClient.insert(schema.slackToken).values({
      id: crypto.randomUUID(),
      teamId: oauthResponse.team.id,
      slackUserId: oauthResponse.authed_user.id,
      accessToken: encryptedToken,
      tokenType: oauthResponse.token_type || "bearer",
      scope: oauthResponse.scope,
      botUserId: oauthResponse.bot_user_id || null,
      appId: oauthResponse.app_id,
      isRevoked: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(`Stored credentials for team: ${oauthResponse.team.name}`);
  } catch (error) {
    console.error("Error storing Slack credentials:", error);
    throw error;
  }
}

/**
 * Get team's access token from database
 */
async function getTeamAccessToken(
  teamId: string,
  env: Env
): Promise<string | null> {
  try {
    const tokens = await db(env)
      .select()
      .from(schema.slackToken)
      .where(
        and(
          eq(schema.slackToken.teamId, teamId),
          eq(schema.slackToken.isRevoked, false)
        )
      )
      .limit(1);

    if (tokens.length === 0) {
      return null;
    }

    const token = tokens[0];
    return await decrypt(token.accessToken, env.SECRET);
  } catch (error) {
    console.error("Error retrieving team access token:", error);
    return null;
  }
}

/**
 * Get team information from database
 */
async function getTeamInfo(
  teamId: string,
  env: Env
): Promise<{ name: string } | null> {
  try {
    const teams = await db(env)
      .select()
      .from(schema.slackTeam)
      .where(eq(schema.slackTeam.id, teamId))
      .limit(1);

    return teams.length > 0 ? { name: teams[0].name } : null;
  } catch (error) {
    console.error("Error retrieving team info:", error);
    return null;
  }
}

/**
 * Process Slack events asynchronously
 */
async function processSlackEvent(payload: SlackEvent, env: Env): Promise<void> {
  try {
    const event = payload.event;
    const teamId = payload.team_id;

    // Get team's access token from database
    const accessToken = await getTeamAccessToken(teamId, env);

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
    const [channelInfo, userInfo, teamInfo] = await Promise.all([
      event.channel
        ? slackClient.getChannel(event.channel).catch(() => null)
        : null,
      event.user ? slackClient.getUser(event.user).catch(() => null) : null,
      getTeamInfo(teamId, env),
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
      teamInfo?.name,
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
  _teamId: string,
  _slackClient: SlackApiClient,
  _transformer: MessageTransformerService,
  _env: Env
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
