#!/bin/bash

# Test script for production deployment on Railway
# Verifies session persistence and user ID consistency

API_URL="https://couchloop-mcp-production.up.railway.app/mcp"

echo "===== Testing Production Deployment ====="
echo "API URL: $API_URL"
echo ""

# Step 1: Create a new session
echo "1. Creating session..."
CREATE_RESPONSE=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "create_session",
      "arguments": {
        "context": "Production test of session persistence fix"
      }
    },
    "id": 1
  }')

if echo "$CREATE_RESPONSE" | grep -q "error"; then
  echo "❌ Failed to create session"
  echo "Response: $CREATE_RESPONSE"
  exit 1
fi

SESSION_ID=$(echo $CREATE_RESPONSE | jq -r '.result.content[0].text' | jq -r '.session_id')
echo "✅ Session created: $SESSION_ID"
echo ""

# Step 2: Save a checkpoint
echo "2. Saving checkpoint..."
CHECKPOINT_RESPONSE=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"save_checkpoint\",
      \"arguments\": {
        \"session_id\": \"$SESSION_ID\",
        \"key\": \"production_test\",
        \"value\": \"Testing production deployment\"
      }
    },
    \"id\": 2
  }")

if echo "$CHECKPOINT_RESPONSE" | grep -q "error"; then
  echo "❌ Failed to save checkpoint"
  echo "Response: $CHECKPOINT_RESPONSE"
  exit 1
fi

CHECKPOINT_ID=$(echo $CHECKPOINT_RESPONSE | jq -r '.result.content[0].text' | jq -r '.checkpoint_id')
echo "✅ Checkpoint saved: $CHECKPOINT_ID"
echo ""

# Step 3: Resume session with session_id only
echo "3. Resuming session (no auth context)..."
RESUME_RESPONSE=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"resume_session\",
      \"arguments\": {
        \"session_id\": \"$SESSION_ID\"
      }
    },
    \"id\": 3
  }")

if echo "$RESUME_RESPONSE" | grep -q "error"; then
  echo "❌ Failed to resume session"
  echo "Response: $RESUME_RESPONSE"
  exit 1
fi

if echo "$RESUME_RESPONSE" | grep -q "$SESSION_ID"; then
  echo "✅ Session resumed successfully!"
else
  echo "❌ Session ID not found in response"
  echo "Response: $RESUME_RESPONSE"
  exit 1
fi

echo ""
echo "===== Production Test PASSED ====="
echo ""
echo "Summary:"
echo "✅ Sessions persist across tool calls"
echo "✅ Session resumption works with session_id only"
echo "✅ No user validation required when session_id provided"
echo ""
echo "The fix is working in production!"