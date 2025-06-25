# Supermemory Slack Connector

> **Seamlessly sync Slack conversations to Supermemory for intelligent knowledge management**

A production-ready Cloudflare Workers-based connector that integrates Slack workspaces with [Supermemory](https://supermemory.ai), enabling real-time message synchronization and historical backfills with enterprise-grade security and scalability.

[![Deploy with Wrangler](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/supermemoryai/slack-connector)

## 🚀 Features

### Real-time Synchronization
- **Live message ingestion** via Slack Events API
- **Thread-aware processing** with complete conversation context
- **File attachment handling** with secure URL management
- **Multi-channel support** with granular control

### Historical Backfill
- **Cursor-based pagination** for efficient historical data retrieval
- **Configurable document limits** per channel to control costs
- **Progress tracking and resumability** for large workspaces
- **Rate limit-aware processing** (~50 req/min compliance)

### Enterprise Security
- **Token encryption** using AES-GCM before database storage
- **Request signature verification** using Slack's HMAC-SHA256
- **Automatic token rotation** and revocation support
- **GDPR compliance** with user data deletion capabilities

### Production-Ready Infrastructure
- **Multi-environment deployment** (development, staging, production)
- **Comprehensive observability** with metrics and logging
- **Rate limiting** to prevent API abuse
- **Error handling** with exponential backoff retry logic

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Slack API     │───▶│ Cloudflare      │───▶│   Supermemory   │
│                 │    │ Workers         │    │   API           │
│ • Events API    │    │                 │    │                 │
│ • OAuth Flow    │    │ • Rate Limiting │    │ • /v3/memories  │
│ • Web API       │    │ • Encryption    │    │ • Knowledge     │
│                 │    │ • Transformation│    │   Storage       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │ Cloudflare D1   │
                       │                 │
                       │ • Teams/Tokens  │
                       │ • Channels      │
                       │ • Sync Logs     │
                       └─────────────────┘
```

### Project Structure
```
src/
├── index.tsx           # Main Worker entry point
├── auth.ts            # Better Auth configuration
├── api.ts             # API route handlers
├── slack/
│   ├── index.ts       # Slack router and main handlers
│   ├── services/
│   │   ├── client.ts  # Slack API client with rate limiting
│   │   └── transformer.ts # Message transformation logic
│   ├── utils/
│   │   └── signature.ts # Request signature verification
│   ├── types/         # TypeScript interfaces
│   └── handlers/      # Event-specific handlers
├── db/
│   ├── schema.ts      # Database schema definitions
│   └── slackOperations.ts # Database operations
├── middleware/
│   ├── rateLimit.ts   # General rate limiting
│   └── slackRateLimit.ts # Slack-specific rate limiting
└── utils/
    ├── cipher.ts      # Encryption utilities
    └── key.ts         # Key management
```

## 🚦 Quick Start

### Prerequisites
- [Cloudflare Workers](https://workers.cloudflare.com/) account
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) installed
- [Slack App](https://api.slack.com/apps) created
- [Supermemory API](https://supermemory.ai) access

### 1. Clone and Install
```bash
git clone https://github.com/supermemoryai/slack-connector.git
cd slack-connector
npm install
```

### 2. Configure Environment
```bash
# Copy environment template
cp .dev.vars.example .dev.vars

# Edit with your credentials
nano .dev.vars
```

### 3. Setup Database
```bash
# Create D1 database
wrangler d1 create supermemory-slack

# Apply migrations
npm run drizzle:migrate
```

### 4. Deploy
```bash
# Development
npm run dev

# Production
npm run deploy
```

### 5. Configure Slack App

**🔧 Create & Configure Slack App:**

For **experienced developers** (10-15 min setup):
- **Quick Start**: [Slack App Quick Reference](docs/SLACK_APP_QUICK_START.md)

For **detailed step-by-step** instructions:
- **Complete Guide**: [Slack App Setup Guide](docs/SLACK_APP_SETUP.md)

**Generate app manifest:**
```bash
# Create manifest for your environment
npm run manifest:generate -- --env production

# Then follow the setup guide to create your Slack app
```

## 📖 Detailed Setup

For comprehensive deployment instructions, including production configuration, security setup, and troubleshooting, see our documentation:

- **🚀 Slack App Setup**: [docs/SLACK_APP_SETUP.md](docs/SLACK_APP_SETUP.md)
- **⚡ Quick Reference**: [docs/SLACK_APP_QUICK_START.md](docs/SLACK_APP_QUICK_START.md)  
- **🔧 Deployment Guide**: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- **📡 API Reference**: [docs/API.md](docs/API.md)

For automated setup, use our interactive configuration tool:
```bash
npm run setup:deployment
```

## 🔧 Development

### Local Development
```bash
# Start local development server
npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Generate database migrations
npm run drizzle:generate
```

### Environment Variables

#### Required
- `SLACK_CLIENT_ID` - From your Slack app's Basic Information
- `SLACK_CLIENT_SECRET` - From your Slack app's Basic Information  
- `SLACK_SIGNING_SECRET` - From your Slack app's Basic Information
- `SUPERMEMORY_API_KEY` - Your Supermemory API key
- `SECRET` - Encryption key for token storage (32+ characters)

#### Optional
- `SLACK_BOT_TOKEN` - For testing (usually obtained via OAuth)
- `SLACK_USER_TOKEN` - For testing (usually obtained via OAuth)
- `SUPERMEMORY_API_URL` - API endpoint (default: https://api.supermemory.ai)

## 🔐 Security

### Token Management
- All Slack tokens are encrypted using AES-GCM before database storage
- Tokens are automatically rotated and can be revoked on demand
- Encryption keys are managed through Cloudflare Workers Secrets

### Request Verification
- All incoming Slack requests are verified using HMAC-SHA256 signatures
- Timestamp validation prevents replay attacks
- Request body integrity is maintained throughout processing

### Rate Limiting
- Slack API rate limits are respected with intelligent backoff
- Per-team, per-method rate limiting prevents abuse
- Configurable thresholds for different API tiers

## 📊 Monitoring & Observability

### Built-in Metrics
- **Events received** per workspace
- **Memories created** success/failure rates
- **Latency tracking** from event receipt to memory creation
- **Rate limit monitoring** and prevention
- **Error rates** with detailed categorization

### Logging
- Structured JSON logging throughout the application
- Request tracing with correlation IDs
- Performance metrics and bottleneck identification
- Security event auditing

### Dashboards
Access real-time metrics through:
- Cloudflare Workers Analytics Dashboard
- Custom metrics via Workers Observability
- Logs accessible via `wrangler tail`

## 🛠️ API Reference

### OAuth Endpoints
- `GET /auth/slack/install` - Initiate Slack OAuth flow
- `GET /auth/slack/callback` - Handle OAuth callback

### Slack Integration
- `POST /slack/events` - Receive Slack events
- `POST /slack/interactive` - Handle interactive components

### Management
- `GET /health` - Health check endpoint
- `GET /api/status` - System status and metrics

### Webhook Events Supported
- `message.channels` - Public channel messages
- `message.groups` - Private channel messages
- `message.im` - Direct messages
- `message.mpim` - Group direct messages
- `file_shared` - File attachments

## 🚀 Deployment

### Environment-Specific Deployment
```bash
# Deploy to staging
wrangler deploy --env staging

# Deploy to production
wrangler deploy --env production
```

### Secrets Management
```bash
# Set production secrets
wrangler secret put SLACK_CLIENT_SECRET
wrangler secret put SUPERMEMORY_API_KEY
wrangler secret put SECRET
```

### Database Migrations
```bash
# Apply to production
npm run drizzle:migrate:prod
```

## 🧪 Testing

### Unit Tests
```bash
# Run all tests
npm test

# Run specific test files
npm test slackDatabase.spec.ts
npm test slackRateLimit.spec.ts
```

### Integration Testing
```bash
# Test with local environment
npm run dev

# Test Slack webhook signature verification
curl -X POST http://localhost:8787/slack/events \
  -H "Content-Type: application/json" \
  -H "X-Slack-Signature: v0=..." \
  -H "X-Slack-Request-Timestamp: ..." \
  -d '{"type":"url_verification","challenge":"test"}'
```

## 🤝 Contributing

### Development Workflow
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and add tests
4. Ensure tests pass: `npm test`
5. Lint your code: `npm run lint`
6. Commit your changes: `git commit -m 'Add amazing feature'`
7. Push to the branch: `git push origin feature/amazing-feature`
8. Open a Pull Request

### Code Style
- Follow TypeScript best practices
- Use Biome for consistent formatting
- Add JSDoc comments for public APIs
- Write comprehensive tests for new features

### Submitting Issues
When reporting issues, please include:
- Steps to reproduce the problem
- Expected behavior
- Actual behavior
- Environment details (Wrangler version, Node.js version)
- Relevant log output

## 🔍 Troubleshooting

### Common Issues

#### Signature Verification Failures
```bash
# Check signing secret
wrangler secret list
# Verify webhook URL in Slack app settings
```

#### Database Connection Errors
```bash
# Verify D1 database ID in wrangler.jsonc
wrangler d1 info supermemory-slack
```

#### Rate Limit Errors
```bash
# Monitor rate limit status
wrangler tail
# Adjust rate limiting configuration if needed
```

### Debug Mode
```bash
# Enable verbose logging
export LOG_LEVEL=debug
npm run dev
```

For more troubleshooting information, see the [Deployment Guide](docs/DEPLOYMENT.md#troubleshooting).

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built on the [Supermemory Backend API Kit](https://github.com/supermemoryai/backend-api-kit) template
- Powered by [Cloudflare Workers](https://workers.cloudflare.com/)
- Secured with [Better Auth](https://www.better-auth.com/)
- Database management via [Drizzle ORM](https://orm.drizzle.team/)

## 📞 Support

- **Documentation**: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- **Issues**: [GitHub Issues](https://github.com/supermemoryai/slack-connector/issues)
- **Community**: [Supermemory Discord](https://discord.gg/supermemory)
- **Email**: support@supermemory.ai

---

**Made with ❤️ by the Supermemory team** 