# Slack App Setup - Quick Reference

**⚡ Fast track guide for experienced developers**

## 🚀 Prerequisites
- Slack workspace admin access
- Deployed Cloudflare Worker
- Supermemory API key

## 📦 Generate & Deploy

```bash
# 1. Generate manifest for your environment
npm run manifest:generate -- --env production

# 2. Set Worker secrets
wrangler secret put SLACK_CLIENT_ID        # From Slack app
wrangler secret put SLACK_CLIENT_SECRET    # From Slack app  
wrangler secret put SLACK_SIGNING_SECRET   # From Slack app
wrangler secret put SECRET                 # 32-char encryption key
wrangler secret put SUPERMEMORY_API_KEY   # Your API key

# 3. Deploy Worker
npm run deploy:prod
```

## 🔧 Slack App Creation

1. **Create App**: [api.slack.com/apps](https://api.slack.com/apps) → "Create New App" → "From an app manifest"
2. **Import**: Upload `slack-app-manifest-prod.yaml`
3. **Collect Credentials**: Basic Information → App Credentials
4. **Verify URLs**: All endpoints should auto-configure from manifest

## ✅ Testing

```bash
# Health check
curl https://your-worker.workers.dev/slack/health

# OAuth flow  
https://your-worker.workers.dev/slack/oauth/start

# Auth test
curl https://your-worker.workers.dev/slack/test
```

## 🔍 Key Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/slack/oauth/start` | Start OAuth flow |
| `/slack/oauth/callback` | OAuth callback |
| `/slack/events` | Event subscriptions |
| `/slack/commands` | Slash commands |
| `/slack/interactive` | Interactive components |
| `/slack/health` | Health check |
| `/slack/test` | Auth verification |

## 🎯 OAuth Scopes

**Bot Token:**
- `channels:read`, `groups:read`, `im:read`, `mpim:read` - List channels
- `channels:history`, `groups:history`, `im:history`, `mpim:history` - Read messages  
- `files:read` - Access files
- `users:read`, `users:read.email`, `team:read` - User info
- `chat:write`, `commands` - Bot functions

## 🐞 Troubleshooting

| Issue | Solution |
|-------|----------|
| URL verification failed | Check `SLACK_SIGNING_SECRET` and Worker deployment |
| OAuth flow fails | Verify `CLIENT_ID`, `CLIENT_SECRET`, and redirect URLs |
| No active tokens | Complete OAuth flow, check database migration |
| Rate limit exceeded | Review rate limiting config and API usage |

## 📊 Debug Commands

```bash
wrangler tail                    # Real-time logs
wrangler secret list            # List secrets (no values)
wrangler d1 execute supermemory-slack --command "SELECT * FROM slackTeam;"
```

**📋 Complete Guide**: See [SLACK_APP_SETUP.md](SLACK_APP_SETUP.md) for detailed instructions.

---

**⏱️ Typical setup time: 10-15 minutes** 