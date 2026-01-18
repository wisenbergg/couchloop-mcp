# Production Environment Variables - Extracted from All Repositories

## Summary
All production environment variables have been successfully extracted from the configured repositories and applied to the MCP's `.env.local` file.

## Database Configuration (Production)

### Primary Database
- **Host**: db.oqacztfskduxbstnmxnd.supabase.co
- **Database**: postgres
- **Connection String**:
  ```
  postgresql://postgres:YB*-xLec393gb_@db.oqacztfskduxbstnmxnd.supabase.co:6543/postgres?sslmode=require&connect_timeout=30
  ```

### Connection Pooler (More Efficient)
- **Host**: aws-0-us-east-1.pooler.supabase.com
- **Port**: 5432
- **Connection String**:
  ```
  postgresql://postgres.oqacztfskduxbstnmxnd:YB*-xLec393gb_@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require&connect_timeout=30
  ```

## Supabase Configuration

- **SUPABASE_URL**: `https://oqacztfskduxbstnmxnd.supabase.co`
- **SUPABASE_ANON_KEY**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xYWN6dGZza2R1eGJzdG5teG5kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDYyMTg3MDUsImV4cCI6MjA2MTc5NDcwNX0.LIx3Msi6IgeaFA_7cuM2MR6Jrw8c0hQUms32gDmP9OA`
- **SUPABASE_SERVICE_ROLE_KEY**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xYWN6dGZza2R1eGJzdG5teG5kIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NjIxODcwNSwiZXhwIjoyMDYxNzk0NzA1fQ.NlQrsdywhcJb6U1ZWg431nupmvJPBY0LSFTH6lpRHbs`
- **Project Reference**: `oqacztfskduxbstnmxnd`

## Shrink-Chat Integration

- **Production API URL**: `https://shrink-chat-wisenbergg-wisenberggs-projects.vercel.app`
- **Backend URL (iOS)**: `https://shrink-chat-wisenbergg-wisenberggs-projects.vercel.app`

## OpenAI Configuration (from shrink-chat)

- **CHAT_MODEL**: `ft:gpt-4.1-2025-04-14:when-i-was:empathy-v5:BXN8XrVV`
- **FINE_TUNED_MODEL**: `ft:gpt-4.1-2025-04-14:when-i-was:empathy-v5:BXN8XrVV`
- **MICRO_MODEL**: `ft:gpt-4.1-2025-04-14:when-i-was:casual-v1:BXOXiBoi`
- **EMBEDDING_MODEL**: `text-embedding-3-small`
- **Temperature**: 0.8
- **Top P**: 0.8
- **Max Tokens**: 2048

## Crisis Detection Settings (from shrink-chat)

- **CRISIS_DETECTION_MODE**: enhanced
- **AI_CRISIS_CONFIDENCE_THRESHOLD**: 0.8
- **CRISIS_OPTIMIZED_TIMEOUT_MS**: 4500
- **CRISIS_ASSESSMENT_DEDUPE_MS**: 60000
- **ENABLE_AI_CRISIS_DETECTION**: true
- **ENABLE_AI_CRISIS_ENHANCEMENT**: true

## Memory Enhancement Settings

- **MEMORY_ASSESSMENT_ENABLED**: true
- **MEMORY_ASSESSMENT_MODEL**: gpt-4o-mini
- **MEMORY_ASSESSMENT_TIMEOUT**: 3000
- **MEMORY_ENHANCEMENT_ENABLED**: true
- **MEMORY_ENHANCEMENT_ROLLOUT_PERCENTAGE**: 100
- **VECTOR_MEMORY_BUDGET_MS**: 3000

## RAG (Retrieval-Augmented Generation) Settings

- **RECALL_THRESHOLD**: 0.40
- **RECALL_TOP_N**: 3
- **DEBUG_RAG**: false

## PostHog Analytics

- **POSTHOG_HOST**: `https://us.i.posthog.com`
- **POSTHOG_PROJECT_API_KEY**: `phc_A9Gdi9ja5gJfRZ4BUkhqfLg65Qt2gaNCadIiTtMLfg3`

## Additional Services

- **GOOGLE_MAPS_API_KEY**: `AIzaSyD23mYVaYQeFdkszSOVb4ubOkt1BiauQd8`
- **PERPLEXITY_API_KEY**: `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`
- **PERPLEXITY_MODEL**: sonar

## Environment Cross-Reference

### Staging Database (from .zshrc)
- **DATABASE_URL_STAGING**: `postgresql://postgres:UtcXDhGuxmjg50ZC@db.fbexcqoupibaohbhfufp.supabase.co:6543/postgres?sslmode=require&connect_timeout=30`
- **Staging Supabase Project**: fbexcqoupibaohbhfufp

### Froid Local (Different Supabase Project)
- **Supabase URL**: `https://bzpwbiuzjinvogevwnvj.supabase.co`
- **Project Reference**: bzpwbiuzjinvogevwnvj

### CL-Chat-iOS Production (Staging Database)
- **Backend**: Points to shrink-chat production
- **Supabase**: Uses staging database (fbexcqoupibaohbhfufp)

## Files Updated

✅ **Updated Files:**
- `/Users/hipdev/dev/mcp/.env.local` - Updated with production database and Supabase credentials
- `/Users/hipdev/Library/Application Support/Claude/claude_desktop_config.json` - Added all MCP servers

## MCP Server Database Connections

- **postgres-prod**: `postgresql://postgres.oqacztfskduxbstnmxnd:YB*-xLec393gb_@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`
- **postgres-staging**: Uses `DATABASE_URL_STAGING` environment variable

## Important Notes

1. **Production Database**: The production database is now properly configured in `.env.local`
2. **Supabase Keys**: All Supabase keys (anon and service role) are set for production
3. **Shrink-Chat**: API URL updated to production Vercel deployment
4. **MCP Servers**: Can now access both production and staging databases through configured MCP servers

## Testing the Configuration

To verify the production database connection:

```bash
# Test database connection
psql $DATABASE_URL -c "SELECT current_database();"

# Or using the values directly
psql "postgresql://postgres:YB*-xLec393gb_@db.oqacztfskduxbstnmxnd.supabase.co:6543/postgres?sslmode=require" -c "SELECT count(*) FROM sessions;"
```

## Security Notes

⚠️ **Important**: These are production credentials. Ensure:
- Never commit `.env.local` to version control
- Rotate credentials regularly
- Use environment-specific credentials for different environments
- Consider using a secrets manager for production deployments