#!/bin/bash

# Test cross-window session persistence
# Simulates ChatGPT sessions across different chat windows (different conversation IDs)
# but with the same user (same openai/subject)

API_URL="http://localhost:3001/mcp"

echo "===== Testing Cross-Window Session Persistence ====="
echo ""
echo "Simulating same ChatGPT user across different chat windows"
echo "============================================="
echo ""

# Simulate metadata from ChatGPT
OPENAI_SUBJECT="user_abc123xyz"  # This stays the same across all windows
OPENAI_SESSION_1="conv_window_1"  # Different for each chat window
OPENAI_SESSION_2="conv_window_2"  # Different for each chat window

echo "User ID (openai/subject): $OPENAI_SUBJECT"
echo "Window 1 conversation ID: $OPENAI_SESSION_1"
echo "Window 2 conversation ID: $OPENAI_SESSION_2"
echo ""

# Step 1: Create session in first chat window
echo "1. Creating session in Chat Window 1..."
CREATE_RESPONSE=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "create_session",
      "arguments": {
        "context": "Testing cross-window persistence"
      },
      "_meta": {
        "openai/subject": "'$OPENAI_SUBJECT'",
        "openai/session": "'$OPENAI_SESSION_1'"
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

# Step 2: Save a checkpoint
echo "2. Saving checkpoint in Window 1..."
CHECKPOINT_RESPONSE=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"save_checkpoint\",
      \"arguments\": {
        \"session_id\": \"$SESSION_ID\",
        \"key\": \"test_data\",
        \"value\": \"Data saved from window 1\"
      },
      \"_meta\": {
        \"openai/subject\": \"$OPENAI_SUBJECT\",
        \"openai/session\": \"$OPENAI_SESSION_1\"
      }
    },
    \"id\": 2
  }")

if echo "$CHECKPOINT_RESPONSE" | grep -q "error"; then
  echo "❌ Failed to save checkpoint"
  echo "Response: $CHECKPOINT_RESPONSE"
else
  echo "✅ Checkpoint saved"
fi
echo ""

# Step 3: List sessions from DIFFERENT chat window (different conversation ID, same user)
echo "3. Listing sessions from Chat Window 2 (different conversation)..."
LIST_RESPONSE=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "get_sessions",
      "arguments": {},
      "_meta": {
        "openai/subject": "'$OPENAI_SUBJECT'",
        "openai/session": "'$OPENAI_SESSION_2'"
      }
    },
    "id": 3
  }')

# Check if we can see the session
if echo "$LIST_RESPONSE" | grep -q "$SESSION_ID"; then
  echo "✅ SUCCESS: Session visible from different chat window!"
  SESSION_COUNT=$(echo $LIST_RESPONSE | jq -r '.result.content[0].text' | jq '.sessions | length')
  echo "   Found $SESSION_COUNT session(s) for this user"
else
  echo "❌ FAIL: Cannot see session from different window"
  echo "Response: $LIST_RESPONSE"
fi
echo ""

# Step 4: Resume session from different chat window
echo "4. Resuming session from Chat Window 2..."
RESUME_RESPONSE=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"resume_session\",
      \"arguments\": {
        \"session_id\": \"$SESSION_ID\"
      },
      \"_meta\": {
        \"openai/subject\": \"$OPENAI_SUBJECT\",
        \"openai/session\": \"$OPENAI_SESSION_2\"
      }
    },
    \"id\": 4
  }")

if echo "$RESUME_RESPONSE" | grep -q "$SESSION_ID"; then
  echo "✅ SUCCESS: Session resumed from different chat window!"
else
  echo "❌ FAIL: Could not resume session"
  echo "Response: $RESUME_RESPONSE"
fi
echo ""

# Step 5: Read checkpoint from different window
echo "5. Reading checkpoint from Chat Window 2..."
READ_RESPONSE=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"get_checkpoints\",
      \"arguments\": {
        \"session_id\": \"$SESSION_ID\"
      },
      \"_meta\": {
        \"openai/subject\": \"$OPENAI_SUBJECT\",
        \"openai/session\": \"$OPENAI_SESSION_2\"
      }
    },
    \"id\": 5
  }")

if echo "$READ_RESPONSE" | grep -q "Data saved from window 1"; then
  echo "✅ SUCCESS: Can read data saved from Window 1!"
else
  echo "❌ FAIL: Cannot read checkpoint data"
  echo "Response: $READ_RESPONSE"
fi
echo ""

echo "===== Test Summary ====="
echo ""
echo "Cross-Window Session Persistence Test:"
echo "- Same user (openai/subject) across windows: ✓"
echo "- Different conversation IDs per window: ✓"
echo "- Sessions persist across windows: Check results above"
echo ""
echo "The auth fix hashes the user ID (openai/subject) to create"
echo "a stable internal ID that works across all chat windows."
echo "No OpenAI data is stored, just the hash."