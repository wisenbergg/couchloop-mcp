# MCP Server Codebase Exploration Report

## Executive Summary

The CouchLoop MCP Server is a sophisticated Model Context Protocol server providing stateful conversation management for AI agents (ChatGPT, Claude). It's currently in active development with a solid foundation of 9 tools, 5 resources, and 3 pre-built journeys. The codebase shows intentional integration with a shrink-chat therapeutic backend with crisis detection capabilities.

---

## 1. CURRENT IMPLEMENTATION STATUS

### 1.1 Core Features: IMPLEMENTED

#### Tools (9 total)
1. **create_session** - Start new sessions, optionally with journeys
2. **send_message** - Therapeutic messaging with shrink-chat integration
3. **resume_session** - Resume paused sessions
4. **save_checkpoint** - Progress capture with journey step advancement
5. **get_checkpoints** - Retrieve session checkpoints
6. **list_journeys** - Browse available journeys with tag filtering
7. **get_journey_status** - Get progress tracking and completion percentage
8. **save_insight** - Capture meaningful realizations
9. **get_user_context** - Retrieve personalized context

#### Resources (5 total)
1. **session://current** - Active session state
2. **journey://daily-reflection** - Daily Reflection journey definition
3. **journey://gratitude-practice** - Gratitude Practice journey definition
4. **journey://weekly-review** - Weekly Review journey definition
5. **context://user** - User preferences and history

#### Pre-built Journeys
- **daily-reflection**: 4 steps (5 min) - Check-in, memorable moment, release, summary
- **gratitude-practice**: Gratitude-focused reflection
- **weekly-review**: Extended weekly checkpoint

### 1.2 Database Schema: IMPLEMENTED & COMPREHENSIVE

8 tables designed for scalability:
- `users` - User profiles with external ID and preferences
- `journeys` - Journey definitions with JSONB steps
- `sessions` - Session state tracking with journey linkage
- `checkpoints` - Progress captures with flexible key-value storage
- `insights` - User reflections and realizations
- `oauthClients` - OAuth client registry
- `oauthTokens` - OAuth authentication tokens
- `authorizationCodes` - OAuth authorization codes
- `threadMappings` - MCP-to-Shrink-Chat thread mapping audit trail
- `crisisEvents` - Crisis detection and escalation logging

### 1.3 Shrink-Chat Integration: IMPLEMENTED (Active)

**Status**: Actively integrated with resilience patterns

#### Key Components
- **ShrinkChatClient** (`src/clients/shrinkChatClient.ts`)
  - Full HTTP client for shrink-chat `/api/shrink` endpoint
  - Crisis pattern detection (local, client-side)
  - Timeout handling: regular (15s), crisis (45s), streaming (60s)
  - Caching for crisis responses
  - Circuit breaker integration
  - Retry strategy with exponential backoff
  - Request validation with Zod schemas

- **sendMessage Tool** (`src/tools/sendMessage.ts`)
  - Thread ID lazy creation and management
  - Session metadata and journey context enrichment
  - Conversation history inclusion (last 5 exchanges)
  - Checkpoint saving on demand
  - Journey step advancement
  - Crisis detection and handling callback
  - Error handling with fallback support
  - Performance monitoring integration

#### Crisis Handling
- Detection at both client and server-side
- Response caching for common patterns
- Crisis level classification (0-10 scale)
- Resources and escalation paths provided
- Metadata logging in sessions and crisisEvents table
- Special timeout handling for crisis messages

#### Resilience Patterns
1. **Circuit Breaker** - Prevents cascading failures
   - Configurable threshold (default: 5 failures)
   - States: closed → open → half-open
   - Auto-recovery with success threshold
   
2. **Retry Strategy** - Intelligent retry logic
   - Exponential backoff
   - Jitter to prevent thundering herd
   - Configurable max retries

3. **Response Caching** - Crisis pattern caching
   - LRU eviction for memory management
   - Pattern extraction and categorization
   - 5-minute TTL default
   - Cache statistics tracking

4. **Performance Monitoring**
   - Real-time metrics collection
   - Percentile tracking (p50, p95, p99)
   - Health status checks
   - Periodic logging and cleanup

---

## 2. OAUTH/AUTHENTICATION IMPLEMENTATION

### 2.1 Current State: STUBBED (Development Mode)

**Critical Note**: OAuth is NOT production-ready.

#### API Endpoints Implemented
- **GET /oauth/authorize** (`api/oauth/authorize.ts`)
  - Accepts OAuth parameters
  - Client validation
  - Auto-generates mock authorization codes
  - **TODO**: Implement actual user authentication UI
  - **TODO**: Show consent screen
  - **TODO**: Validate authorization codes against database

- **POST /oauth/token** (`api/oauth/token.ts`)
  - Authorization code exchange
  - JWT token generation
  - Refresh token support
  - **TODO**: Validate codes from database
  - **TODO**: Implement code expiration

#### Mock User Handling
Every tool call that needs user context creates a mock user:
```
usr_<nanoid>  // Appears in: session.ts, insight.ts, resources
```

This is evident in:
- `src/tools/session.ts` (line 15-16, 87-88)
- `src/tools/insight.ts` (line 15, 77)
- `src/resources/session-summary.ts` (TODO comment)
- `src/resources/user-context.ts` (TODO comment)

#### Server OAuth Implementation
- Express.js server at `src/server/index.ts` (port 3001)
- Custom OAuth server at `src/server/oauth/authServer.ts`
- Middleware for token validation and rate limiting
- JWT secret handling via environment

#### Production Requirements
1. Implement actual login/consent UI
2. Validate authorization codes against database table
3. Replace mock user generation with JWT user extraction
4. Implement proper token validation middleware
5. Add scopes enforcement
6. Add rate limiting per user

---

## 3. TEST COVERAGE & STATUS

### 3.1 Current Test Suite

**Location**: `/Users/hipdev/dev/mcp/tests/integration/sendMessage.test.ts`

#### Tests Implemented (Partial)
- Basic message sending
- Thread ID generation on first message
- Thread ID reuse on subsequent messages
- Crisis detection scenarios (partial)
- Checkpoint management
- Journey integration

#### Testing Framework
- **Tool**: Vitest
- **Approach**: Integration tests
- **Database**: Uses actual PostgreSQL test database

#### Coverage Assessment
- **sendMessage tool**: ~60% coverage
- **Other tools**: Minimal to no coverage
- **Resources**: No test coverage
- **Edge cases**: Limited
- **Error scenarios**: Basic coverage

#### Test Limitations
- No unit tests for utilities (circuitBreaker, responseCache, errorHandler, etc.)
- No tests for OAuth flows
- No tests for crisis handling logic
- No performance/load tests
- No integration tests for journey progression
- Mock database setup may be incomplete

---

## 4. TODOS & INCOMPLETE FEATURES

### 4.1 Critical TODOs (Found via grep)

1. **OAuth/Authentication** (5 instances)
   - `src/server/index.ts:69` - Real auth implementation needed
   - `src/tools/session.ts:15` - Replace mock user with OAuth context
   - `src/tools/session.ts:87` - Get actual user from OAuth
   - `src/tools/insight.ts:14` - Get actual user from OAuth
   - `src/tools/insight.ts:76` - Get actual user from OAuth
   - `src/resources/session-summary.ts` - Get actual user from OAuth
   - `src/resources/user-context.ts` - Get actual user from OAuth

2. **OAuth Token Validation** (2 instances)
   - `api/oauth/authorize.ts:27` - Implement user authentication
   - `api/oauth/token.ts:28` - Validate authorization code from database

---

## 5. INTEGRATION POINTS WITH SHRINK-CHAT

### 5.1 Architecture

```
AI Agent (ChatGPT/Claude)
    ↓ (MCP Protocol)
MCP Server (couchloop-mcp)
    ├─ send_message tool
    ├─ Thread management
    ├─ Checkpoint saving
    └─ Crisis detection
    ↓ (HTTP)
Shrink-Chat Backend
    ├─ /api/shrink endpoint
    ├─ Therapeutic AI engine
    ├─ Crisis detection scoring
    └─ Resource recommendations
```

### 5.2 Message Flow

1. **Agent calls send_message**
   - sessionId, message, options

2. **MCP Server processes**
   - Gets/creates threadId
   - Retrieves conversation context
   - Collects session metadata

3. **Shrink-Chat integration**
   - Sends message via HTTP with context
   - Receives response with:
     - Content/reply
     - Crisis level (0-10)
     - Emotions detected
     - Therapeutic technique used
     - Resources (if needed)

4. **Crisis handling**
   - Checks crisisLevel > 7
   - Logs to crisisEvents table
   - Updates session metadata
   - Saves crisis checkpoint

5. **Fallback mode**
   - Enabled if ENABLE_SHRINK_CHAT_INTEGRATION=true
   - Recoverable errors trigger local processing
   - Network/timeout errors handled gracefully

### 5.3 Thread Management

- Lazy creation: First message generates UUID4 threadId
- Stored in sessions.threadId
- Reused across all messages in session
- Mapped in threadMappings table for audit

### 5.4 Configuration

```env
# Shrink-Chat Integration
SHRINK_CHAT_API_URL=http://localhost:3000
SHRINK_CHAT_TIMEOUT_REGULAR=30000
SHRINK_CHAT_TIMEOUT_CRISIS=45000
SHRINK_CHAT_TIMEOUT_STREAM=60000

# Circuit Breaker
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=60000
CIRCUIT_BREAKER_RESET=30000

# Feature Flags
ENABLE_SHRINK_CHAT_INTEGRATION=true
FALLBACK_TO_LOCAL_PROCESSING=true
```

---

## 6. ARCHITECTURE & CODE QUALITY

### 6.1 Code Organization

```
src/
├── index.ts                    # MCP server entry point
├── server/                     # Express.js HTTP server
│   ├── index.ts               # OAuth endpoints
│   ├── middleware/
│   │   └── auth.js            # Token validation
│   └── oauth/
│       └── authServer.ts       # OAuth implementation
├── tools/                      # MCP tools
│   ├── index.ts               # Tool registry
│   ├── session.ts             # Session management
│   ├── checkpoint.ts          # Checkpoint saving
│   ├── journey.ts             # Journey operations
│   ├── insight.ts             # Insight management
│   └── sendMessage.ts         # Shrink-chat integration
├── resources/                  # MCP resources
│   ├── index.ts               # Resource registry
│   ├── session-summary.ts
│   ├── journey-status.ts
│   └── user-context.ts
├── clients/
│   └── shrinkChatClient.ts    # Shrink-chat HTTP client
├── db/
│   ├── client.ts              # Drizzle ORM initialization
│   ├── schema.ts              # Table definitions (10 tables)
│   ├── seed.ts                # Journey seeding
│   └── migrations/            # Drizzle migrations
├── workflows/
│   ├── engine.ts              # Journey progression engine
│   ├── index.ts               # Journey definitions export
│   └── definitions/
│       ├── daily-reflection.ts
│       ├── gratitude-practice.ts
│       └── weekly-review.ts
├── types/                      # TypeScript interfaces
├── utils/
│   ├── errors.ts              # Custom error classes
│   ├── errorHandler.ts        # Error classification & handling
│   ├── circuitBreaker.ts      # Circuit breaker pattern
│   ├── logger.ts              # Logging utility
│   ├── responseCache.ts       # Crisis response caching
│   ├── retryStrategy.ts       # Retry logic
│   └── performanceMonitor.ts  # Performance metrics
├── auth/
│   └── middleware.ts          # JWT validation
└── clients/
    └── shrinkChatClient.ts    # HTTP client for shrink-chat
```

### 6.2 Error Handling

**ErrorHandler class** provides:
- Error type classification (8 types)
- Error severity levels (4 levels: low, medium, high, critical)
- Error context tracking
- Recovery strategy determination
- Error frequency monitoring

**Error Types**:
- NETWORK_ERROR
- TIMEOUT_ERROR
- VALIDATION_ERROR
- AUTHENTICATION_ERROR
- RATE_LIMIT_ERROR
- SERVER_ERROR
- CRISIS_HANDLING_ERROR
- DATABASE_ERROR
- UNKNOWN_ERROR

### 6.3 Input Validation

**Zod schemas** for all inputs:
- SendMessageSchema
- CreateSessionSchema
- ResumeSessionSchema
- SaveCheckpointSchema
- SaveInsightSchema
- GetUserContextSchema
- ListJourneysSchema
- GetJourneyStatusSchema

### 6.4 Code Patterns

**Consistent patterns across tools**:
1. Input validation with Zod
2. Database connection retrieval
3. Query/mutation execution
4. Error handling with custom errors
5. JSON response formatting
6. Logging at appropriate levels

---

## 7. CONFIGURATION & ENVIRONMENT

### 7.1 Supported Environments

- **Development**: `.env.local` (active)
- **Staging**: `.env.staging` (configured but not deployed)
- **Production**: `.env.production` (not yet used)

### 7.2 Current Configuration (`.env.local`)

```
DATABASE_URL=postgresql://[Supabase connection]
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=[key]
SUPABASE_SERVICE_ROLE_KEY=[key]

OAUTH_CLIENT_ID=couchloop_chatgpt
OAUTH_CLIENT_SECRET=[base64 secret]
OAUTH_REDIRECT_URI=https://chat.openai.com/aip/plugin/oauth/callback

PORT=3001
NODE_ENV=development
LOG_LEVEL=debug

JWT_SECRET=[base64 encoded 32+ chars]

SHRINK_CHAT_API_URL=http://localhost:3000
SHRINK_CHAT_TIMEOUT_REGULAR=30000
SHRINK_CHAT_TIMEOUT_CRISIS=45000
SHRINK_CHAT_TIMEOUT_STREAM=60000

CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_TIMEOUT=60000
CIRCUIT_BREAKER_RESET=30000

ENABLE_SHRINK_CHAT_INTEGRATION=true
FALLBACK_TO_LOCAL_PROCESSING=true
```

### 7.3 Missing Configuration Notes

- SUPABASE_ANON_KEY appears to be placeholder
- SUPABASE_SERVICE_ROLE_KEY appears to be placeholder
- JWT_SECRET present but may not meet min 32-char requirement in all configs
- Shrink-chat API URL defaults to localhost:3000

---

## 8. DEPENDENCY ANALYSIS

### 8.1 Core Dependencies

**Framework & Protocol**:
- `@modelcontextprotocol/sdk@1.25.2` - MCP protocol
- `express@5.2.1` - HTTP server for OAuth

**Database**:
- `drizzle-orm@0.29.1` - Type-safe ORM
- `pg@8.16.3` - PostgreSQL driver
- `postgres@3.4.3` - Postgres library
- `@supabase/supabase-js@2.39.0` - Supabase client

**Authentication & Security**:
- `jose@5.2.0` - JWT handling
- `jsonwebtoken@9.0.3` - JWT alternative
- `bcryptjs@3.0.3` - Password hashing
- `uuid@13.0.0` - UUID generation
- `nanoid@5.0.4` - Unique ID generation

**Validation & Types**:
- `zod@3.22.4` - Input validation
- `@types/express@5.0.6` - TypeScript definitions

**DevDependencies**:
- `typescript@5.3.3` - TypeScript compiler
- `tsx@4.6.2` - TypeScript executor
- `vitest@1.1.0` - Test framework
- `drizzle-kit@0.20.7` - Database tooling
- `eslint@8.56.0` - Linting

### 8.2 Development Commands

```bash
npm run build              # Compile TypeScript
npm start                  # Run production server
npm run dev                # Development with hot reload
npm run typecheck          # Type checking without emit
npm run lint              # ESLint
npm test                  # Vitest suite
npm test:watch            # Vitest watch mode
npm run db:push           # Schema sync
npm run db:migrate        # Run migrations
npm run db:seed           # Seed journeys
npm run db:studio         # Drizzle Studio UI
npm run server            # Start Express server (port 3001)
npm run server:dev        # Express server with watch
```

---

## 9. DEPLOYMENT STATUS

### 9.1 Deployment Configuration

**Vercel** integration ready:
- `vercel.json` configured
- Commands: `npm run vercel` (preview), `npm run vercel:prod`
- Environment for production deployment

### 9.2 Build Artifacts

**dist/** directory contains:
- Compiled JavaScript
- Type definitions (.d.ts)
- Source maps (if configured)

---

## 10. MISSING FEATURES & GAPS

### 10.1 Critical Gaps

| Feature | Status | Impact |
|---------|--------|--------|
| Real OAuth authentication | ❌ Stubbed | Cannot identify users in production |
| User context extraction from JWT | ❌ Not implemented | Mock users used everywhere |
| Authorization code validation | ❌ Not implemented | Security vulnerability |
| Test coverage for utilities | ❌ None | No safety net for refactoring |
| Integration tests for OAuth | ❌ None | Cannot verify auth flow |
| Performance/load tests | ❌ None | Unknown scaling characteristics |

### 10.2 Nice-to-Have Features

| Feature | Status | Priority |
|---------|--------|----------|
| WebSocket support for real-time | ❌ Not planned | Medium |
| Session export/import | ❌ Not implemented | Low |
| Advanced journey branching | ❌ Not implemented | Medium |
| User preferences UI | ❌ Not implemented | Low |
| Admin dashboard | ❌ Not implemented | Low |
| Audit logging | ⚠️ Partial | Medium |

---

## 11. CODE QUALITY OBSERVATIONS

### 11.1 Strengths

1. **Consistent patterns** - All tools follow same structure
2. **Type safety** - Comprehensive Zod schemas
3. **Error handling** - Custom error classes and handlers
4. **Resilience patterns** - Circuit breaker, retry, caching
5. **Separation of concerns** - Clear module boundaries
6. **Configuration management** - Environment-based
7. **Database abstraction** - Drizzle ORM for type safety
8. **Logging** - Structured logging throughout

### 11.2 Areas for Improvement

1. **Test coverage** - Only 1 integration test file
2. **Error messages** - User-facing messages could be clearer
3. **Input validation** - Some tools use `any` in params
4. **Documentation** - Code comments minimal in complex sections
5. **Middleware stacking** - OAuth server middleware could be more modular
6. **Environment variables** - Some unused variables defined
7. **Resource caching** - No caching strategy for resources
8. **Logging context** - Could include more structured metadata

---

## 12. SUMMARY & RECOMMENDATIONS

### 12.1 Overall Assessment

**Current Status**: **BETA with Production-Ready Foundations**

- Solid architectural patterns and separation of concerns
- Working integration with shrink-chat therapeutic backend
- Comprehensive database schema for scalability
- Good error handling and resilience patterns
- **Critical Blocker**: OAuth is stubbed and not production-ready

### 12.2 Before Production Deployment

**MUST DO** (Blocking):
1. [ ] Implement real OAuth 2.0 authentication
2. [ ] Replace mock users with JWT-extracted users
3. [ ] Implement authorization code database validation
4. [ ] Add comprehensive OAuth endpoint tests
5. [ ] Security audit of token handling

**SHOULD DO** (Strongly Recommended):
1. [ ] Increase test coverage to 80%+
2. [ ] Add load/performance tests
3. [ ] Implement comprehensive audit logging
4. [ ] Add health check endpoints
5. [ ] Implement rate limiting per user

**NICE TO DO** (For v1.1):
1. [ ] API documentation (OpenAPI/Swagger)
2. [ ] Dashboard for session visualization
3. [ ] Advanced journey branching
4. [ ] WebSocket for real-time updates
5. [ ] Metrics export (Prometheus)

---

## 13. KEY FILES REFERENCE

| File | Purpose | Lines | Status |
|------|---------|-------|--------|
| `src/index.ts` | MCP server entry | 119 | ✅ Complete |
| `src/tools/sendMessage.ts` | Shrink-chat integration | ~300 | ✅ Complete |
| `src/clients/shrinkChatClient.ts` | HTTP client | ~300 | ✅ Complete |
| `src/tools/session.ts` | Session lifecycle | 171 | ✅ Complete |
| `src/db/schema.ts` | Database schema | 198 | ✅ Complete |
| `src/utils/circuitBreaker.ts` | Circuit breaker | 134 | ✅ Complete |
| `api/oauth/token.ts` | OAuth token exchange | 96 | ⚠️ Stubbed |
| `api/oauth/authorize.ts` | OAuth authorize | 45 | ⚠️ Stubbed |
| `src/server/index.ts` | Express server | ~250 | ⚠️ WIP |
| `tests/integration/sendMessage.test.ts` | Integration tests | ~100 | ⚠️ Minimal |

---

## END OF EXPLORATION REPORT
