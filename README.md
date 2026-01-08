# CouchLoop MCP Server

Turn conversations into guided journeys that remember where you left off.

## Overview

CouchLoop MCP Server provides stateful, resumable conversation experiences for AI agents. It manages sessions, progress checkpoints, and guided journeys - enabling multi-turn experiences that survive interruptions and span multiple conversations.

### What This Is
- State management infrastructure for AI conversations
- Journey/workflow orchestration layer
- Session persistence and resumption
- MCP (Model Context Protocol) server for ChatGPT and Claude

### What This Is NOT
- A chatbot or conversational AI
- A therapy/clinical tool (no PHI)
- A UI layer (headless, works behind existing chat interfaces)

## Features

- **7 MCP Tools** for session management, checkpoints, journeys, and insights
- **5 MCP Resources** for read-only context access
- **3 Pre-built Journeys**: Daily Reflection, Gratitude Practice, Weekly Review
- **Stateful Sessions** that can be paused and resumed
- **Progress Tracking** with checkpoints and step advancement
- **User Context** management with preferences and history
- **OAuth 2.0** authentication for ChatGPT App Store

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL database (via Supabase)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/couchloop-mcp.git
cd couchloop-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:

### Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Get your credentials from Project Settings > API:
   - `SUPABASE_URL`: Your project URL
   - `SUPABASE_ANON_KEY`: Your anon/public key
   - `SUPABASE_SERVICE_ROLE_KEY`: Your service role key
3. Get database URL from Project Settings > Database:
   - `DATABASE_URL`: Your PostgreSQL connection string

### Environment Configuration

```env
# Database (Supabase)
DATABASE_URL=postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres
SUPABASE_URL=https://[project].supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# OAuth (for ChatGPT App Store)
OAUTH_CLIENT_ID=couchloop_chatgpt
OAUTH_CLIENT_SECRET=generate-a-secure-secret
OAUTH_REDIRECT_URI=https://chat.openai.com/aip/plugin/oauth/callback
JWT_SECRET=minimum-32-character-secret-key-here

# Server
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

### Database Setup

1. Push schema to database:
```bash
npm run db:push
```

2. Seed journey definitions:
```bash
npm run db:seed
```

3. (Optional) Open Drizzle Studio to view data:
```bash
npm run db:studio
```

### Running the Server

#### Development Mode
```bash
npm run dev
```

#### Production Mode
```bash
npm run build
npm start
```

## MCP Tools

### Session Management

#### `create_session`
Start a new guided session, optionally with a journey.

```json
{
  "journey_slug": "daily-reflection",
  "context": "Evening check-in"
}
```

#### `resume_session`
Resume a previously paused session.

```json
{
  "session_id": "uuid-here"
}
```

### Progress Tracking

#### `save_checkpoint`
Save progress or capture a key moment.

```json
{
  "session_id": "uuid-here",
  "key": "mood",
  "value": "calm and reflective",
  "advance_step": true
}
```

#### `get_journey_status`
Get current progress in a session/journey.

```json
{
  "session_id": "uuid-here"
}
```

### Journeys

#### `list_journeys`
List available guided journeys.

```json
{
  "tag": "reflection"
}
```

### Insights

#### `save_insight`
Capture a meaningful insight from the conversation.

```json
{
  "content": "I notice I'm more energized in the mornings",
  "session_id": "uuid-here",
  "tags": ["self-awareness", "energy"]
}
```

#### `get_user_context`
Get relevant context about the user for personalization.

```json
{
  "include_recent_insights": true,
  "include_session_history": true
}
```

## MCP Resources

- `session://current` - Current active session state
- `journey://daily-reflection` - Daily Reflection journey definition
- `journey://gratitude-practice` - Gratitude Practice journey definition
- `journey://weekly-review` - Weekly Review journey definition
- `context://user` - User preferences and recent history

## Available Journeys

### Daily Reflection (5 minutes)
A brief check-in to process your day and capture key moments.
- Check in with current mood
- Identify memorable moment
- Release what's not needed
- Summarize and save insights

### Gratitude Practice (3 minutes)
Notice and name three things you appreciate.
- Something small that made today better
- Something about yourself you're grateful for
- Someone you appreciate

### Weekly Review (10 minutes)
Look back on your week and set intentions.
- Describe the week's tone
- Acknowledge accomplishments
- Notice challenges
- Set intention for next week

## Development

### Scripts

```bash
# Development with hot reload
npm run dev

# Build TypeScript
npm run build

# Run tests
npm test

# Type checking
npm run typecheck

# Linting
npm run lint

# Database operations
npm run db:push       # Push schema to database
npm run db:seed       # Seed journeys
npm run db:studio     # Open Drizzle Studio
npm run db:migrate    # Run migrations

# Setup helpers
npm run setup         # Install deps and build
npm run setup:db      # Initialize database
```

### Project Structure

```
src/
├── index.ts              # MCP server entrypoint
├── tools/                # MCP tool implementations
├── resources/            # MCP resource handlers
├── workflows/            # Journey definitions and engine
├── db/                   # Database schema and client
├── auth/                 # OAuth 2.0 implementation
├── types/                # TypeScript type definitions
└── utils/                # Logging and error handling
api/
└── oauth/                # OAuth endpoints for Vercel
    ├── authorize.ts      # Authorization endpoint
    └── token.ts          # Token exchange endpoint
```

## Deployment

### Vercel Deployment

1. Install Vercel CLI:
```bash
npm install -g vercel
```

2. Set up environment variables:
```bash
vercel env add DATABASE_URL
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add OAUTH_CLIENT_ID
vercel env add OAUTH_CLIENT_SECRET
vercel env add OAUTH_REDIRECT_URI
vercel env add JWT_SECRET
```

3. Deploy to Vercel:
```bash
# Deploy to preview
npm run vercel

# Deploy to production
npm run vercel:prod
```

4. Your OAuth endpoints will be available at:
   - `https://your-app.vercel.app/api/oauth/authorize`
   - `https://your-app.vercel.app/api/oauth/token`

### ChatGPT App Store Submission

1. Update OAuth redirect URI in `.env` to match ChatGPT's callback
2. Ensure all OAuth endpoints are working
3. Create test credentials for reviewers
4. Prepare privacy policy at `/docs/PRIVACY_POLICY.md`
5. Submit via ChatGPT developer portal with:
   - App name: CouchLoop (or your chosen name)
   - Description: Turn conversations into guided journeys
   - OAuth authorization URL: `https://your-app.vercel.app/api/oauth/authorize`
   - OAuth token URL: `https://your-app.vercel.app/api/oauth/token`
   - Scopes: read, write

## Testing

Run the test suite:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit PRs to the main branch.

## License

MIT License - see LICENSE file for details

## Support

- GitHub Issues: [Report bugs or request features](https://github.com/yourusername/couchloop-mcp/issues)
- Documentation: [Full API documentation](./docs/API.md)

## Acknowledgments

Built with:
- [Model Context Protocol SDK](https://github.com/anthropics/mcp-sdk)
- [Supabase](https://supabase.com)
- [Drizzle ORM](https://orm.drizzle.team)
- [TypeScript](https://www.typescriptlang.org)