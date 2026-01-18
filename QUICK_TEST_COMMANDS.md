# Quick Test Commands for CouchLoop MCP

## Direct API Testing with cURL

### 1. List Available Tools
```bash
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}' | jq
```

### 2. List Available Resources
```bash
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"resources/list","params":{},"id":2}' | jq
```

### 3. Create a New Session
```bash
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "create_session",
      "arguments": {
        "context": "Testing MCP integration"
      }
    },
    "id": 3
  }' | jq
```

### 4. Create Session with Journey
```bash
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "create_session",
      "arguments": {
        "journey_slug": "daily-reflection",
        "context": "Evening reflection"
      }
    },
    "id": 4
  }' | jq
```

### 5. Save a Checkpoint (use session_id from create_session response)
```bash
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "save_checkpoint",
      "arguments": {
        "session_id": "YOUR_SESSION_ID",
        "key": "test_checkpoint",
        "value": "Testing checkpoint functionality",
        "advance_step": false
      }
    },
    "id": 5
  }' | jq
```

### 6. Send Therapeutic Message
```bash
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "send_message",
      "arguments": {
        "session_id": "YOUR_SESSION_ID",
        "message": "I feel overwhelmed with work stress",
        "conversation_type": "therapeutic",
        "save_checkpoint": true,
        "checkpoint_key": "stress_discussion"
      }
    },
    "id": 6
  }' | jq
```

### 7. Resume Session
```bash
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "resume_session",
      "arguments": {}
    },
    "id": 7
  }' | jq
```

### 8. Get Journey Status
```bash
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "get_journey_status",
      "arguments": {
        "session_id": "YOUR_SESSION_ID"
      }
    },
    "id": 8
  }' | jq
```

### 9. Save an Insight
```bash
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "save_insight",
      "arguments": {
        "content": "I work best in the morning before checking emails",
        "tags": ["productivity", "morning", "focus"]
      }
    },
    "id": 9
  }' | jq
```

### 10. Get User Context
```bash
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "get_user_context",
      "arguments": {
        "include_recent_insights": true,
        "include_session_history": true
      }
    },
    "id": 10
  }' | jq
```

### 11. Get a Specific Journey Resource
```bash
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "resources/read",
    "params": {
      "uri": "journey://daily-reflection"
    },
    "id": 11
  }' | jq
```

### 12. Get Current Session Resource
```bash
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "resources/read",
    "params": {
      "uri": "session://current"
    },
    "id": 12
  }' | jq
```

## Testing Workflow Sequences

### Complete Daily Reflection Journey
```bash
# Step 1: Create session with journey
SESSION_RESPONSE=$(curl -s -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "create_session",
      "arguments": {
        "journey_slug": "daily-reflection"
      }
    },
    "id": 100
  }')

SESSION_ID=$(echo $SESSION_RESPONSE | jq -r '.result.session_id')
echo "Session ID: $SESSION_ID"

# Step 2: Save energy level
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"save_checkpoint\",
      \"arguments\": {
        \"session_id\": \"$SESSION_ID\",
        \"key\": \"energy_level\",
        \"value\": {\"rating\": 8, \"note\": \"Feeling energized\"},
        \"advance_step\": true
      }
    },
    \"id\": 101
  }" | jq

# Step 3: Check journey progress
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"get_journey_status\",
      \"arguments\": {
        \"session_id\": \"$SESSION_ID\"
      }
    },
    \"id\": 102
  }" | jq
```

### Test Crisis Detection
```bash
# Create session
SESSION_ID="test_session_123"

# Send message that might trigger crisis detection
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"send_message\",
      \"arguments\": {
        \"session_id\": \"$SESSION_ID\",
        \"message\": \"I'm feeling really anxious and overwhelmed today\",
        \"conversation_type\": \"therapeutic\"
      }
    },
    \"id\": 200
  }" | jq '.result.response'
```

## ChatGPT Quick Tests

When connected via ChatGPT Developer Mode, try these prompts:

1. **Basic Session**: "Start a new session for career planning"
2. **Journey**: "I want to do a daily reflection"
3. **Therapeutic**: "I need to talk about my anxiety"
4. **Resume**: "Can we continue our earlier conversation?"
5. **Insights**: "What insights have I shared recently?"
6. **Context**: "What do you know about my preferences?"
7. **Journey List**: "What guided journeys are available?"
8. **Save Progress**: "Let's save this as an important realization"
9. **Multi-session**: "Pause this and start a new session about fitness"
10. **Status Check**: "Where are we in the current journey?"

## Error Testing

### Test Invalid Session ID
```bash
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "get_checkpoints",
      "arguments": {
        "session_id": "invalid_session_id_12345"
      }
    },
    "id": 300
  }' | jq
```

### Test Invalid Journey Slug
```bash
curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "create_session",
      "arguments": {
        "journey_slug": "non_existent_journey"
      }
    },
    "id": 301
  }' | jq
```

## Performance Testing

### Rapid Sequential Calls
```bash
for i in {1..5}; do
  curl -X POST https://couchloop-mcp-production.up.railway.app/mcp \
    -H "Content-Type: application/json" \
    -d "{
      \"jsonrpc\": \"2.0\",
      \"method\": \"tools/call\",
      \"params\": {
        \"name\": \"save_insight\",
        \"arguments\": {
          \"content\": \"Test insight $i\",
          \"tags\": [\"test\"]
        }
      },
      \"id\": $i
    }" &
done
wait
```

## Monitoring

### Check Health
```bash
curl https://couchloop-mcp-production.up.railway.app/health | jq
```

### View Logs (if you have Railway CLI)
```bash
railway logs --tail 20
```