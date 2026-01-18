#!/bin/bash

# Railway Environment Variables Setup Script
# Usage:
# 1. First login to Railway: railway login
# 2. Link to your project: railway link
# 3. Run this script: ./set-railway-vars.sh

echo "Setting Railway environment variables for CouchLoop EQ..."

railway variables set \
  DATABASE_URL="postgresql://postgres.tvqjkrghxnxmgaatlnfn:ZBW4naq.unr8qgq*tyx@aws-1-us-east-2.pooler.supabase.com:6543/postgres" \
  SUPABASE_URL="https://tvqjkrghxnxmgaatlnfn.supabase.co" \
  SUPABASE_ANON_KEY="your-publishable-key-here" \
  SUPABASE_SERVICE_ROLE_KEY="your-secret-key-here" \
  OAUTH_CLIENT_ID="couchloop_production" \
  OAUTH_CLIENT_SECRET="BE7/TOG5eUB35sR2GhfefT5Tk+TEiQYOBj4D1xcVXe4=" \
  OAUTH_REDIRECT_URI="https://chat.openai.com/aip/plugin/oauth/callback" \
  PORT="3000" \
  NODE_ENV="production" \
  LOG_LEVEL="info" \
  JWT_SECRET="EhynE9KOoDV/1bLgh9B7C81pQU85uu9Vn/ViXnAthNs=" \
  SHRINK_CHAT_API_URL="https://staging.couchloopchat.com" \
  SHRINK_CHAT_TIMEOUT="30000" \
  SHRINK_CHAT_TIMEOUT_REGULAR="30000" \
  SHRINK_CHAT_TIMEOUT_CRISIS="45000" \
  SHRINK_CHAT_TIMEOUT_STREAM="60000" \
  CIRCUIT_BREAKER_THRESHOLD="5" \
  CIRCUIT_BREAKER_TIMEOUT="60000" \
  CIRCUIT_BREAKER_RESET="30000"

echo "✅ Environment variables set successfully!"
echo "Railway will now redeploy your service with the new variables."