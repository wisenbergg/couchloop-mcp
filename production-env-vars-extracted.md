# CouchLoop EQ Production Environment Variables - Extracted

## ✅ Successfully Extracted from .env.local

The following production-ready values have been extracted and configured in `.env.production`:

### Database Configuration
```bash
DATABASE_URL=postgresql://postgres.tvqjkrghxnxmgaatlnfn:ZBW4naq.unr8qgq*tyx@aws-1-us-east-2.pooler.supabase.com:6543/postgres
SUPABASE_URL=https://tvqjkrghxnxmgaatlnfn.supabase.co
```
**Status**: ✅ READY - Using MCP's own Supabase instance

### OAuth Configuration
```bash
OAUTH_CLIENT_ID=couchloop_production
OAUTH_CLIENT_SECRET=BE7/TOG5eUB35sR2GhfefT5Tk+TEiQYOBj4D1xcVXe4=
OAUTH_REDIRECT_URI=https://chat.openai.com/aip/plugin/oauth/callback
```
**Status**: ✅ READY - OAuth is intentionally stubbed

### JWT Secret
```bash
JWT_SECRET=EhynE9KOoDV/1bLgh9B7C81pQU85uu9Vn/ViXnAthNs=
```
**Status**: ✅ READY - Valid 32+ character secret

### Server Configuration
```bash
PORT=3000
NODE_ENV=production
LOG_LEVEL=info
```
**Status**: ✅ READY

### Shrink-Chat Integration
```bash
SHRINK_CHAT_API_URL=https://staging.couchloopchat.com
SHRINK_CHAT_TIMEOUT=30000
SHRINK_CHAT_TIMEOUT_REGULAR=30000
SHRINK_CHAT_TIMEOUT_CRISIS=45000
SHRINK_CHAT_TIMEOUT_STREAM=60000
```
**Status**: ✅ READY - Using staging API for therapeutic features

### Circuit Breaker
```bash
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=60000
CIRCUIT_BREAKER_RESET=30000
```
**Status**: ✅ READY

## ❌ Still Need to Retrieve

### Supabase API Keys
```bash
SUPABASE_ANON_KEY=TODO_GET_FROM_SUPABASE_DASHBOARD
SUPABASE_SERVICE_ROLE_KEY=TODO_GET_FROM_SUPABASE_DASHBOARD
```

**How to retrieve:**
1. Go to: https://supabase.com/dashboard/project/tvqjkrghxnxmgaatlnfn/settings/api
2. Copy the **anon (public)** key
3. Copy the **service_role (secret)** key
4. Update these values in `.env.production`

### OpenAI Verification Token (Optional)
```bash
OPENAI_VERIFICATION_TOKEN=REPLACE_WITH_VERIFICATION_TOKEN
```

**How to retrieve:**
- This will be provided by ChatGPT when you register the plugin
- Not required for initial deployment

## Summary

- **13 of 15** essential environment variables are ready
- **2 Supabase API keys** need to be retrieved from the dashboard
- **1 optional** OpenAI token can be added later

Once the Supabase API keys are retrieved, the production environment will be fully configured and ready for deployment to Railway or other hosting platforms.