#!/bin/bash

# Test script for session persistence fix
# Tests that sessions can be resumed using session_id without user validation

API_URL="http://localhost:3001/mcp"

echo "===== Testing Session Persistence Fix ====="
echo ""

# Step 1: Create a new session with auth context
echo "1. Creating session with auth context..."
CREATE_RESPONSE=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "create_session",
      "arguments": {
        "context": "Testing session persistence",
        "auth": {
          "client_id": "test_client",
          "conversation_id": "test_conv_123"
        }
      }
    },
    "id": 1
  }')

echo "Response: $CREATE_RESPONSE"
# Extract session_id from the nested JSON structure using jq
SESSION_ID=$(echo $CREATE_RESPONSE | jq -r '.result.content[0].text' | jq -r '.session_id')
echo "Session ID: $SESSION_ID"
echo ""

# Step 2: Save a checkpoint to the session
echo "2. Saving checkpoint to session..."
CHECKPOINT_RESPONSE=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"save_checkpoint\",
      \"arguments\": {
        \"session_id\": \"$SESSION_ID\",
        \"key\": \"test_checkpoint\",
        \"value\": \"Testing checkpoint save\"
      }
    },
    \"id\": 2
  }")

echo "Response: $CHECKPOINT_RESPONSE"
echo ""

# Step 3: Resume session with session_id (should work without user validation)
echo "3. Resuming session with session_id (no auth context)..."
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

echo "Response: $RESUME_RESPONSE"
echo ""

# Step 4: Check if resume was successful
if echo "$RESUME_RESPONSE" | grep -q "error"; then
  echo "❌ TEST FAILED: Could not resume session with session_id"
  echo "Error details: $RESUME_RESPONSE"
else
  if echo "$RESUME_RESPONSE" | grep -q "$SESSION_ID"; then
    echo "✅ TEST PASSED: Session resumed successfully with session_id!"
  else
    echo "⚠️  TEST UNCLEAR: Response doesn't contain session_id"
    echo "Response: $RESUME_RESPONSE"
  fi
fi

echo ""
echo "===== Test Complete ====="

# Step 5: Test with different auth context (simulating different MCP call)
echo ""
echo "5. Testing with different auth context (simulating new MCP call)..."
DIFFERENT_AUTH_RESPONSE=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"resume_session\",
      \"arguments\": {
        \"session_id\": \"$SESSION_ID\",
        \"auth\": {
          \"client_id\": \"different_client\",
          \"conversation_id\": \"different_conv_456\"
        }
      }
    },
    \"id\": 4
  }")

echo "Response: $DIFFERENT_AUTH_RESPONSE"

if echo "$DIFFERENT_AUTH_RESPONSE" | grep -q "$SESSION_ID"; then
  echo "✅ Session accessible with different auth context (as expected with session_id)"
else
  echo "❌ Could not access session with different auth context"
fi

echo ""
echo "===== All Tests Complete ====="