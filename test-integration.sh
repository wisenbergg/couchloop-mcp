#!/bin/bash

# MCP → Shrink-Chat Integration Test Script

echo "🚀 MCP → Shrink-Chat Integration Test"
echo "======================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if shrink-chat is running
echo "1. Checking if shrink-chat is running on port 3000..."
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health | grep -q "200"; then
    echo -e "${GREEN}✅ Shrink-chat is running${NC}"
else
    echo -e "${RED}❌ Shrink-chat is not running on port 3000${NC}"
    echo -e "${YELLOW}Please start shrink-chat first:${NC}"
    echo "  cd ~/dev/shrink-chat && npm run dev"
    exit 1
fi

echo ""
echo "2. Starting MCP server..."
echo -e "${YELLOW}Run this in a separate terminal:${NC}"
echo "  npm run dev"
echo ""

echo "3. Test Commands:"
echo ""
echo -e "${GREEN}Create a session:${NC}"
cat << 'EOF'
curl -X POST http://localhost:3001 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "create_session",
      "arguments": {
        "journey_slug": "daily-reflection",
        "context": "Testing integration"
      }
    }
  }'
EOF

echo ""
echo -e "${GREEN}Send a message (replace SESSION_ID):${NC}"
cat << 'EOF'
curl -X POST http://localhost:3001 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "send_message",
      "arguments": {
        "session_id": "SESSION_ID_HERE",
        "message": "I am feeling anxious today",
        "save_checkpoint": true
      }
    }
  }'
EOF

echo ""
echo -e "${GREEN}Test crisis detection (replace SESSION_ID):${NC}"
cat << 'EOF'
curl -X POST http://localhost:3001 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "send_message",
      "arguments": {
        "session_id": "SESSION_ID_HERE",
        "message": "I am having thoughts of self-harm",
        "save_checkpoint": true
      }
    }
  }'
EOF

echo ""
echo "======================================"
echo -e "${YELLOW}Note:${NC} Make sure both services are running before testing"
echo "  1. Shrink-chat on port 3000"
echo "  2. MCP server on port 3001"