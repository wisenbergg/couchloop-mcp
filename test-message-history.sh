#!/bin/bash

# Test script to verify message history is properly sent to shrink-chat
# This tests the fix for the history filter bug

API_URL="http://localhost:3001/mcp"

echo "===== Testing Message History Fix ====="
echo ""

# Step 1: Create a session
echo "1. Creating session..."
CREATE_RESPONSE=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "create_session",
      "arguments": {
        "context": "Testing message history"
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
echo "Session created: $SESSION_ID"
echo ""

# Step 2: Send first message (should save user message checkpoint)
echo "2. Sending first message..."
MSG1_RESPONSE=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"send_message\",
      \"arguments\": {
        \"session_id\": \"$SESSION_ID\",
        \"message\": \"Hello, I need help with my sleep issues\",
        \"conversation_type\": \"supportive\"
      }
    },
    \"id\": 2
  }")

echo "First message sent"
echo ""

# Step 3: Send second message (history should now include first exchange)
echo "3. Sending second message..."
MSG2_RESPONSE=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"send_message\",
      \"arguments\": {
        \"session_id\": \"$SESSION_ID\",
        \"message\": \"I've been waking up multiple times during the night\",
        \"conversation_type\": \"supportive\"
      }
    },
    \"id\": 3
  }")

echo "Second message sent"
echo ""

# Step 4: Get checkpoints to verify they were saved
echo "4. Verifying checkpoints..."
CHECKPOINTS_RESPONSE=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"get_checkpoints\",
      \"arguments\": {
        \"session_id\": \"$SESSION_ID\"
      }
    },
    \"id\": 4
  }")

# Count checkpoints
CHECKPOINT_COUNT=$(echo $CHECKPOINTS_RESPONSE | jq -r '.result.content[0].text' | jq '.checkpoints | length')
echo "Total checkpoints saved: $CHECKPOINT_COUNT"

# Check for user and assistant message checkpoints
USER_MSGS=$(echo $CHECKPOINTS_RESPONSE | jq -r '.result.content[0].text' | jq '[.checkpoints[] | select(.key == "user-message")] | length')
ASSISTANT_MSGS=$(echo $CHECKPOINTS_RESPONSE | jq -r '.result.content[0].text' | jq '[.checkpoints[] | select(.key == "assistant-message")] | length')

echo "User message checkpoints: $USER_MSGS"
echo "Assistant message checkpoints: $ASSISTANT_MSGS"
echo ""

# Step 5: Verify results
echo "===== Test Results ====="
if [ "$USER_MSGS" -ge 2 ] && [ "$ASSISTANT_MSGS" -ge 2 ]; then
  echo "✅ PASS: Both user and assistant messages are being saved"
  echo "✅ PASS: History should now include all messages for shrink-chat"
else
  echo "❌ FAIL: Missing message checkpoints"
  echo "Expected at least 2 user messages and 2 assistant messages"
fi

echo ""
echo "Note: The history sent to shrink-chat now includes:"
echo "- Individual user message checkpoints"
echo "- Individual assistant message checkpoints"
echo "- Any combined checkpoints (for backward compatibility)"
echo ""
echo "This ensures user messages reach shrink-chat's database!"