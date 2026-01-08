# MCP → Shrink-Chat Integration Guide

> **Last Updated**: January 8, 2026  
> **Validated Against**: shrink-chat `staging` branch  
> **Document Version**: 2.0 (Corrected)

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
│  │  • Crisis detection (5-level enum)               │   │
│  │  • Emotion analysis                              │   │
│  │  • Vector memory management                      │   │
│  │  • Guardrails & safety                          │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## API Compatibility

### Shrink-Chat API Specification

**Endpoint**: `POST /api/shrink`

**Streaming**: Add `?stream=true` query parameter for Server-Sent Events (SSE).

#### Request Format

```typescript
interface ShrinkChatRequest {
  // REQUIRED FIELDS
  prompt: string;              // User's message (required)
  threadId: string;            // Conversation thread ID - UUID v4 (required)
  
  // OPTIONAL FIELDS
  memoryContext?: string;      // Additional context (server handles vector memory automatically)
  enhancedContext?: {          // Additional context for journey/session tracking
    sessionId?: string;
    journeyId?: string;
    journeySlug?: string;
    currentStep?: number;
    sessionStatus?: string;
    voiceController?: {        // Internal - auto-populated by server
      state?: string;
      primer?: string;
    };
  };
  history?: Array<{            // Conversation history (server auto-retrieves if not provided)
    role: 'user' | 'assistant';
    content: string;
  }>;
  systemPrompt?: string;       // Custom system prompt (maps to customSystemPrompt internally)
  conversationType?: string;   // Type of conversation (e.g., 'therapist-finder')
  idempotencyKey?: string;     // Request idempotency - prevents duplicate messages
}
```

#### Response Format (Non-Streaming)

```typescript
interface ShrinkChatResponse {
  // PRIMARY RESPONSE
  response_text: string;       // The AI therapeutic response
  messageId: string;           // UUID of the logged message
  idempotencyKey: string;      // Idempotency key used (for retry verification)
  
  // VOICE CONTROLLER METADATA
  meta: {
    state: 'greeting' | 'checking_in' | 'conversing' | 'deepening' | 'closing';
    tone_tags: string[];       // e.g., ['empathy', 'validation', 'curiosity']
    rag_confidence: number;    // 0.0-1.0 memory retrieval confidence
    rag_low: boolean;          // True if memory context is thin
    used_personalization: boolean;
    questions_in_turn: number;
    disengaged: boolean;
    solution_first_applied?: boolean;
    generic_guidance_used?: boolean;
  };
  
  // MEMORY COUNTERS
  memory_high_relevance_count: number;
  memory_contextual_count: number;
  
  // CRISIS DETECTION (5-level enum, NOT numeric 0-10)
  crisis_level: 'none' | 'concern' | 'elevated' | 'high' | 'critical';
  crisis_confidence: number;           // 0.0-1.0
  crisis_requires_intervention: boolean;
  crisis_indicators: string[];         // Matched patterns (anonymized)
  crisis_suggested_actions: string[];  // Recommended interventions
  
  // ERROR FIELDS (only on failure)
  message?: string;            // Error message
  error_type?: 'bad_request' | 'timeout' | 'rate_limited' | 'server_error';
}
```

#### Streaming Response Format (SSE)

When `?stream=true` is set, the response is Server-Sent Events:

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"type":"chunk","content":"I can sense that ","done":false,"messageId":"uuid-here"}

data: {"type":"chunk","content":"perfectionism can create ","done":false,"messageId":"uuid-here"}

data: {"type":"chunk","content":"a lot of internal pressure.","done":false,"messageId":"uuid-here"}

data: {"type":"done","content":"Full response text here...","done":true,"messageId":"uuid-here","meta":{...},"crisis_level":"none"}
```

**Stream Event Types:**
- `chunk` - Incremental text content (done=false)
- `done` - Final event with complete response and metadata (done=true)
- `error` - Error occurred during streaming

#### Crisis Level Definitions

| Level | Description | Intervention |
|-------|-------------|--------------|
| `none` | No crisis indicators detected | Normal conversation flow |
| `concern` | Mild concerning language | Enhanced monitoring, gentle check-in |
| `elevated` | Moderate risk indicators | Empathetic response, offer resources |
| `high` | Significant crisis signals | Provide crisis resources (988), stay present |
| `critical` | Explicit suicidal/self-harm content | Immediate crisis intervention, resources, safety planning |

## Implementation Components

### 1. Shrink-Chat Client (`/src/clients/shrinkChatClient.ts`)

The client handles all communication with the Shrink-Chat backend:

```typescript
import { getShrinkChatClient } from '../clients/shrinkChatClient.js';

const client = getShrinkChatClient();

// Send a message (non-streaming)
const response = await client.sendMessage(
  prompt,      // User's message
  threadId,    // Thread ID (UUID v4, generated client-side)
  {
    memoryContext: JSON.stringify(sessionData),
    enhancedContext: { sessionId, journeyId },
    history: conversationHistory,
    systemPrompt: customPrompt,
    conversationType: 'therapeutic',
    idempotencyKey: uuidv4()
  }
);

// Access response fields correctly
console.log(response.response_text);  // NOT .content
console.log(response.crisis_level);   // String enum, NOT numeric
console.log(response.meta.state);     // Voice controller state

// Stream a response
for await (const chunk of client.streamMessage(prompt, threadId, options)) {
  if (chunk.type === 'chunk') {
    process.stdout.write(chunk.content);
  } else if (chunk.type === 'done') {
    console.log('Crisis level:', chunk.crisis_level);
  }
}
```

**Key Features:**
- Circuit breaker pattern for resilience
- Automatic retry with exponential backoff
- Request timeout handling (30s default)
- Crisis detection logging
- Thread ID generation (client-side UUID v4)

### 2. Send Message Tool (`/src/tools/sendMessage.ts`)

The MCP tool that integrates with Shrink-Chat:

```typescript
// Tool input schema
interface SendMessageInput {
  session_id: string;          // MCP session ID
  message: string;             // User's message
  save_checkpoint?: boolean;   // Save to checkpoint after response
  checkpoint_key?: string;     // Custom checkpoint key
  advance_step?: boolean;      // Advance journey step
  include_memory?: boolean;    // Include session metadata
  system_prompt?: string;      // Custom system prompt
  conversation_type?: string;  // Conversation type
}

// Tool output (maps from Shrink-Chat response)
interface SendMessageOutput {
  success: boolean;
  content: string;             // Mapped from response_text
  messageId?: string;
  metadata: {
    crisisDetected: boolean;   // crisis_level !== 'none'
    crisisLevel: string;       // 'none' | 'concern' | 'elevated' | 'high' | 'critical'
    crisisHandled?: boolean;
    sessionId: string;
    threadId: string;
    currentStep: number;
    voiceState?: string;       // From meta.state
    toneTags?: string[];       // From meta.tone_tags
  };
  timestamp: string;
}
```

### 3. Circuit Breaker (`/src/utils/circuitBreaker.ts`)

Protects against cascading failures:

```typescript
const breaker = new CircuitBreaker({
  threshold: 5,        // Failures before opening
  timeout: 60000,      // Open state duration (ms)
  resetTimeout: 30000  // Half-open retry interval (ms)
});

// States: CLOSED → OPEN → HALF_OPEN → CLOSED
```

### 4. Database Schema Updates (MCP-side)

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

-- Crisis events table (local logging)
CREATE TABLE crisis_events (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  thread_id TEXT,
  crisis_level TEXT CHECK (crisis_level IN ('none', 'concern', 'elevated', 'high', 'critical')),
  response TEXT,
  resources JSONB,
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

### Production URLs

| Environment | URL |
|-------------|-----|
| Local | `http://localhost:3000` |
| Staging | `https://staging.couchloopchat.com` |
| Production | `https://couchloopchat.com` |

> **Note**: There is no `api.` subdomain. Use the root domain directly.

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
      session_id: { type: 'string', description: 'MCP session ID' },
      message: { type: 'string', description: 'User message' },
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
- **Threads are created lazily** in Shrink-Chat on first message via `ensureThreadAndProfile()`
- MCP sessions map to Shrink-Chat threads via `threadId` field
- No separate thread creation endpoint needed

### 2. ThreadId Resolution (Shrink-Chat side)
Priority order:
1. `X-Thread-Id` header
2. URL route parameter
3. Query parameter: `?threadId=`
4. Request body field: `threadId`
5. Cookie: `sw_uid`

### 3. Crisis Detection
- Automatic detection with 5-level enum (NOT 0-10 numeric)
- Crisis events logged to database with anonymized indicators
- Resources provided for `high` and `critical` levels
- Session metadata updated with crisis flags
- Idempotency keys prefixed with `crisis:` bypass duplicate suppression

### 4. Journey Integration
- Journey context passed via `enhancedContext`
- Progress tracked through checkpoints
- Steps advanced after therapeutic responses
- Journey-aware system prompts supported via `systemPrompt` field

### 5. Conversation History
- Server auto-retrieves last 10 messages from database
- Client can optionally provide `history` array
- Maintains conversation continuity across sessions

### 6. Memory System
- Vector memory retrieval is automatic (pgvector-based)
- Client does not need to manage embeddings
- Response includes `memory_high_relevance_count` and `memory_contextual_count`
- `meta.rag_low` indicates when memory context is thin

### 7. Error Handling
- Circuit breaker prevents cascade failures
- Fallback to local processing when unavailable
- Request timeouts prevent hanging (30s default, 25s for streaming budget)
- Rate limiting: 30 requests/minute per IP on `/api/shrink`

## Rate Limiting

| Endpoint | Limit | Window | Notes |
|----------|-------|--------|-------|
| `/api/shrink` | 30 | 60s | Per IP |
| Other endpoints | 180 | 60s | Per IP or thread |

**Response on rate limit:**
```json
{
  "message": "Too many requests",
  "error_type": "rate_limited"
}
```
Headers: `Retry-After: <unix-timestamp>`

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
// Test send_message tool with correct response mapping
const result = await sendMessage({
  session_id: 'test-session-uuid',
  message: 'I am feeling anxious today',
  save_checkpoint: true
});

expect(result.success).toBe(true);
expect(result.content).toBeDefined();  // Mapped from response_text
expect(result.metadata.threadId).toBeDefined();
expect(result.metadata.crisisLevel).toBe('none');  // String, not number
```

### End-to-End Testing
1. Start Shrink-Chat backend: `cd shrink-chat && pnpm run dev`
2. Start MCP server: `cd mcp && npm run dev`
3. Test via MCP client or direct API calls

### Validate Crisis Detection
```bash
# Test crisis detection mapping
curl -X POST http://localhost:3000/api/shrink \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "I feel hopeless today",
    "threadId": "test-uuid-here"
  }' | jq '.crisis_level, .crisis_confidence'
```

## Deployment Checklist

- [ ] Configure production environment variables
- [ ] Run database migrations (MCP-side)
- [ ] Verify Shrink-Chat backend connectivity
- [ ] Test circuit breaker thresholds
- [ ] Enable monitoring for API latency
- [ ] Set up error alerting
- [ ] Test crisis detection flow with string levels
- [ ] Verify fallback processing
- [ ] Load test integration endpoints
- [ ] Document API rate limits
- [ ] Validate response field mapping (response_text, not content)

## Monitoring Metrics

### Key Metrics to Track
- **API Latency**: p50, p95, p99 response times
- **Circuit Breaker State**: CLOSED/OPEN/HALF_OPEN transitions
- **Crisis Detection Rate**: By level (none/concern/elevated/high/critical)
- **Thread Creation**: Success/failure rates
- **Message Volume**: Requests per minute/hour
- **Error Rates**: By error_type
- **Memory Retrieval**: rag_confidence distribution

### Recommended Dashboards
1. **System Health**: API status, circuit breaker state
2. **Performance**: Latency, throughput, error rates
3. **Crisis Monitoring**: Detection rates by level, intervention rates
4. **User Experience**: Response times, memory hit rates

## Troubleshooting

### Common Issues

#### 1. Circuit Breaker Opens Frequently
- Check Shrink-Chat backend health: `curl https://couchloopchat.com/api/health`
- Verify network connectivity
- Adjust threshold and timeout settings
- Review error logs for root cause

#### 2. Thread ID Mismatches
- Ensure consistent UUID v4 generation
- Check database thread mappings
- Verify session-thread relationships

#### 3. Crisis Detection Mapping Errors
- **Remember**: crisis_level is a STRING enum, not numeric 0-10
- Valid values: `'none'`, `'concern'`, `'elevated'`, `'high'`, `'critical'`
- Check response parsing for correct field: `response.crisis_level`

#### 4. Response Field Confusion
- Use `response_text`, not `content` for non-streaming
- Use `meta.state` for voice controller state
- Use `crisis_level` (string), not `crisisLevel` (doesn't exist)

#### 5. High Latency
- Check Shrink-Chat response times
- Verify network latency
- Consider streaming for better perceived performance
- Review database query performance on memory retrieval

#### 6. Rate Limiting
- `/api/shrink` has stricter limit (30/min vs 180/min for other endpoints)
- Check `Retry-After` header for reset time
- Implement exponential backoff

## Migration Guide

### From Standalone MCP to Integrated

1. **Update Environment**
   ```bash
   # Add Shrink-Chat configuration
   SHRINK_CHAT_API_URL=https://couchloopchat.com
   ENABLE_SHRINK_CHAT_INTEGRATION=true
   ```

2. **Run Database Migration**
   ```bash
   # Add thread mapping columns
   npm run db:push
   ```

3. **Update Response Mapping** (Breaking Change)
   ```typescript
   // OLD (incorrect)
   const message = response.content;
   const crisisLevel = response.crisisLevel; // number 0-10
   
   // NEW (correct)
   const message = response.response_text;
   const crisisLevel = response.crisis_level; // string enum
   const needsIntervention = response.crisis_requires_intervention;
   ```

4. **Update Crisis Handling**
   ```typescript
   // OLD (incorrect)
   if (response.crisisLevel > 7) { /* intervention */ }
   
   // NEW (correct)
   if (response.crisis_level === 'high' || response.crisis_level === 'critical') {
     // intervention
   }
   ```

5. **Test Integration**
   ```bash
   # Verify connectivity
   curl -X GET https://couchloopchat.com/api/health

   # Test message sending
   npm run test:integration
   ```

## Security Considerations

1. **Origin Checking**: Shrink-Chat validates request origins
2. **Rate Limiting**: Built-in rate limiting per IP and thread
3. **Input Validation**: Zod schemas validate all inputs
4. **Crisis Safety**: Automatic guardrails for crisis situations
5. **Data Privacy**: No PHI storage, thread IDs are anonymous UUIDs
6. **Circuit Breaker**: Prevents resource exhaustion
7. **Idempotency**: Prevents duplicate message creation on retries

## Changelog

### v2.0 (January 8, 2026)
- **BREAKING**: Corrected `crisisLevel` type from numeric (0-10) to string enum
- **BREAKING**: Corrected response field from `content` to `response_text`
- Added complete `meta` object documentation
- Added memory counter fields
- Corrected SSE event types (`chunk` not `text`)
- Added rate limiting details
- Added crisis level definitions table
- Added threadId resolution priority
- Corrected production URL (no `api.` subdomain)

### v1.0 (Original)
- Initial integration guide

## Support

For issues or questions:
- GitHub Issues: [MCP Repository](https://github.com/yourusername/couchloop-mcp)
- Documentation: [Full API Docs](./docs/API.md)
- Shrink-Chat Docs: [Backend API Analysis](../shrink-chat/BACKEND_API_ANALYSIS.md)

## References

- [Model Context Protocol Specification](https://github.com/anthropics/mcp)
- [Shrink-Chat Backend Repository](https://github.com/wisenbergg/shrink-chat)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [PostgreSQL pgvector](https://github.com/pgvector/pgvector)
