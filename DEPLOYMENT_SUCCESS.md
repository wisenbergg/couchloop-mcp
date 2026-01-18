# CouchLoop EQ MCP Server - Deployment Success

## Production URL
**https://couchloop-mcp-production.up.railway.app**

## Status
✅ **LIVE AND OPERATIONAL**

### Verified Endpoints

#### 1. Health Check
- **URL:** https://couchloop-mcp-production.up.railway.app/health
- **Status:** ✅ Healthy
- **Response:** `{"status":"healthy","timestamp":"2026-01-18T13:43:39.744Z"}`

#### 2. MCP Endpoint (ChatGPT Developer Mode)
- **URL:** https://couchloop-mcp-production.up.railway.app/mcp
- **Protocol:** JSON-RPC 2.0 over HTTP POST
- **Status:** ✅ Fully operational
- **Available Methods:**
  - `tools/list` - List all available tools (10 tools)
  - `resources/list` - List all resources (5+ journeys)
  - Tool execution (create_session, send_message, etc.)

#### 3. OAuth Endpoints (Stubbed)
- **Authorization:** `/oauth/authorize`
- **Token:** `/oauth/token`
- **Status:** ✅ Working with anonymous session support

## Configuration for ChatGPT

To use with ChatGPT Developer Mode:
1. **MCP Server URL:** `https://couchloop-mcp-production.up.railway.app/mcp`
2. **Authentication:** None required (uses anonymous sessions)
3. **Transport:** Streamable HTTP

## Environment Configuration

All environment variables have been successfully configured via Railway CLI:
- ✅ Database connection (PostgreSQL via Supabase)
- ✅ JWT Secret for session management
- ✅ OAuth configuration for anonymous sessions
- ✅ Shrink-chat API integration (staging)
- ✅ Circuit breaker and timeout settings

## Deployment Method

- **Platform:** Railway
- **Build:** Docker multi-stage build
- **Runtime:** Node.js 20 Alpine
- **Health Checks:** Configured with 30s intervals

## Testing Commands

```bash
# Check health
curl https://couchloop-mcp-production.up.railway.app/health

# List MCP tools
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}'

# List MCP resources
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"resources/list","params":{},"id":2}'
```

## Next Steps

1. **Monitor logs:** Use `railway logs` to monitor production
2. **Test with ChatGPT:** Configure ChatGPT Developer Mode with the MCP URL
3. **Update docs:** Add production URL to README and documentation
4. **Consider:** Switching from staging to production shrink-chat API after verification

## Railway Management

```bash
# View logs
railway logs

# View environment variables
railway variables

# Open Railway dashboard
railway open

# Redeploy (after code changes)
git push && railway up
```

---
**Deployed:** January 18, 2026
**Version:** 1.0.2
**Status:** Production Live