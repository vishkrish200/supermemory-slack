# Deployment Configuration

This document outlines the configuration steps required to deploy the Supermemory Slack Connector to Cloudflare Workers.

## Prerequisites

1. **Cloudflare Account** with Workers subscription
2. **Slack App** created in your workspace (see Slack App Setup section)
3. **Supermemory API** access and API key
4. **Wrangler CLI** installed and authenticated

## Environment Variables

### Required Environment Variables

Set these using `wrangler secret put <name>` for production deployment:

```bash
# Core Authentication
wrangler secret put SECRET
# Enter a strong encryption key (32+ characters)

# Slack App Configuration  
wrangler secret put SLACK_CLIENT_ID
# From your Slack app's "Basic Information" page

wrangler secret put SLACK_CLIENT_SECRET  
# From your Slack app's "Basic Information" page

wrangler secret put SLACK_SIGNING_SECRET
# From your Slack app's "Basic Information" page

# Supermemory API
wrangler secret put SUPERMEMORY_API_KEY
# Your Supermemory API key for sending memories
```

### Optional Environment Variables

```bash
# Optional: For testing with specific tokens
wrangler secret put SLACK_BOT_TOKEN
wrangler secret put SLACK_USER_TOKEN

# GitHub OAuth (if using GitHub authentication)
wrangler secret put AUTH_GITHUB_ID
wrangler secret put AUTH_GITHUB_SECRET
```

## Database Configuration

### D1 Database Setup

1. **Create the D1 database:**
   ```bash
   wrangler d1 create supermemory-slack
   ```

2. **Update `wrangler.jsonc`** with the returned database ID:
   ```json
   {
     "d1_databases": [
       {
         "binding": "USERS_DATABASE",
         "database_name": "supermemory-slack",
         "database_id": "your-database-id-here",
         "preview_database_id": "your-database-id-here"
       }
     ]
   }
   ```

3. **Apply database migrations:**
   ```bash
   # For production
   wrangler d1 migrations apply supermemory-slack --remote

   # For local development
   wrangler d1 migrations apply supermemory-slack --local
   ```

### KV Namespace Setup

1. **Create KV namespace for OAuth state:**
   ```bash
   wrangler kv:namespace create "STATE_STORE"
   ```

2. **Update `wrangler.jsonc`** with the returned namespace ID:
   ```json
   {
     "kv_namespaces": [
       {
         "binding": "STATE_STORE",
         "id": "your-kv-namespace-id",
         "preview_id": "your-preview-kv-namespace-id"
       }
     ]
   }
   ```

## Development Setup

1. **Copy environment variables:**
   ```bash
   cp .dev.vars.example .dev.vars
   ```

2. **Fill in your development values in `.dev.vars`:**
   ```bash
   # Edit .dev.vars with your actual values
   nano .dev.vars
   ```

3. **Start local development:**
   ```bash
   npm run dev
   ```

## Production Deployment

1. **Deploy to Cloudflare Workers:**
   ```bash
   npm run deploy
   ```

2. **Set custom domain (optional):**
   ```bash
   wrangler route add "slack.yourdomain.com/*" supermemory-slack-connector
   ```

## Environment-Specific Configuration

The `wrangler.jsonc` includes configurations for different environments:

- **Development**: `http://localhost:8787`
- **Staging**: `https://slack-staging.supermemory.ai`  
- **Production**: `https://slack.supermemory.ai`

Deploy to specific environments:
```bash
# Deploy to staging
wrangler deploy --env staging

# Deploy to production  
wrangler deploy --env production
```

## Slack App Configuration

### Required Slack App Settings

1. **OAuth & Permissions:**
   - Redirect URLs: Add your Worker URL + `/auth/slack/callback`
   - Bot Token Scopes: `channels:read`, `groups:read`, `im:read`, `mpim:read`, `channels:history`, `groups:history`, `im:history`, `mpim:history`

2. **Event Subscriptions:**
   - Request URL: Your Worker URL + `/slack/events`
   - Subscribe to: `message.channels`, `message.groups`, `message.im`, `message.mpim`

3. **Interactivity & Shortcuts:**
   - Request URL: Your Worker URL + `/slack/interactive`

### Slack App Installation

After deployment, teams can install your app by visiting:
```
https://your-worker-url.workers.dev/auth/slack/install
```

## Monitoring and Observability

The configuration enables Cloudflare Workers observability:

- **Real-time logs**: Available in Cloudflare dashboard
- **Analytics**: Request volume, error rates, response times
- **Tracing**: Request flow through your Worker

## Security Considerations

1. **Secrets Management**: All sensitive data is stored as Cloudflare secrets
2. **Request Verification**: Slack request signatures are verified
3. **Token Encryption**: All Slack tokens are encrypted before database storage
4. **Rate Limiting**: Built-in rate limiting prevents API abuse
5. **Environment Isolation**: Separate configurations for dev/staging/production

## Troubleshooting

### Common Issues

1. **Database Connection Errors**: Verify D1 database ID in wrangler.jsonc
2. **KV Storage Errors**: Confirm KV namespace IDs are correct
3. **Slack Verification Failures**: Check SLACK_SIGNING_SECRET is set correctly
4. **API Rate Limits**: Monitor Cloudflare dashboard for rate limit hits

### Debugging

1. **Local Development:**
   ```bash
   wrangler dev --local
   wrangler tail --local
   ```

2. **Production Debugging:**
   ```bash
   wrangler tail
   ```

3. **Database Inspection:**
   ```bash
   wrangler d1 execute supermemory-slack --command "SELECT * FROM slackTeam;"
   ```

For additional support, check the Cloudflare Workers documentation or contact support. 