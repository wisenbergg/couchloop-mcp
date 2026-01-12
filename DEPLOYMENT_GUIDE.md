# CouchLoop MCP Server Deployment Guide

## Environment Configuration

### Available Environments

1. **Local Development** (`.env.local`)
   - Used for local development and testing
   - Points to local database and services
   - Debug logging enabled

2. **Staging** (`.env.staging`)
   - Pre-production testing environment
   - Mirrors production setup with test data
   - Enhanced logging for debugging
   - More permissive rate limits

3. **Production** (`.env.production`)
   - Live environment for real users
   - Optimized for performance and security
   - Conservative feature flags
   - Production monitoring enabled

### Environment Setup

#### Local Development
```bash
# Copy and configure local environment
cp .env.example .env.local
# Edit .env.local with your local settings

# Start development server
npm run dev
```

#### Staging Deployment
```bash
# Ensure staging environment is configured
cp .env.staging .env

# Build and test
npm run build
npm test

# Deploy to staging (Vercel example)
vercel --env-file .env.staging
```

#### Production Deployment
```bash
# Ensure production environment is configured
cp .env.production .env

# Run production checks
npm run typecheck
npm test
npm run build

# Deploy to production
vercel --prod --env-file .env.production
```

## Deployment Platforms

### Vercel (Recommended)

1. **Initial Setup**
```bash
# Install Vercel CLI
npm i -g vercel

# Link project
vercel link

# Configure environment variables in Vercel dashboard
# https://vercel.com/dashboard/[project]/settings/environment-variables
```

2. **Deployment Commands**
```bash
# Preview deployment (staging)
vercel

# Production deployment
vercel --prod
```

3. **Environment Variables**
   - Add all variables from `.env.production` to Vercel dashboard
   - Use different values for Preview and Production environments

### Railway

1. **Initial Setup**
```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and link project
railway login
railway link
```

2. **Configuration**
```yaml
# railway.yaml
environments:
  production:
    build:
      command: npm run build
    deploy:
      startCommand: npm start
      healthcheckPath: /health
      healthcheckTimeout: 30
```

3. **Deployment**
```bash
# Deploy to Railway
railway up
```

### Docker (Self-hosted)

1. **Dockerfile**
```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy application
COPY . .
RUN npm run build

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start server
CMD ["npm", "start"]
```

2. **Docker Compose**
```yaml
version: '3.8'

services:
  mcp-server:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env.production
    restart: unless-stopped
    networks:
      - couchloop-network

  oauth-server:
    build: .
    command: npm run server
    ports:
      - "3001:3001"
    env_file:
      - .env.production
    restart: unless-stopped
    networks:
      - couchloop-network

networks:
  couchloop-network:
    driver: bridge
```

## Pre-deployment Checklist

### Code Quality
- [ ] All TypeScript errors resolved (`npm run typecheck`)
- [ ] ESLint warnings addressed (`npm run lint`)
- [ ] Tests passing (`npm test`)
- [ ] Build successful (`npm run build`)

### Security
- [ ] Environment variables secured
- [ ] JWT secrets are strong and unique per environment
- [ ] OAuth clients configured correctly
- [ ] CORS settings appropriate for environment
- [ ] Rate limiting configured
- [ ] SQL injection protection verified

### Database
- [ ] Database migrations run (`npm run db:push`)
- [ ] Seed data loaded if needed (`npm run db:seed`)
- [ ] Backup strategy in place
- [ ] Connection pooling configured

### Monitoring
- [ ] Health check endpoint working (`/health`)
- [ ] Error tracking configured (Sentry)
- [ ] Performance monitoring enabled
- [ ] Logging levels appropriate
- [ ] Alerts configured for critical errors

### Integration
- [ ] Shrink-chat API connection verified
- [ ] OAuth flow tested end-to-end
- [ ] MCP protocol compatibility confirmed
- [ ] Circuit breakers tested

## Post-deployment Verification

### Smoke Tests
```bash
# Health check
curl https://your-domain.com/health

# OAuth flow
curl https://your-domain.com/oauth/authorize?client_id=xxx

# MCP connection test
npm run test:integration
```

### Monitoring Dashboard
1. Check Sentry for any immediate errors
2. Verify performance metrics are being collected
3. Confirm database connections are stable
4. Monitor circuit breaker status

### Rollback Plan
```bash
# Vercel - Instant rollback
vercel rollback

# Railway - Previous deployment
railway down
railway up --environment=previous

# Docker - Previous image
docker-compose down
docker-compose up -d --force-recreate
```

## Environment-Specific Features

### Staging Only
- Detailed debug logging
- Extended session timeouts
- Higher rate limits
- Test OAuth clients
- Synthetic monitoring

### Production Only
- Optimized caching
- Auto-scaling enabled
- Backup automation
- Real user monitoring
- PII data encryption

## Secrets Management

### Required Secrets (Never commit these!)
1. `DATABASE_URL` - PostgreSQL connection string
2. `SUPABASE_SERVICE_ROLE_KEY` - Admin access to Supabase
3. `JWT_SECRET` - Token signing secret
4. `OAUTH_CLIENT_SECRET` - OAuth client authentication
5. `SHRINK_CHAT_API_KEY` - Shrink-chat API access
6. `SENTRY_DSN` - Error tracking endpoint

### Secret Rotation
- JWT secrets: Rotate every 90 days
- OAuth secrets: Rotate every 180 days
- API keys: Rotate based on provider requirements
- Database passwords: Rotate every 60 days

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Verify DATABASE_URL is correct
   - Check firewall rules allow connection
   - Ensure SSL mode matches database configuration

2. **OAuth Flow Failures**
   - Confirm redirect URIs match exactly
   - Verify client credentials are correct
   - Check JWT secret is properly set

3. **Shrink-chat Integration Issues**
   - Verify API key is valid
   - Check network connectivity
   - Monitor circuit breaker status
   - Review timeout settings

4. **High Memory Usage**
   - Check for memory leaks in long-running sessions
   - Review cache size limits
   - Monitor connection pool size

## Support

For deployment issues:
1. Check logs: `npm run logs`
2. Review monitoring dashboards
3. Consult error tracking (Sentry)
4. Contact DevOps team if needed

## Updates and Maintenance

### Zero-downtime Deployment
1. Deploy new version to staging
2. Run integration tests
3. Deploy to production (blue-green or rolling)
4. Monitor for 15 minutes
5. Rollback if issues detected

### Database Migrations
```bash
# Always backup first
npm run db:backup

# Run migrations
npm run db:migrate

# Verify schema
npm run db:studio
```

### Dependency Updates
```bash
# Check for updates
npm outdated

# Update dependencies (test thoroughly)
npm update

# Security audit
npm audit
```