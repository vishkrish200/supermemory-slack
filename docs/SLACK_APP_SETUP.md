# Slack App Setup Guide

Complete guide for creating and configuring a Slack app for the Supermemory Connector using the app manifest.

## Prerequisites

Before starting, ensure you have:

- ✅ **Slack workspace** with admin permissions
- ✅ **Deployed Cloudflare Worker** (see [DEPLOYMENT.md](DEPLOYMENT.md))
- ✅ **Generated app manifest** for your environment

## Generate App Manifest

First, generate the appropriate manifest for your deployment:

```bash
# For local development
npm run manifest:generate -- --env development

# For staging deployment  
npm run manifest:generate -- --env staging

# For production deployment
npm run manifest:generate -- --env production

# For custom domain
npm run manifest:generate -- --custom-url https://your-domain.com
```

This creates environment-specific files:
- `slack-app-manifest-dev.yaml` (development)
- `slack-app-manifest-staging.yaml` (staging)  
- `slack-app-manifest-prod.yaml` (production)
- `slack-app-manifest-custom.yaml` (custom URL)

## Step 1: Create New Slack App

1. **Visit Slack API Console**
   - Go to [https://api.slack.com/apps](https://api.slack.com/apps)
   - Sign in with your Slack workspace admin account

2. **Start App Creation**
   - Click **"Create New App"** button
   - Select **"From an app manifest"** option
   
   > 💡 **Why use a manifest?** App manifests ensure consistent configuration and reduce manual setup errors.

3. **Choose Workspace**
   - Select the workspace where you want to install the connector
   - Click **"Next"**

4. **Import Manifest**
   - **Method 1: Copy & Paste**
     - Open your generated manifest file (e.g., `slack-app-manifest-prod.yaml`)
     - Copy the entire contents
     - Paste into the manifest editor
   
   - **Method 2: Upload File**
     - Click **"Upload a file"**
     - Select your generated manifest file
   
   - Click **"Next"** to review the configuration

5. **Review App Configuration**
   
   The manifest will configure:
   
   **📝 Basic Information:**
   - App Name: "Supermemory Connector"
   - Description: "Sync Slack conversations to Supermemory for AI-powered knowledge management"
   - Background Color: #2c2d30
   
   **🤖 Features Enabled:**
   - ✅ Bots (with display name "Supermemory Bot")
   - ✅ Slash Commands (`/supermemory`)
   - ✅ Shortcuts (Sync Channel History)
   - ✅ Event Subscriptions
   - ✅ Interactive Components
   
   **🔐 OAuth Scopes:**
   - `channels:read`, `groups:read`, `im:read`, `mpim:read` - List channels/DMs
   - `channels:history`, `groups:history`, `im:history`, `mpim:history` - Read message history
   - `files:read` - Access shared files
   - `users:read`, `users:read.email`, `team:read` - User and team information
   - `chat:write`, `commands` - Bot functionality
   
   **📡 Event Subscriptions:**
   - Message events: `message.channels`, `message.groups`, `message.im`, `message.mpim`
   - File events: `file_shared`, `file_public`
   - Channel events: `channel_created`, `channel_rename`, `channel_archive`, `channel_unarchive`
   - Team events: `team_join`, `user_change`

6. **Create the App**
   - Review all settings carefully
   - Click **"Create"** to finalize the app creation

## Step 2: Configure App Credentials

After creating the app, you'll need to collect credentials for your Worker:

### 2.1 Collect Basic Information

1. **Navigate to Basic Information**
   - In your app dashboard, go to **"Settings" → "Basic Information"**

2. **Copy App Credentials**
   ```bash
   # Note these values - you'll need them for Wrangler secrets:
   
   App ID: A01234567890           # Found in "App-Level Information"
   Client ID: 1234567890.123      # Found in "App Credentials"  
   Client Secret: abc123...       # Click "Show" to reveal
   Signing Secret: def456...      # Click "Show" to reveal
   ```

### 2.2 Set Cloudflare Worker Secrets

Configure the credentials in your Worker environment:

```bash
# Required: Core app credentials
wrangler secret put SLACK_CLIENT_ID
# Enter: 1234567890.123

wrangler secret put SLACK_CLIENT_SECRET  
# Enter: abc123...

wrangler secret put SLACK_SIGNING_SECRET
# Enter: def456...

# Required: Encryption key for token storage
wrangler secret put SECRET
# Enter: a-strong-32-character-encryption-key-here

# Required: Supermemory API integration
wrangler secret put SUPERMEMORY_API_KEY
# Enter: your-supermemory-api-key
```

### 2.3 Verify Endpoint URLs

Ensure your Worker URLs in the app match your deployment:

1. **OAuth & Permissions**
   - Go to **"Features" → "OAuth & Permissions"**
   - Verify **Redirect URLs** contains: `https://your-worker-url.workers.dev/slack/oauth/callback`

2. **Event Subscriptions**
   - Go to **"Features" → "Event Subscriptions"**
   - Verify **Request URL** is: `https://your-worker-url.workers.dev/slack/events`
   - Status should show ✅ **"Verified"** after your Worker is deployed

3. **Slash Commands**
   - Go to **"Features" → "Slash Commands"**
   - Verify `/supermemory` command points to: `https://your-worker-url.workers.dev/slack/commands`

4. **Interactivity & Shortcuts**
   - Go to **"Features" → "Interactivity & Shortcuts"**
   - Verify **Request URL** is: `https://your-worker-url.workers.dev/slack/interactive`

## Step 3: Test App Configuration

### 3.1 Test Worker Health

Verify your Worker is responding:

```bash
curl https://your-worker-url.workers.dev/slack/health

# Expected response:
# {
#   "status": "ok",
#   "service": "slack-connector", 
#   "timestamp": "2024-01-01T00:00:00.000Z"
# }
```

### 3.2 Test Slack Integration

1. **Test Event URL Verification**
   - In **"Event Subscriptions"**, the Request URL should show ✅ **"Verified"**
   - If not verified, check your `SLACK_SIGNING_SECRET` and Worker deployment

2. **Test OAuth Flow (Development)**
   ```bash
   # Visit the OAuth start URL in your browser:
   https://your-worker-url.workers.dev/slack/oauth/start
   
   # This should:
   # 1. Redirect to Slack authorization
   # 2. Show permission scopes
   # 3. Return to your callback with success message
   ```

## Step 4: Install App to Workspace

### 4.1 Install via OAuth Flow

1. **Start Installation**
   - Visit: `https://your-worker-url.workers.dev/slack/oauth/start`
   - Or use the **"Install to Workspace"** button in your app dashboard

2. **Authorize Permissions**
   - Review the requested permissions
   - Click **"Allow"** to grant access
   - You should see a success message with workspace connection confirmation

3. **Verify Installation**
   ```bash
   # Test the authentication with your Worker:
   curl https://your-worker-url.workers.dev/slack/test
   
   # Expected response:
   # {
   #   "status": "authenticated",
   #   "team": "T1234567890", 
   #   "user": "U1234567890",
   #   "teamName": "Your Workspace Name"
   # }
   ```

### 4.2 Alternative: Direct Slack Installation

1. **Via App Directory**
   - In your app dashboard, go to **"Settings" → "Manage Distribution"**
   - Click **"Add to Slack"** button

2. **Share Installation Link**
   - Copy the installation URL from **"OAuth & Permissions"**
   - Share with workspace admins for installation

## Step 5: Configure Channel Sync (Optional)

After installation, you can configure which channels to sync:

### 5.1 Using Slash Commands

```
/supermemory status          # Check connection status
/supermemory sync #general   # Start syncing a specific channel  
/supermemory help           # Show available commands
```

### 5.2 Using Admin Dashboard

If you've deployed the admin dashboard:

1. Visit your dashboard URL
2. Connect with your Slack workspace
3. Select channels to sync
4. Configure document limits per channel
5. Optionally trigger historical backfill

## Troubleshooting

### Common Issues

#### ❌ "URL verification failed"
**Problem:** Event subscription URL not verified

**Solutions:**
1. Check `SLACK_SIGNING_SECRET` matches your app exactly
2. Verify Worker is deployed and accessible
3. Check Worker logs: `wrangler tail`
4. Test health endpoint manually

#### ❌ "OAuth flow fails"  
**Problem:** OAuth callback returns error

**Solutions:**
1. Verify `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` are correct
2. Check redirect URL matches exactly (including protocol)
3. Ensure `SECRET` environment variable is set for token encryption
4. Check Worker logs for detailed error messages

#### ❌ "No active tokens found"
**Problem:** Test endpoint returns 404

**Solutions:**
1. Complete OAuth flow first to generate tokens
2. Check database migrations are applied: `npm run drizzle:migrate:prod`
3. Verify D1 database binding in `wrangler.jsonc`
4. Check token storage with: `wrangler d1 execute supermemory-slack --command "SELECT * FROM slackToken;"`

#### ❌ "Rate limit exceeded"
**Problem:** Too many API requests

**Solutions:**
1. Check rate limiting configuration in Worker
2. Reduce sync frequency or batch size
3. Monitor Worker analytics for request patterns
4. Review Slack API rate limit guidelines

### Debug Commands

```bash
# Check Worker logs
wrangler tail

# Check D1 database contents  
wrangler d1 execute supermemory-slack --command "SELECT * FROM slackTeam;"
wrangler d1 execute supermemory-slack --command "SELECT id, teamId, scope, isRevoked FROM slackToken;"

# Test local development
wrangler dev
curl http://localhost:8787/slack/health

# Check environment variables
wrangler secret list
```

### Getting Help

1. **Check Worker Logs**: Use `wrangler tail` for real-time debugging
2. **Review Documentation**: See [API.md](API.md) for endpoint details
3. **Slack API Console**: Check your app's event delivery logs
4. **Test Environment**: Use development environment for debugging

## Security Considerations

- 🔐 **Secrets Management**: All credentials stored as Wrangler secrets
- 🔑 **Token Encryption**: Access tokens encrypted before database storage  
- ✅ **Request Verification**: All Slack requests verified with signing secret
- 🔄 **Token Rotation**: Support for rotating app credentials
- 🗂️ **Audit Logging**: All token operations logged for compliance
- 🚫 **Minimal Scopes**: Only essential permissions requested

## Next Steps

After successful setup:

1. **Configure Channels**: Select which channels to sync
2. **Historical Backfill**: Optionally sync historical messages
3. **Monitor Usage**: Check Worker analytics and logs
4. **Set Up Alerts**: Configure monitoring for errors
5. **Documentation**: Share usage guide with your team

---

**🎉 Congratulations!** Your Supermemory Slack Connector is now configured and ready to sync conversations to your knowledge base. 