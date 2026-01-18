# CouchLoop Current Architecture (v1.x)

## Document Purpose

This document describes the **ACTUAL CURRENT IMPLEMENTATION** of CouchLoop as of v1.x.

For the target behavioral governance architecture, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## What CouchLoop Currently Is

CouchLoop v1.x is a **session and journey management system** that:

- Provides stateful conversation tracking via MCP protocol
- Manages therapeutic journeys with checkpoints
- Passes messages through to the shrink-chat backend
- Captures conversation data for analysis
- Handles post-generation crisis detection

## Current Architecture

### Actual Call Flow

```
ChatGPT/Claude
   ↓
MCP Protocol
   ↓
CouchLoop MCP Server
   ↓
Session Management Layer
   ↓
send_message tool
   ↓
Shrink-Chat API (staging/production)
   ↓
Generated Response (from shrink-chat's LLM)
   ↓
Post-generation crisis check
   ↓
Response returned to user
```

### What Currently Exists

#### 1. Session Management
- Creates and tracks conversation sessions
- Maintains session state (active, paused, completed)
- Links sessions to journeys
- Stores checkpoints for progress tracking

#### 2. Journey System
- Pre-defined therapeutic journeys (Daily Reflection, Gratitude Practice)
- Step-by-step progression through prompts
- Optional step support
- Journey completion tracking

#### 3. Message Pass-Through
- `send_message` tool forwards messages to shrink-chat API
- No evaluation of responses before delivery
- No modification or blocking capabilities
- Simply routes messages and returns responses

#### 4. Data Capture
- Saves user messages as checkpoints
- Saves assistant responses after generation
- Creates thread mappings between MCP and shrink-chat
- Tracks crisis events when detected

#### 5. Crisis Handling (Post-Generation)
- Shrink-chat API returns crisis level with response
- MCP server logs crisis events after the fact
- No pre-delivery intervention
- Crisis resources provided by shrink-chat

### Current Tools (9 total)

1. **create_session** - Start new conversation session
2. **send_message** - Pass message to shrink-chat API
3. **get_session** - Retrieve session details
4. **update_session** - Modify session state
5. **create_checkpoint** - Save progress marker
6. **get_checkpoints** - Retrieve session checkpoints
7. **add_insight** - Save user reflection
8. **get_insights** - Retrieve user insights
9. **complete_journey** - Mark journey as finished

### Current Resources (5 total)

1. **session://current** - Current session state
2. **journey://list** - Available journeys
3. **journey://[id]** - Specific journey details
4. **user://context** - User information
5. **checkpoint://list** - Session checkpoints

### Database Schema

Current tables in PostgreSQL:
- `users` - User accounts (currently mock-generated)
- `sessions` - Conversation sessions
- `journeys` - Journey definitions
- `checkpoints` - Progress markers and messages
- `insights` - User reflections
- `threadMappings` - Links MCP sessions to shrink-chat threads
- `crisisEvents` - Post-generation crisis detections
- `oauthTokens` - OAuth tokens (stubbed)
- `authorizationCodes` - Auth codes (stubbed)

### Integration Points

#### Shrink-Chat API Integration
- **Endpoint**: `https://staging.couchloopchat.com` (staging)
- **Method**: POST to `/api/shrink/proxy`
- **Headers**: Include threadId, sessionId
- **Response**: Contains message, crisis level, emotions, techniques

#### Environment Configuration
- `.env.local` - Hardcoded in source files
- Uses staging shrink-chat API for testing
- Production database for MCP data
- Feature flags for integration control

## What's NOT Currently Implemented

### Missing Governance Features
- ❌ Pre-delivery evaluation of responses
- ❌ Response blocking capabilities
- ❌ Response modification/rewriting
- ❌ Draft response inspection
- ❌ Hallucination detection
- ❌ Inconsistency checking
- ❌ Tone drift monitoring
- ❌ Unsafe reasoning pattern detection

### Missing Infrastructure
- ❌ Placement between application and LLM
- ❌ Direct LLM provider integration
- ❌ Intervention decision engine
- ❌ Governance audit logs
- ❌ Model-agnostic interfaces

### Authentication Gaps
- ❌ Real OAuth implementation (currently stubbed)
- ❌ JWT-based user authentication
- ❌ Production-ready auth UI

## Current Limitations

1. **No Governance Layer**: Cannot evaluate or intervene on responses
2. **Pass-Through Only**: Simply forwards messages to shrink-chat
3. **Post-Generation Only**: All checks happen after response generation
4. **Hardcoded Environment**: Always loads `.env.local`
5. **Mock Users**: Uses nanoid-generated users instead of real auth

## How Current Maps to Target

| Current Component | Maps To Target |
|-------------------|----------------|
| Session Management | Context provider for governance |
| Checkpoints | Conversation history for evaluation |
| Crisis Events | Post-hoc validation of governance |
| send_message | Will become evaluation point |
| Thread Mappings | Multi-model pipeline support |

## Key Insight

The current v1.x implementation is essentially a **sophisticated session wrapper** around the shrink-chat API. It provides valuable session management and data capture capabilities but does **NOT** implement the behavioral governance layer described in [ARCHITECTURE.md](./ARCHITECTURE.md).

The path from v1.x to v2.x requires:
1. Moving evaluation BEFORE response delivery
2. Adding intervention capabilities
3. Implementing the four evaluation criteria
4. Creating a true middleware layer between app and LLM

---

## References

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Target behavioral governance architecture
- [CLAUDE.md](./CLAUDE.md) - Implementation guide
- [MCP_WIRING_COMPLETE.md](./MCP_WIRING_COMPLETE.md) - Current integration details