# ChatGPT Developer Mode Setup for CouchLoop MCP

## Prerequisites

1. ChatGPT Pro/Plus account with Developer Mode access
2. Your CouchLoop MCP server running and accessible via HTTPS (for production) or ngrok (for testing)

## Quick Setup

### Step 1: Start Your MCP Server

```bash
# For development
npm run server:dev

# Server will run on http://localhost:3001
```

### Step 2: Expose Server (for local testing)

Since ChatGPT needs a public URL, use ngrok:

```bash
# Install ngrok if you haven't
brew install ngrok  # macOS
# or download from https://ngrok.com

# Expose your local server
ngrok http 3001
```

Note the HTTPS URL provided by ngrok (e.g., `https://abc123.ngrok.app`)

### Step 3: Configure in ChatGPT

1. Go to ChatGPT Settings → Connectors → Advanced → Enable "Developer Mode"
2. Return to Connectors → Click "Create" (top-right)
3. Fill out the form:

#### MCP Connector Configuration

- **Icon**: Upload `assets/logo/couchloop_EQ-IconLogo.png`
- **Name**: CouchLoop EQ
- **Description**: Stateful conversation management and guided therapeutic journeys
- **MCP Server URL**: `https://your-server.com/sse` (or ngrok URL for testing)
- **Authentication**: Leave blank (not required)

### Step 4: Test the Connection

1. Start a new ChatGPT conversation
2. Type: "Connect to CouchLoop"
3. ChatGPT should establish an SSE connection to your server
4. You can now use all CouchLoop tools and resources

## Available Tools & Resources

### Tools (Actions)
- `create_session` - Start a new therapeutic session
- `pause_session` - Pause the current session
- `resume_session` - Resume a paused session
- `complete_session` - Complete the current session
- `add_checkpoint` - Save progress checkpoint
- `capture_insight` - Record user insights
- `search_insights` - Search past insights
- `send_message` - Send therapeutic messages
- `advance_journey` - Progress through journey steps
- `get_journey_suggestions` - Get journey recommendations

### Resources (Read-only)
- `session://current` - Current session state
- `journey://daily-reflection` - Daily reflection journey
- `journey://gratitude-practice` - Gratitude practice journey
- `journey://weekly-review` - Weekly review journey
- `context://user` - User context and preferences

## Session Management

Each ChatGPT conversation thread automatically gets its own session ID. The MCP server maintains state per session, so:

- Each thread has isolated state
- Sessions persist across messages in the same thread
- Starting a new thread creates a new session
- No authentication required - session ID handles isolation

## Production Deployment

For production use:

1. Deploy to a cloud provider (Vercel, Heroku, AWS, etc.)
2. Set up environment variables:
   ```
   DATABASE_URL=your_postgres_url
   PORT=3001
   ```
3. Use HTTPS endpoint: `https://your-domain.com/sse`
4. No OAuth configuration needed

## Troubleshooting

### Connection Issues
- Ensure server is running (`npm run server:dev`)
- Check ngrok is forwarding correctly
- Verify `/sse` endpoint responds to GET requests
- Check server logs for connection attempts

### Session Issues
- Each ChatGPT thread maintains its own session
- Refresh the page to start a new session
- Check server logs for session creation

### Tool Errors
- Ensure database is initialized (`npm run db:push && npm run db:seed`)
- Check server logs for detailed error messages
- Verify all environment variables are set

## Development Tips

1. **Watch Server Logs**: Keep terminal open to see real-time activity
2. **Test Locally First**: Use ngrok for local testing before deploying
3. **Session Persistence**: Sessions are stored in PostgreSQL, survive server restarts
4. **No Auth Required**: Session IDs provide isolation between users/threads

## Example Usage in ChatGPT

```
User: "Start a daily reflection session"
ChatGPT: [Uses create_session tool with journey_slug: "daily-reflection"]

User: "What's my current progress?"
ChatGPT: [Reads session://current resource]

User: "I want to save this insight about gratitude"
ChatGPT: [Uses capture_insight tool]
```

## Support

For issues or questions:
- Check server logs for errors
- Review the [README.md](README.md) for general setup
- Open an issue on GitHub