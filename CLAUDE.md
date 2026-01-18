# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CouchLoop MCP Server - A Model Context Protocol server that provides stateful conversation management for AI agents (ChatGPT, Claude). It manages sessions, progress checkpoints, and guided journeys to enable multi-turn experiences that survive interruptions.

## Architectural Foundation

⚠️ **IMPORTANT**: See [ARCHITECTURE.md](./ARCHITECTURE.md) for the authoritative definition of CouchLoop as a behavioral governance layer for LLMs.

### Implementation Status

- **Current Implementation (v1.x)**: Session/journey management system with pass-through to shrink-chat backend
- **Target Architecture (v2.x)**: Full behavioral governance layer with pre-delivery evaluation and intervention
- **See Also**: [ARCHITECTURE_CURRENT.md](./ARCHITECTURE_CURRENT.md) for detailed current implementation

The v1.x codebase provides the foundation (session management, checkpoints, MCP protocol) that will support the v2.x governance layer.

## Development Commands

```bash
# Development
npm run dev              # Start development server with hot reload (tsx watch src/index.ts)

# Database Setup (Required before first run)
npm run db:push          # Push schema to PostgreSQL
npm run db:seed          # Seed journey definitions
npm run db:studio        # Open Drizzle Studio UI for database inspection

# Building & Production
npm run build            # Compile TypeScript to dist/
npm start                # Run production server (after build)

# Testing
npm test                 # Run Vitest suite
npm run test:watch       # Run tests in watch mode

# Code Quality
npm run lint             # ESLint TypeScript files
npm run typecheck        # TypeScript type checking without emit

# Deployment
npm run vercel           # Deploy to Vercel preview
npm run vercel:prod      # Deploy to Vercel production
```

## Architecture Overview

### Core Flow
The MCP server communicates via JSON-RPC over stdio with AI agents:
1. **Tools** (9 total) - Callable functions that mutate state (sessions, checkpoints, insights)
2. **Resources** (5 total) - Read-only context providers (current session, journey definitions, user context)
3. **Database** - PostgreSQL via Supabase with Drizzle ORM for type-safe queries
4. **Workflows** - Journey engine that orchestrates multi-step guided experiences

### Key Integration Pattern
```
AI Agent (ChatGPT/Claude) → MCP Protocol → Tool/Resource Handlers → Database
                                              ↓
                                        Workflow Engine (for journeys)
```

### Database Relationships
- `sessions` belong to `users` and optionally link to `journeys`
- `checkpoints` capture progress within `sessions`
- `insights` are user reflections, optionally tied to `sessions`
- `oauthTokens` and `authorizationCodes` handle OAuth flow (currently stubbed)

### Tool Handler Pattern
All tools in `/src/tools/` follow this structure:
1. Validate input with Zod schema
2. Get database connection
3. Perform operation (query/mutation)
4. Return standardized response
5. Error handling with custom error classes

### Session Lifecycle
Sessions transition through states: `active` → `paused`/`completed`/`abandoned`
- Sessions can be resumed from `paused` state
- Journey sessions advance through steps via checkpoints
- Non-journey sessions are freeform with arbitrary checkpoints

## Critical Implementation Notes

### Current Authentication State
OAuth implementation in `/api/oauth/` is **stubbed** - it generates mock authorization codes and users. Real authentication UI needs to be implemented before production use.

### User Context Management
Currently uses mock users (nanoid-generated). Each tool call creates/finds its own user. This will be replaced with JWT-based user extraction once OAuth is complete.

### Journey Engine
The workflow engine (`/src/workflows/engine.ts`) manages step-by-step progression:
- Journey definitions stored in database with JSONB step arrays
- Each step can be `prompt`, `checkpoint`, or `summary` type
- Optional steps can be skipped
- Progress tracked via `currentStep` in sessions table

### Environment Configuration
- Development: `.env.local`
- Staging: `.env.staging`
- Production: `.env.production`

Required variables:
- `DATABASE_URL` - PostgreSQL connection string
- `SUPABASE_*` - Supabase project credentials
- `OAUTH_*` - OAuth configuration (client ID, secret, redirect)
- `JWT_SECRET` - Must be 32+ characters

### MCP Server Initialization
Entry point `/src/index.ts`:
1. Loads environment variables
2. Initializes database connection (singleton pattern)
3. Creates MCP Server with tool/resource handlers
4. Connects stdio transport
5. Handles graceful shutdown

## Integration with Shrink-Chat (Planned Refactoring)

Based on the refactoring strategy, this MCP server will be integrated with the shrink-chat backend:
- Current: Standalone with own Supabase instance
- Target: Route through `/api/shrink` for therapeutic features
- Key integration point: New `send_message` tool calling shrink-chat API
- Benefits: Crisis detection, memory management, therapeutic guardrails

## User Types & Positioning

### Consumer Users (App Store End Users)
- **Target**: General public seeking wellness support
- **Access**: Via iOS/Android app (CouchLoop wellness companion)
- **Positioning**: Wellness companion with thoughtful, consistent support
- **Language**: Non-technical, stability-focused
- **Key Promise**: Steady, grounded, trustworthy experience without spirals or manipulation
- **Core Value**: Users feel stability, not infrastructure
- **Avoids**: Technical jargon, "hallucination" terminology, medical/diagnostic language

### Developer Users (MCP Integration)
- **Target**: Developers/platforms needing LLM behavioral governance
- **Access**: Via MCP protocol integration
- **Positioning**: Behavioral governance layer for LLMs in sensitive contexts
- **Language**: Technical, control-focused
- **Key Promise**: Monitors for hallucination, inconsistency, tone drift, unsafe reasoning
- **Core Value**: Control plane between application and LLM
- **Benefits**: Reduces downstream risk, trust failures, regulatory exposure

### Key Differentiation
- **For Consumers**: Experience emotional safety without seeing technical safeguards
- **For Developers**: Get infrastructure tools to ensure that safety
- **Same Technology**: Core CouchLoop engine serves both audiences
- **Different Journeys**: Consumer app vs developer API/MCP integration

## Testing Approach

Tests are organized in `/tests/` by type:
- `integration/` - End-to-end workflow tests
- `tools/` - Individual tool handler tests
- `workflows/` - Journey engine tests

Use Vitest for all testing. Test infrastructure is set up but coverage is minimal - prioritize testing when modifying core functionality.

## Common Development Tasks

### Adding a New Journey
1. Define journey structure in `/src/workflows/definitions/`
2. Add to seed script in `/src/db/seed.ts`
3. Create corresponding resource handler in `/src/resources/`
4. Run `npm run db:seed` to update database

### Adding a New Tool
1. Create handler in `/src/tools/[toolname].ts`
2. Define Zod schema for input validation
3. Register in `/src/index.ts` tool handlers
4. Follow existing error handling patterns

### Modifying Database Schema
1. Update `/src/db/schema.ts` with Drizzle table definitions
2. Run `npm run db:push` to sync with database
3. Update seed data if needed
4. Consider migration strategy for existing data