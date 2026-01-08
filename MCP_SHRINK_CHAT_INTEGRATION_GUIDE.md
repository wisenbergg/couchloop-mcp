# MCP → Shrink-Chat Integration Guide

## Overview

This guide documents the integration between the CouchLoop MCP Server (Model Context Protocol) and the Shrink-Chat therapeutic backend. The integration enables MCP to leverage Shrink-Chat's therapeutic AI capabilities, crisis detection, and conversation management while maintaining MCP's journey orchestration and session management features.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    AI Agents                             │
│            (ChatGPT, Claude, etc.)                       │
└────────────────────────┬─────────────────────────────────┘
                         │ MCP Protocol
                         ▼
┌─────────────────────────────────────────────────────────┐
│              CouchLoop MCP Server                        │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Tools:                                           │   │
│  │  • create_session - Start journey/session        │   │
│  │  • send_message - Therapeutic messaging ━━━━━━━━━╋━━━╋━━━━━┐
│  │  • save_checkpoint - Progress tracking           │   │     │
│  │  • resume_session - Continue journeys            │   │     │
│  │  • get_insights - User reflections              │   │     │
│  └──────────────────────────────────────────────────┘   │     │
│                                                          │     │
│  ┌──────────────────────────────────────────────────┐   │     │
│  │ Database (PostgreSQL):                           │   │     │
│  │  • sessions (with threadId mapping)              │   │     │
│  │  • journeys                                      │   │     │
│  │  • checkpoints                                   │   │     │
│  │  • insights                                      │   │     │
│  └──────────────────────────────────────────────────┘   │     │
└─────────────────────────────────────────────────────────┘     │
                                                                 │
                         HTTP/HTTPS                              │
                         ▼                                       │
┌─────────────────────────────────────────────────────────┐     │
│              Shrink-Chat Backend                        │◄────┘
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ POST /api/shrink                                 │   │
│  │  • Therapeutic AI processing                     │   │
│  │  • Crisis detection (0-10 scale)                 │   │
│  │  • Emotion analysis                              │   │
│  │  • Memory management                             │   │
│  │  • Guardrails & safety                          │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## API Compatibility

### Shrink-Chat API Specification

**Endpoint**: `POST /api/shrink`

#### Request Format
```typescript
{
  prompt: string;           // User's message (required)
  threadId: string;        // Conversation thread ID (required)
  memoryContext?: string;  // JSON string of session metadata
  enhancedContext?: {      // Additional context
    sessionId?: string;
    journeyId?: string;
    journeySlug?: string;
    currentStep?: number;
    sessionStatus?: string;
  };
  history?: Array<{        // Conversation history
    role: 'user' | 'assistant';
    content: string;
  }>;
  systemPrompt?: string;   // Custom system prompt
  conversationType?: string; // Type of conversation
  idempotencyKey?: string; // Request idempotency
}
```

#### Response Format
```typescript
{
  content?: string;              // AI response
  messageId?: string;            // Unique message ID
  crisisDetected?: boolean;      // Crisis flag
  crisisLevel?: number;          // 0-10 scale
  emotions?: string[];           // Detected emotions
  therapeuticTechnique?: string; // Technique used
  resources?: Array<{            // Crisis resources
    type: string;
    title: string;
    url?: string;
    phone?: string;
    description?: string;
  }>;
  escalationPath?: string;      // Crisis escalation
  confidence?: number;           // Response confidence
  error?: string;               // Error message
  error_type?: string;          // Error type
}
```

#### Streaming Support
Add `?stream=true` query parameter for Server-Sent Events (SSE) streaming.

## Implementation Components

### 1. Shrink-Chat Client (`/src/clients/shrinkChatClient.ts`)

The client handles all communication with the Shrink-Chat backend:

```typescript
import { getShrinkChatClient } from '../clients/shrinkChatClient.js';

const client = getShrinkChatClient();

// Send a message
const response = await client.sendMessage(
  prompt,      // User's message
  threadId,    // Thread ID (generated client-side)
  {
    memoryContext: JSON.stringify(sessionData),
    enhancedContext: { sessionId, journeyId },
    history: conversationHistory,
    systemPrompt: customPrompt,
    conversationType: 'therapeutic',
    idempotencyKey: uuidv4()
  }
);

// Stream a response
for await (const chunk of client.streamMessage(prompt, threadId, options)) {
  console.log(chunk.content);
}
```

**Key Features:**
- Circuit breaker pattern for resilience
- Automatic retry with exponential backoff
- Request timeout handling
- Crisis detection logging
- Thread ID generation (client-side)

### 2. Send Message Tool (`/src/tools/sendMessage.ts`)

The MCP tool that integrates with Shrink-Chat:

```typescript
// Tool input schema
{
  session_id: string;          // MCP session ID
  message: string;             // User's message
  save_checkpoint?: boolean;   // Save to checkpoint
  checkpoint_key?: string;     // Custom checkpoint key
  advance_step?: boolean;      // Advance journey step
  include_memory?: boolean;    // Include session metadata
  system_prompt?: string;      // Custom system prompt
  conversation_type?: string;  // Conversation type
}

// Tool output
{
  success: boolean;
  content: string;             // AI response
  messageId?: string;
  metadata: {
    crisisDetected?: boolean;
    crisisLevel?: number;
    crisisHandled?: boolean;
    emotions?: string[];
    therapeuticTechnique?: string;
    resources?: any[];
    sessionId: string;
    threadId: string;
    currentStep: number;
  };
  timestamp: string;
}
```

### 3. Circuit Breaker (`/src/utils/circuitBreaker.ts`)

Protects against cascading failures:

```typescript
const breaker = new CircuitBreaker(
  threshold: 5,        // Failures before opening
  timeout: 60000,      // Open state duration
  resetTimeout: 30000  // Half-open retry interval
);

// States: closed → open → half-open → closed
```

### 4. Database Schema Updates

```sql
-- Add thread mapping to sessions
ALTER TABLE sessions
ADD COLUMN thread_id TEXT,
ADD COLUMN last_synced_at TIMESTAMP;

-- Thread mappings table
CREATE TABLE thread_mappings (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  thread_id TEXT NOT NULL,
  source TEXT CHECK (source IN ('mcp', 'shrink-chat')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB
);

-- Crisis events table
CREATE TABLE crisis_events (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  thread_id TEXT,
  crisis_level NUMERIC CHECK (crisis_level BETWEEN 0 AND 10),
  response TEXT,
  resources JSONB,
  escalation_path TEXT,
  handled BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Configuration

### Environment Variables

Add to `.env.local`:

```bash
# Shrink-Chat Integration
SHRINK_CHAT_API_URL=http://localhost:3000  # Shrink-Chat backend URL
SHRINK_CHAT_TIMEOUT=30000                  # Request timeout (ms)

# Circuit Breaker Configuration
CIRCUIT_BREAKER_THRESHOLD=5                # Failures before opening
CIRCUIT_BREAKER_TIMEOUT=60000              # Open state duration (ms)
CIRCUIT_BREAKER_RESET=30000                # Half-open retry interval (ms)

# Feature Flags
ENABLE_SHRINK_CHAT_INTEGRATION=true        # Enable integration
FALLBACK_TO_LOCAL_PROCESSING=true          # Fallback when unavailable
```

### Register Tool in MCP Server

In `/src/index.ts`:

```typescript
import { sendMessage } from './tools/sendMessage.js';

// In ListTools handler
{
  name: 'send_message',
  description: 'Send a message through the therapeutic AI stack',
  inputSchema: {
    type: 'object',
    properties: {
      session_id: { type: 'string' },
      message: { type: 'string' },
      save_checkpoint: { type: 'boolean' },
      advance_step: { type: 'boolean' }
    },
    required: ['session_id', 'message']
  }
}

// In CallTool handler
case 'send_message':
  return sendMessage(request.params.arguments);
```

## Key Integration Points

### 1. Thread Management
- **Thread IDs are generated client-side** (UUID v4)
- **Threads are created lazily** in Shrink-Chat on first message
- MCP sessions map to Shrink-Chat threads via `threadId` field
- No separate thread creation endpoint needed

### 2. Crisis Detection
- Automatic detection on messages with crisis level > 7
- Crisis events logged to database
- Resources provided for user support
- Session metadata updated with crisis flags

### 3. Journey Integration
- Journey context passed via `enhancedContext`
- Progress tracked through checkpoints
- Steps advanced after therapeutic responses
- Journey-aware system prompts supported

### 4. Conversation History
- Last 5 checkpoint exchanges included as history
- Provides context for therapeutic responses
- Maintains conversation continuity

### 5. Error Handling
- Circuit breaker prevents cascade failures
- Fallback to local processing when unavailable
- Request timeouts prevent hanging
- Comprehensive error logging

## Testing

### Unit Tests
```bash
# Run tests
npm test

# Test specific components
npm test -- shrinkChatClient
npm test -- sendMessage
npm test -- circuitBreaker
```

### Integration Testing
```typescript
// Test send_message tool
const result = await sendMessage({
  session_id: 'test-session-uuid',
  message: 'I am feeling anxious today',
  save_checkpoint: true
});

expect(result.success).toBe(true);
expect(result.content).toBeDefined();
expect(result.metadata.threadId).toBeDefined();
```

### End-to-End Testing
1. Start Shrink-Chat backend: `cd shrink-chat && npm run dev`
2. Start MCP server: `cd mcp && npm run dev`
3. Test via MCP client or direct API calls

## Deployment Checklist

- [ ] Configure production environment variables
- [ ] Run database migrations
- [ ] Verify Shrink-Chat backend connectivity
- [ ] Test circuit breaker thresholds
- [ ] Enable monitoring for API latency
- [ ] Set up error alerting
- [ ] Test crisis detection flow
- [ ] Verify fallback processing
- [ ] Load test integration endpoints
- [ ] Document API rate limits

## Monitoring Metrics

### Key Metrics to Track
- **API Latency**: p50, p95, p99 response times
- **Circuit Breaker State**: open/closed/half-open transitions
- **Crisis Detection Rate**: Frequency and levels
- **Thread Creation**: Success/failure rates
- **Message Volume**: Requests per minute/hour
- **Error Rates**: By type and endpoint

### Recommended Dashboards
1. **System Health**: API status, circuit breaker state
2. **Performance**: Latency, throughput, error rates
3. **Crisis Monitoring**: Detection rates, resource usage
4. **User Experience**: Response times, success rates

## Troubleshooting

### Common Issues

#### 1. Circuit Breaker Opens Frequently
- Check Shrink-Chat backend health
- Verify network connectivity
- Adjust threshold and timeout settings
- Review error logs for root cause

#### 2. Thread ID Mismatches
- Ensure consistent UUID generation
- Check database thread mappings
- Verify session-thread relationships

#### 3. Crisis Detection Not Working
- Verify crisis level thresholds (> 7)
- Check response parsing
- Review crisis event logging
- Test with known crisis triggers

#### 4. High Latency
- Check Shrink-Chat response times
- Verify network latency
- Consider implementing caching
- Review database query performance

## Migration Guide

### From Standalone MCP to Integrated

1. **Update Environment**
   ```bash
   # Add Shrink-Chat configuration
   SHRINK_CHAT_API_URL=https://your-shrink-chat.com
   ENABLE_SHRINK_CHAT_INTEGRATION=true
   ```

2. **Run Database Migration**
   ```bash
   # Add thread mapping columns
   npm run db:push
   ```

3. **Update Existing Sessions** (optional)
   ```typescript
   // Migration script to add thread IDs
   const sessions = await db.query.sessions.findMany();
   for (const session of sessions) {
     if (!session.threadId) {
       await db.update(sessions)
         .set({ threadId: uuidv4() })
         .where(eq(sessions.id, session.id));
     }
   }
   ```

4. **Test Integration**
   ```bash
   # Verify connectivity
   curl -X POST http://localhost:3000/api/health

   # Test message sending
   npm run test:integration
   ```

## Security Considerations

1. **Origin Checking**: Shrink-Chat validates request origins
2. **Rate Limiting**: Built-in rate limiting per IP and thread
3. **Input Validation**: Zod schemas validate all inputs
4. **Crisis Safety**: Automatic guardrails for crisis situations
5. **Data Privacy**: No PHI storage, thread IDs are anonymous
6. **Circuit Breaker**: Prevents resource exhaustion

## Future Enhancements

- [ ] Implement response caching
- [ ] Add WebSocket support for real-time updates
- [ ] Enhanced crisis escalation workflows
- [ ] Multi-model support (GPT-4, Claude, etc.)
- [ ] Advanced analytics integration
- [ ] Batch message processing
- [ ] Conversation summarization
- [ ] Proactive intervention triggers

## Support

For issues or questions:
- GitHub Issues: [MCP Repository](https://github.com/yourusername/couchloop-mcp)
- Documentation: [Full API Docs](./docs/API.md)
- Shrink-Chat Docs: [Integration Guide](./docs/SHRINK_CHAT.md)

## References

- [Model Context Protocol Specification](https://github.com/anthropics/mcp)
- [Shrink-Chat API Documentation](./docs/shrink-chat-api.md)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [PostgreSQL JSON Documentation](https://www.postgresql.org/docs/current/datatype-json.html)