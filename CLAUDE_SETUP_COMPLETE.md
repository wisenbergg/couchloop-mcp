# CouchLoop MCP Server - Claude Desktop Setup Complete ✅

Your MCP server has been successfully configured with Claude Desktop!

## Prerequisites

Before using the MCP server, ensure you have:

1. **Node.js and npm installed** (v18+ recommended)
2. **Dependencies installed:**
   ```bash
   cd /Users/hipdev/dev/mcp
   npm install
   ```
3. **Environment variables configured** in `.env.local`:
   ```bash
   # Required Supabase credentials
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   DATABASE_URL=your_postgres_connection_string

   # Optional: For Shrink-Chat integration
   SHRINK_CHAT_API_URL=http://localhost:3001
   SHRINK_CHAT_API_KEY=your_api_key

   # OAuth (for future ChatGPT integration)
   JWT_SECRET=your_32_char_secret_key
   OAUTH_CLIENT_ID=your_client_id
   OAUTH_CLIENT_SECRET=your_client_secret
   ```

## What Was Done

1. **Added MCP server to Claude configuration** (`~/Library/Application Support/Claude/claude_desktop_config.json`)
   - Server name: `couchloop`
   - Will start automatically when Claude Desktop needs it
   - Runs on stdio (no port conflicts)

2. **Verified database connection**
   - Connected to your Supabase database successfully
   - All 10 tables are present and accessible

3. **Seeded journey data** (one-time setup)
   - Daily Reflection journey
   - Gratitude Practice journey
   - Weekly Review journey
   - Note: This was a one-time database seed. Journeys persist in your database.

## How to Use the MCP Server in Claude Desktop

1. **Restart Claude Desktop** (Important!)
   - Quit Claude Desktop completely (Cmd+Q)
   - Reopen Claude Desktop

2. **The MCP server will appear in the tools menu**
   - Look for the tools icon (wrench) in Claude Desktop
   - You should see "couchloop" listed as an available server

3. **Available MCP Tools** (10 total):
   - `create_session` - Start a new session or journey
   - `resume_session` - Resume a paused session
   - `send_message` - Send messages in active sessions
   - `save_checkpoint` - Save progress checkpoints
   - `list_journeys` - See available guided journeys
   - `get_journey_details` - Get details about a specific journey
   - `add_insight` - Record insights and reflections
   - `list_insights` - View saved insights
   - `oauth_authorize` - Initiates OAuth flow for ChatGPT App Store (returns authorization URL)
   - `oauth_callback` - Handles OAuth callback with authorization code (exchanges for tokens)

   **Note:** OAuth tools are for future ChatGPT integration. The flow:
   1. Call `oauth_authorize` to get an authorization URL
   2. User visits URL and approves access
   3. ChatGPT redirects back with authorization code
   4. Call `oauth_callback` with the code to complete authentication

4. **Available Resources** (5 total):
   - `session_context` - Current session state
   - `journey_definitions` - Available journey templates
   - `user_context` - User preferences and history
   - `insights_library` - Collection of user insights
   - `checkpoints` - Saved progress points

## Testing the Integration

Try these commands in a new Claude Desktop conversation:

### Example 1: List Available Journeys
"Can you show me what guided journeys are available?"

### Example 2: Start a Journey
"Let's start the Daily Reflection journey"

### Example 3: Save Progress
"Save a checkpoint of our conversation"

### Example 4: Add an Insight
"I want to record an insight: I've realized that morning routines help me stay focused"

## Troubleshooting

If the MCP server doesn't appear in Claude Desktop:

1. **Ensure dependencies are installed:**
   ```bash
   cd /Users/hipdev/dev/mcp
   npm install
   ```

2. **Check environment variables:**
   ```bash
   # Verify .env.local exists and has required variables
   cat .env.local | grep SUPABASE
   ```

3. **Test the server manually:**
   ```bash
   cd /Users/hipdev/dev/mcp
   npm run dev
   ```
   - Server uses stdio (no ports), so no port conflicts possible
   - Should see: "CouchLoop MCP Server is running"

4. **Verify configuration:**
   ```bash
   cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | grep -A5 couchloop
   ```

5. **Check logs:**
   - Claude Desktop logs: `~/Library/Logs/Claude/`
   - MCP server logs appear in terminal when running `npm run dev`

6. **Common issues:**
   - Missing `cwd` in config → Server can't find package.json
   - Database connection failed → Check DATABASE_URL in .env.local
   - Dependencies not installed → Run `npm install`

7. **Force restart:**
   - Kill any stuck Node processes: `pkill -f "tsx watch"`
   - Restart Claude Desktop completely

## Manual Testing

You can also test the MCP server directly:

```bash
# Interactive test menu
node test-mcp-server.cjs

# Or use the MCP Inspector
npx @modelcontextprotocol/inspector npm run dev
```

## Next Steps

- The MCP server is now ready to use with Claude Desktop
- It will manage stateful conversations and journeys
- Sessions persist across conversations
- All data is stored in your Supabase database

## Support

- MCP Documentation: https://modelcontextprotocol.io/
- Anthropic MCP Guide: https://docs.anthropic.com/en/docs/build-with-claude/mcp
- GitHub: https://github.com/modelcontextprotocol
- Issues: Check `/Users/hipdev/dev/mcp/README.md` for troubleshooting