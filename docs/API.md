# API Documentation

This document provides detailed information about the Supermemory Slack Connector API endpoints, request/response formats, and integration patterns.

## Base URL

- **Development**: `http://localhost:8787`
- **Staging**: `https://slack-staging.supermemory.ai`
- **Production**: `https://slack.supermemory.ai`

## Authentication

### OAuth 2.0 Flow

The connector uses Slack's OAuth 2.0 flow for workspace authorization.

#### 1. Initiate OAuth Flow

```http
GET /auth/slack/install
```

**Description**: Redirects users to Slack's OAuth authorization page.

**Query Parameters**:
- `state` (optional): Custom state parameter for CSRF protection

**Response**: HTTP 302 redirect to Slack OAuth URL

**Example**:
```bash
curl -X GET "https://slack.supermemory.ai/auth/slack/install"
```

#### 2. OAuth Callback

```http
GET /auth/slack/callback
```

**Description**: Handles the OAuth callback from Slack after user authorization.

**Query Parameters**:
- `code` (required): Authorization code from Slack
- `state` (optional): State parameter for verification

**Response**: HTTP 302 redirect to success/error page

**Example Response** (Success):
```json
{
  "success": true,
  "message": "Slack workspace connected successfully",
  "team": {
    "id": "T1234567890",
    "name": "Example Team"
  }
}
```

## Slack Integration Endpoints

### Receive Slack Events

```http
POST /slack/events
```

**Description**: Receives real-time events from Slack via Events API.

**Headers**:
- `Content-Type: application/json`
- `X-Slack-Signature`: HMAC-SHA256 signature for verification
- `X-Slack-Request-Timestamp`: Unix timestamp of the request

**Request Body**:
```json
{
  "token": "verification_token",
  "team_id": "T1234567890",
  "api_app_id": "A1234567890",
  "event": {
    "type": "message",
    "channel": "C1234567890",
    "user": "U1234567890",
    "text": "Hello, world!",
    "ts": "1234567890.123456",
    "thread_ts": "1234567890.123456"
  },
  "type": "event_callback",
  "event_id": "Ev1234567890",
  "event_time": 1234567890
}
```

**Response**:
```json
{
  "success": true,
  "message": "Event processed successfully"
}
```

**Supported Event Types**:
- `message.channels` - Public channel messages
- `message.groups` - Private channel messages  
- `message.im` - Direct messages
- `message.mpim` - Group direct messages
- `file_shared` - File attachments

### Handle Interactive Components

```http
POST /slack/interactive
```

**Description**: Handles interactive components like buttons and modals.

**Headers**:
- `Content-Type: application/x-www-form-urlencoded`
- `X-Slack-Signature`: HMAC-SHA256 signature for verification

**Request Body** (URL-encoded):
```
payload={"type":"interactive_message","actions":[...],"callback_id":"..."}
```

**Response**:
```json
{
  "text": "Action completed successfully"
}
```

## System Management Endpoints

### Health Check

```http
GET /health
```

**Description**: Returns the health status of the connector.

**Response**:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-25T12:00:00Z",
  "version": "1.0.0",
  "services": {
    "database": "healthy",
    "slack_api": "healthy",
    "supermemory_api": "healthy"
  }
}
```

### System Status

```http
GET /api/status
```

**Description**: Returns detailed system status and metrics.

**Response**:
```json
{
  "status": "operational",
  "uptime": 3600,
  "metrics": {
    "events_processed": 1234,
    "memories_created": 1200,
    "error_rate": 0.02,
    "avg_latency_ms": 150
  },
  "connected_teams": 5,
  "active_channels": 25
}
```

## Data Models

### Slack Message Format

```typescript
interface SlackMessage {
  type: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
  channel: string;
  files?: SlackFile[];
  attachments?: SlackAttachment[];
  blocks?: SlackBlock[];
}
```

### Supermemory Payload Format

```typescript
interface SupermemoryPayload {
  content: string;
  metadata: {
    provider: string;
    author: string;
    timestamp: string;
    channel: string;
    thread_id?: string;
    file_urls?: string;
    slack_ts: string;
    slack_team_id: string;
  };
  tags: string[];
}
```

### Error Response Format

```typescript
interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
}
```

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `INVALID_SIGNATURE` | 401 | Slack signature verification failed |
| `INVALID_TIMESTAMP` | 401 | Request timestamp is too old |
| `TEAM_NOT_FOUND` | 404 | Slack team not found in database |
| `TOKEN_EXPIRED` | 401 | Slack access token has expired |
| `RATE_LIMITED` | 429 | Too many requests, rate limit exceeded |
| `SUPERMEMORY_ERROR` | 502 | Error communicating with Supermemory API |
| `DATABASE_ERROR` | 500 | Database operation failed |
| `INTERNAL_ERROR` | 500 | Unexpected internal error |

## Rate Limiting

The connector implements multi-tier rate limiting based on Slack's API guidelines:

### Slack API Limits

| Tier | Methods | Limit | Notes |
|------|---------|-------|-------|
| 1 | `conversations.history`, `conversations.replies` | 1 req/min | 15 messages per request |
| 2 | `conversations.list`, `users.list` | 20 req/min | - |
| 3 | `conversations.info`, `users.info`, `auth.test` | 50 req/min | - |
| 4 | `chat.postMessage` | 60 req/min | 1 per second per channel |

### Rate Limit Headers

Responses include rate limiting information:

```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1234567890
X-RateLimit-Retry-After: 30
```

### Rate Limit Responses

When rate limited, the API returns:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded",
    "retry_after": 30
  }
}
```

## Webhooks

### URL Verification

Slack sends URL verification challenges when setting up event subscriptions:

**Request**:
```json
{
  "token": "verification_token",
  "challenge": "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P",
  "type": "url_verification"
}
```

**Response**:
```json
{
  "challenge": "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P"
}
```

### Event Retry Logic

Slack retries failed webhooks with exponential backoff:
- Initial retry: 1 second
- Subsequent retries: 2, 4, 8, 16 seconds
- Maximum retries: 5 attempts

## Security

### Request Verification

All Slack requests are verified using HMAC-SHA256:

```typescript
function verifySlackRequest(
  body: string,
  timestamp: string,
  signature: string,
  signingSecret: string
): boolean {
  const baseString = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', signingSecret);
  hmac.update(baseString);
  const computed = `v0=${hmac.digest('hex')}`;
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computed)
  );
}
```

### Token Encryption

Access tokens are encrypted before storage:

```typescript
interface EncryptedToken {
  encrypted: string;
  iv: string;
  tag: string;
}
```

## Best Practices

### Event Handling
- Always verify request signatures
- Respond to Slack within 3 seconds
- Use async processing for long operations
- Implement idempotency for message processing

### Error Handling
- Return appropriate HTTP status codes
- Log errors with correlation IDs
- Implement graceful degradation
- Provide clear error messages

### Performance
- Use connection pooling for database operations
- Implement request caching where appropriate
- Monitor and optimize slow queries
- Use background jobs for heavy processing

## Integration Examples

### Setting up Event Subscriptions

1. **Configure Slack App**:
   ```
   Event Subscriptions URL: https://your-domain.com/slack/events
   OAuth Redirect URL: https://your-domain.com/auth/slack/callback
   ```

2. **Required Scopes**:
   ```
   Bot Token Scopes:
   - channels:read
   - groups:read
   - im:read
   - mpim:read
   - channels:history
   - groups:history
   - im:history
   - mpim:history
   - files:read
   ```

3. **Event Types**:
   ```
   - message.channels
   - message.groups
   - message.im
   - message.mpim
   - file_shared
   ```

### Testing Integration

```bash
# Test webhook endpoint
curl -X POST https://your-domain.com/slack/events \
  -H "Content-Type: application/json" \
  -H "X-Slack-Signature: v0=..." \
  -H "X-Slack-Request-Timestamp: 1234567890" \
  -d '{"type":"url_verification","challenge":"test123"}'

# Test OAuth flow
curl -X GET "https://your-domain.com/auth/slack/install"
```

## Support

For API support and questions:
- **Documentation**: [README.md](../README.md)
- **Issues**: [GitHub Issues](https://github.com/supermemoryai/slack-connector/issues)
- **Email**: support@supermemory.ai 