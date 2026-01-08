# Quick Start: MCP → Shrink-Chat Integration

## ✅ Completed Setup

1. **Created Integration Files**
   - `src/clients/shrinkChatClient.ts` - API client with circuit breaker
   - `src/tools/sendMessage.ts` - MCP tool for therapeutic messaging
   - `src/utils/circuitBreaker.ts` - Resilience pattern implementation
   - `src/db/migrations/add-thread-mapping.sql` - Database schema updates

2. **Registered send_message Tool**
   - Added to `src/tools/index.ts`
   - Available in MCP protocol with full schema

3. **Documentation**
   - `MCP_SHRINK_CHAT_INTEGRATION_GUIDE.md` - Complete integration guide
   - `CLAUDE.md` - Updated with integration context

## 🚀 Remaining Steps to Complete Integration

### 1. Configure Environment Variables
Create or update `.env.local`:
```bash
# Shrink-Chat Integration
SHRINK_CHAT_API_URL=http://localhost:3000  # Your shrink-chat instance
SHRINK_CHAT_TIMEOUT=30000

# Circuit Breaker
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=60000
CIRCUIT_BREAKER_RESET=30000

# Feature Flags
ENABLE_SHRINK_CHAT_INTEGRATION=true
FALLBACK_TO_LOCAL_PROCESSING=true

# Your existing MCP config
DATABASE_URL=postgresql://...
SUPABASE_URL=...
# etc.
```

### 2. Update Database Schema
Run the migration to add thread mapping:
```bash
# Option 1: Direct SQL
psql $DATABASE_URL < src/db/migrations/add-thread-mapping.sql

# Option 2: Update Drizzle schema and push
npm run db:push
```

### 3. Install Dependencies
```bash
npm install uuid @types/uuid
```

### 4. Start Services
```bash
# Terminal 1: Start shrink-chat (port 3000)
cd ~/dev/shrink-chat
npm run dev

# Terminal 2: Start MCP server
cd ~/dev/mcp
npm run dev
```

### 5. Test the Integration

#### Test via MCP Protocol
```javascript
// Example MCP client usage
const response = await mcp.callTool('send_message', {
  session_id: 'existing-session-uuid',
  message: 'I need help dealing with stress',
  save_checkpoint: true
});

console.log(response.content);      // AI therapeutic response
console.log(response.metadata);     // Crisis level, emotions, etc.
```

#### Test via Direct HTTP
```bash
# Create a session first
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "create_session",
      "arguments": {
        "journey_slug": "daily-reflection"
      }
    }
  }'

# Send a message (use session_id from above)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "send_message",
      "arguments": {
        "session_id": "YOUR_SESSION_ID",
        "message": "I am feeling anxious today"
      }
    }
  }'
```

## 🔍 Verify Integration

### Check Services
```bash
# Verify shrink-chat is running
curl http://localhost:3000/api/health

# Check MCP tools are registered
curl http://localhost:3000/mcp -d '{"jsonrpc":"2.0","method":"tools/list"}'
```

### Monitor Logs
```bash
# Watch MCP logs
tail -f mcp.log

# Look for:
# - "Sending message for session..."
# - "Generated new thread ID..."
# - "Crisis detected: Level X"
```

### Test Crisis Detection
Send a message that triggers crisis detection:
```javascript
{
  session_id: "test-session",
  message: "I'm having thoughts of self-harm",
  save_checkpoint: true
}
// Should return crisis resources and level > 7
```

## 📊 Integration Flow

```
1. User → MCP: send_message tool
2. MCP → Generate/retrieve thread ID
3. MCP → Shrink-Chat: POST /api/shrink
   {
     prompt: "user message",
     threadId: "uuid",
     memoryContext: {...},
     history: [...]
   }
4. Shrink-Chat → Process with AI
5. Shrink-Chat → MCP: Response with crisis detection
6. MCP → Save checkpoint (optional)
7. MCP → User: Formatted response
```

## 🐛 Troubleshooting

### Issue: "Circuit breaker is open"
- Check if shrink-chat is running
- Verify SHRINK_CHAT_API_URL is correct
- Wait 30 seconds for circuit to reset

### Issue: "Session not found"
- Ensure session exists in database
- Check session_id format (must be UUID)

### Issue: No response from shrink-chat
- Verify both services are on same network
- Check for CORS/origin issues
- Review shrink-chat logs

### Issue: Crisis not detected
- Verify response parsing in sendMessage.ts
- Check crisis level threshold (> 7)
- Review shrink-chat crisis detection logic

## 🎯 Success Criteria

- [ ] MCP server starts without errors
- [ ] send_message tool appears in tools list
- [ ] Messages route through shrink-chat
- [ ] Crisis detection triggers at level > 7
- [ ] Checkpoints save successfully
- [ ] Circuit breaker protects against failures
- [ ] Fallback mode works when shrink-chat is down

## 📚 Next Steps

1. **Production Deployment**
   - Set production URLs in environment
   - Configure monitoring/alerting
   - Set up error tracking

2. **Performance Optimization**
   - Implement response caching
   - Add connection pooling
   - Optimize checkpoint queries

3. **Enhanced Features**
   - Streaming responses
   - Batch message processing
   - Advanced crisis workflows

---

For detailed documentation, see:
- [Integration Guide](./MCP_SHRINK_CHAT_INTEGRATION_GUIDE.md)
- [API Documentation](./docs/API.md)
- [Troubleshooting Guide](./docs/TROUBLESHOOTING.md)