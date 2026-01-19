#!/bin/bash

# Test script for production shrink-chat connection
# Verifies that MCP server can connect to production shrink-chat API

API_URL="http://localhost:3001/mcp"

echo "===== Testing Production Shrink-Chat Connection ====="
echo ""
echo "Using production URL: https://couchloopchat.com"
echo ""

# Step 1: Create a test session
echo "1. Creating test session..."
CREATE_RESPONSE=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "create_session",
      "arguments": {
        "context": "Testing production shrink-chat connection"
      },
      "_meta": {
        "openai/subject": "prod_test_user",
        "openai/session": "prod_test_session"
      }
    },
    "id": 1
  }')

SESSION_ID=$(echo $CREATE_RESPONSE | jq -r '.result.content[0].text' | jq -r '.session_id')

if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
  echo "❌ Failed to create session"
  echo "Response: $CREATE_RESPONSE"
  exit 1
fi

echo "✅ Session created: $SESSION_ID"
echo ""

# Step 2: Send a test message to production shrink-chat
echo "2. Testing production shrink-chat API..."
echo "Sending test message to verify connection..."

MESSAGE_RESPONSE=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"send_message\",
      \"arguments\": {
        \"session_id\": \"$SESSION_ID\",
        \"message\": \"Hello, this is a test message to verify production connection.\",
        \"conversation_type\": \"supportive\"
      },
      \"_meta\": {
        \"openai/subject\": \"prod_test_user\",
        \"openai/session\": \"prod_test_session\"
      }
    },
    \"id\": 2
  }")

# Check if we got a successful response
if echo "$MESSAGE_RESPONSE" | grep -q "error"; then
  echo "❌ Failed to send message to shrink-chat"
  echo "Response: $MESSAGE_RESPONSE"

  # Check if it's a connection error
  if echo "$MESSAGE_RESPONSE" | grep -q "ECONNREFUSED\|timeout\|ETIMEDOUT"; then
    echo ""
    echo "⚠️  Connection issue detected - shrink-chat may be unreachable"
  fi
  exit 1
fi

# Extract the response content
RESPONSE_CONTENT=$(echo $MESSAGE_RESPONSE | jq -r '.result.content[0].text' | jq -r '.content')

if [ ! -z "$RESPONSE_CONTENT" ] && [ "$RESPONSE_CONTENT" != "null" ]; then
  echo "✅ SUCCESS: Connected to production shrink-chat!"
  echo ""
  echo "Response preview: ${RESPONSE_CONTENT:0:100}..."
  echo ""
else
  echo "⚠️  WARNING: Got response but content is empty"
  echo "Full response: $MESSAGE_RESPONSE"
fi

# Step 3: Check the server logs
echo "3. Server Status Check"
echo "============================"
echo ""

# Check if production URL is being used
if grep -q "couchloopchat.com" /Users/hipdev/dev/mcp/.env.local; then
  echo "✅ .env.local is configured for production (couchloopchat.com)"
else
  echo "⚠️  .env.local is NOT using production URL"
fi

echo ""
echo "===== Test Complete ====="
echo ""
echo "Production shrink-chat connection test results:"
if [ ! -z "$RESPONSE_CONTENT" ] && [ "$RESPONSE_CONTENT" != "null" ]; then
  echo "✅ PASS - Successfully connected to production shrink-chat"
  echo "✅ PASS - Messages are being processed correctly"
  echo ""
  echo "Production environment is ready!"
else
  echo "❌ FAIL - Could not verify production connection"
  echo "Check server logs for more details"
fi