# Deploy CouchLoop EQ Live - Complete Guide

## Overview
CouchLoop EQ is a Model Context Protocol (MCP) server that provides behavioral governance for AI agents (ChatGPT, Claude). This guide covers deploying it publicly for access via npm, ChatGPT Developer Mode, and Claude Desktop.

## Production Environment Setup

### 🚧 Testing Phase Configuration
**IMPORTANT**: The initial deployment uses the **staging** shrink-chat API for safe testing. This is intentional to validate the deployment before connecting to production systems.

### ✅ Environment Variables Ready
The `.env.production` file has been configured with:
- **DATABASE_URL**: PostgreSQL connection to MCP's Supabase instance
- **JWT_SECRET**: Valid 32+ character secret
- **OAuth**: Stubbed configuration for anonymous sessions
- **Shrink-Chat**: **STAGING API** (`https://staging.couchloopchat.com`) for initial testing
  - Production API (`https://couchloopchat.com`) will be used after validation
- **Circuit Breaker**: Resilience configuration

### 🔸 Optional Keys
The Supabase API keys are optional (the server works with just DATABASE_URL):
- `SUPABASE_ANON_KEY`: Use the Publishable key from Supabase dashboard
- `SUPABASE_SERVICE_ROLE_KEY`: Use the Secret key from Supabase dashboard

## Deployment Options

### Option 1: Railway (Recommended) ⭐
**Best for: Quick deployment with minimal configuration**

1. **Install Railway CLI**
   ```bash
   brew install railway
   # or
   npm install -g @railway/cli
   ```

2. **Login to Railway**
   ```bash
   railway login
   ```

3. **Initialize Railway Project**
   ```bash
   cd /Users/hipdev/dev/mcp
   railway init
   # Select "Empty Project"
   # Name it: couchloop-eq
   ```

4. **Link GitHub Repository**
   ```bash
   railway link
   # Or manually in Railway dashboard:
   # - Go to Settings > GitHub
   # - Connect repository: your-github-username/mcp
   ```

5. **Configure Environment Variables**
   ```bash
   # Upload all production environment variables
   railway variables set $(cat .env.production | grep -v '^#' | grep '=' | xargs)

   # Or manually in Railway dashboard:
   # - Go to Variables tab
   # - Add each variable from .env.production
   ```

6. **Configure Build & Start Commands**
   In Railway dashboard or `railway.json`:
   ```json
   {
     "build": {
       "builder": "NIXPACKS",
       "buildCommand": "npm install && npm run build"
     },
     "deploy": {
       "startCommand": "npm start",
       "healthcheckPath": "/health",
       "restartPolicyType": "ON_FAILURE",
       "restartPolicyMaxRetries": 3
     }
   }
   ```

7. **Deploy**
   ```bash
   railway up
   ```

8. **Get Production URL**
   ```bash
   railway domain
   # Example: couchloop-eq.up.railway.app
   ```

### Option 2: Vercel
**Best for: Serverless deployment (requires adaptation)**

1. **Install Vercel CLI**
   ```bash
   npm install -g vercel
   ```

2. **Deploy**
   ```bash
   vercel --prod
   ```

Note: The current server uses Express which needs adaptation for Vercel's serverless functions.

### Option 3: Fly.io
**Best for: Global edge deployment**

1. **Install Fly CLI**
   ```bash
   brew install flyctl
   ```

2. **Create fly.toml**
   ```toml
   app = "couchloop-eq"

   [build]
     builder = "heroku/buildpacks:22"

   [env]
     PORT = "3000"
     NODE_ENV = "production"

   [services]
     internal_port = 3000
     protocol = "tcp"

     [[services.ports]]
       handlers = ["http"]
       port = 80

     [[services.ports]]
       handlers = ["tls", "http"]
       port = 443
   ```

3. **Deploy**
   ```bash
   flyctl launch
   flyctl secrets import < .env.production
   flyctl deploy
   ```

### Option 4: Docker (Self-hosted)
**Best for: Full control**

1. **Build Docker Image**
   ```bash
   docker build -t couchloop-eq .
   ```

2. **Run Container**
   ```bash
   docker run -d \
     --name couchloop-eq \
     --env-file .env.production \
     -p 3000:3000 \
     couchloop-eq
   ```

## Post-Deployment Setup

### 1. Update Package.json for NPM Publishing
```json
{
  "name": "@couchloop/eq-mcp",
  "version": "1.0.3",
  "description": "CouchLoop EQ - Behavioral governance layer for LLMs via MCP",
  "repository": {
    "type": "git",
    "url": "https://github.com/your-username/mcp"
  },
  "homepage": "https://couchloop-eq.up.railway.app",
  "bugs": {
    "url": "https://github.com/your-username/mcp/issues"
  }
}
```

### 2. Publish to NPM
```bash
npm login
npm publish --access public
```

### 3. Configure ChatGPT Developer Mode
In ChatGPT Developer Mode settings:
```yaml
MCP Server URL: https://couchloop-eq.up.railway.app/mcp
Authentication: None required
```

### 4. Configure Claude Desktop
Add to Claude Desktop config:
```json
{
  "mcpServers": {
    "couchloop-eq": {
      "url": "https://couchloop-eq.up.railway.app/mcp",
      "description": "CouchLoop EQ behavioral governance"
    }
  }
}
```

## Monitoring & Maintenance

### Health Check
```bash
curl https://couchloop-eq.up.railway.app/health
```

### View Logs (Railway)
```bash
railway logs
```

### Database Migrations
```bash
railway run npm run db:push
```

### Update Deployment
```bash
git push origin main  # Railway auto-deploys from GitHub
# or
railway up  # Manual deploy
```

## Production URLs

Once deployed, your CouchLoop EQ instance will be available at:

- **API Endpoint**: `https://your-domain.com/api/mcp/*`
- **ChatGPT MCP**: `https://your-domain.com/mcp`
- **Health Check**: `https://your-domain.com/health`
- **OAuth Flow**: `https://your-domain.com/oauth/authorize`

## Security Considerations

1. **Database Password**: Consider rotating the password in production
2. **JWT Secret**: Consider generating a new production-specific secret
3. **CORS**: Currently allows all origins for ChatGPT/Claude access
4. **Rate Limiting**: Configured via middleware
5. **Circuit Breaker**: Protects against cascading failures

## Troubleshooting

### Server won't start
- Check DATABASE_URL is correct
- Verify JWT_SECRET is 32+ characters
- Check logs: `railway logs` or deployment platform logs

### ChatGPT can't connect
- Verify CORS headers are working: `curl -I https://your-domain.com/mcp`
- Check for `Access-Control-Allow-Origin: *` header

### Database connection issues
- Verify PostgreSQL connection string
- Check Supabase pooler is accessible
- Test with: `psql $DATABASE_URL -c "SELECT 1"`

## Next Steps

1. ✅ Deploy to Railway (or chosen platform)
2. ✅ Get production URL
3. ✅ Update documentation with production URL
4. ✅ Publish to npm as @couchloop/eq-mcp
5. ✅ Register with ChatGPT Developer Mode
6. ✅ Add to Claude Desktop config
7. ✅ Announce availability

## Migrating from Testing Phase to Full Production

### When to Migrate
Complete this checklist before switching to production shrink-chat:

- [ ] CouchLoop EQ has been deployed and accessible via production URL
- [ ] ChatGPT integration tested and working
- [ ] Claude Desktop integration tested and working
- [ ] Crisis detection tested with staging API
- [ ] Session management working correctly
- [ ] No critical errors in production logs
- [ ] At least 24 hours of stable operation

### Migration Steps

1. **Update Environment Variable**
   ```bash
   # In .env.production, change:
   SHRINK_CHAT_API_URL=https://staging.couchloopchat.com
   # To:
   SHRINK_CHAT_API_URL=https://couchloopchat.com
   ```

2. **Update in Deployment Platform**

   **Railway:**
   ```bash
   railway variables set SHRINK_CHAT_API_URL=https://couchloopchat.com
   railway up
   ```

   **Or via Dashboard:**
   - Go to Variables tab
   - Update SHRINK_CHAT_API_URL to `https://couchloopchat.com`
   - Deploy will trigger automatically

3. **Verify the Change**
   ```bash
   # Check logs for successful connection
   railway logs --tail

   # Test health endpoint
   curl https://your-domain.com/health

   # Test a session creation
   curl -X POST https://your-domain.com/api/mcp/session \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"journey_slug": "test"}'
   ```

4. **Monitor for 24 Hours**
   - Check error rates
   - Verify crisis detection is working
   - Monitor response times
   - Review any error logs

### Rollback Plan
If issues occur after migration:
```bash
# Quickly revert to staging
railway variables set SHRINK_CHAT_API_URL=https://staging.couchloopchat.com
railway up
```

## Support

- GitHub Issues: https://github.com/your-username/mcp/issues
- Documentation: https://couchloop-eq.up.railway.app/docs
- Email: support@couchloop.com