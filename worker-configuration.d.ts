interface Env {
  USERS_DATABASE: D1Database;
  STATE_STORE?: KVNamespace; // For OAuth state management
  BETTER_AUTH_URL: string;
  SECRET: string;
  AUTH_GITHUB_ID: string;
  AUTH_GITHUB_SECRET: string;

  // Slack Configuration
  SLACK_CLIENT_ID: string;
  SLACK_CLIENT_SECRET: string;
  SLACK_SIGNING_SECRET: string;
  SLACK_BOT_TOKEN?: string;
  SLACK_USER_TOKEN?: string;
  SLACK_APP_TOKEN?: string; // App-level token for Socket Mode

  // Supermemory API
  SUPERMEMORY_API_URL: string;
  SUPERMEMORY_API_KEY: string;
}
