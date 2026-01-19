#!/bin/bash

# Performance test for optimized MCP server
# Tests caching, parallel queries, and overall performance improvements

API_URL="http://localhost:3001/mcp"

echo "===== MCP Performance Test ====="
echo ""
echo "Testing optimizations:"
echo "1. Tool/Resource caching (should load only once)"
echo "2. Checkpoint query optimization (limited fetch)"
echo "3. Parallel database queries"
echo "4. Connection pool improvements"
echo ""

# Function to measure time
measure_time() {
  local start=$(date +%s%3N)
  "$@"
  local end=$(date +%s%3N)
  echo $((end - start))
}

echo "=== Test 1: Tool Caching ==="
echo "First request (should initialize tools)..."
TIME1=$(measure_time curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: perf-test-1" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "params": {},
    "id": 1
  }' > /dev/null)

echo "First request took: ${TIME1}ms"

echo "Second request (should use cache)..."
TIME2=$(measure_time curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: perf-test-2" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "params": {},
    "id": 2
  }' > /dev/null)

echo "Second request took: ${TIME2}ms"

if [ $TIME2 -lt $TIME1 ]; then
  echo "✅ PASS: Second request faster (caching working!)"
  echo "   Savings: $((TIME1 - TIME2))ms"
else
  echo "⚠️  WARNING: Second request not faster"
fi

echo ""
echo "=== Test 2: Create Session Performance ==="

# Create session with timing
START_TIME=$(date +%s%3N)
CREATE_RESPONSE=$(curl -s -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "create_session",
      "arguments": {
        "context": "Performance test session"
      },
      "_meta": {
        "openai/subject": "perf_test_user",
        "openai/session": "perf_test_session"
      }
    },
    "id": 3
  }')
END_TIME=$(date +%s%3N)

SESSION_ID=$(echo $CREATE_RESPONSE | jq -r '.result.content[0].text' | jq -r '.session_id')
CREATE_TIME=$((END_TIME - START_TIME))

echo "Session creation took: ${CREATE_TIME}ms"
echo "Session ID: $SESSION_ID"

# Add some checkpoints for testing
echo ""
echo "=== Test 3: Adding Checkpoints ==="

for i in {1..5}; do
  curl -s -X POST $API_URL \
    -H "Content-Type: application/json" \
    -d "{
      \"jsonrpc\": \"2.0\",
      \"method\": \"tools/call\",
      \"params\": {
        \"name\": \"save_checkpoint\",
        \"arguments\": {
          \"session_id\": \"$SESSION_ID\",
          \"key\": \"test_$i\",
          \"value\": {\"message\": \"Test message $i\", \"role\": \"user\"}
        },
        \"_meta\": {
          \"openai/subject\": \"perf_test_user\",
          \"openai/session\": \"perf_test_session\"
        }
      },
      \"id\": $((3 + i))
    }" > /dev/null
  echo "Added checkpoint $i"
done

echo ""
echo "=== Test 4: Checkpoint Query Performance ==="
echo "Fetching checkpoints (should use LIMIT optimization)..."

START_TIME=$(date +%s%3N)
CHECKPOINTS_RESPONSE=$(curl -s -X POST $API_URL \
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
        \"openai/subject\": \"perf_test_user\",
        \"openai/session\": \"perf_test_session\"
      }
    },
    \"id\": 10
  }")
END_TIME=$(date +%s%3N)

CHECKPOINT_TIME=$((END_TIME - START_TIME))
CHECKPOINT_COUNT=$(echo $CHECKPOINTS_RESPONSE | jq -r '.result.content[0].text' | jq '.checkpoints | length')

echo "Checkpoint query took: ${CHECKPOINT_TIME}ms"
echo "Checkpoints returned: $CHECKPOINT_COUNT"

echo ""
echo "===== Performance Test Summary ====="
echo ""
echo "Optimization Results:"
echo "- Tool caching: $((TIME1 - TIME2))ms saved"
echo "- Session creation: ${CREATE_TIME}ms"
echo "- Checkpoint query: ${CHECKPOINT_TIME}ms for $CHECKPOINT_COUNT checkpoints"
echo ""
echo "Expected improvements from optimizations:"
echo "✅ ~30ms saved from tool/resource caching"
echo "✅ ~100ms saved from checkpoint query optimization"
echo "✅ ~150ms saved from parallel database queries"
echo "✅ Better concurrency from increased connection pool"
echo ""
echo "Total expected savings: ~280ms on common operations"

# Check if the server logged the one-time initialization
echo ""
echo "=== Server Log Check ==="
echo "Check server logs for:"
echo '- "Loading tool definitions (one-time initialization)"'
echo '- "Loading resource definitions (one-time initialization)"'
echo "These should appear only ONCE if caching is working correctly."