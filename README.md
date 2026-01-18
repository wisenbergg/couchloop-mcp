# CouchLoop EQ — MCP Server

Turn conversations into guided journeys that remember where you left off.

<p align="center">
  <img src="https://raw.githubusercontent.com/wisenbergg/couchloop-mcp/master/assets/logo/couchloop_EQ-IconLogo.png" alt="CouchLoop EQ" width="120" />
</p>

## What is CouchLoop EQ?

CouchLoop EQ is an MCP (Model Context Protocol) server that adds stateful, resumable conversation experiences to AI assistants like ChatGPT and Claude. It manages sessions, tracks progress through guided journeys, and remembers where you left off—even across multiple conversations.

## Installation

```bash
npm install -g couchloop-eq-mcp
```

## Setup

### For Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "couchloop-eq": {
      "command": "couchloop-eq-mcp",
      "env": {
        "COUCHLOOP_API_KEY": "your-api-key"
      }
    }
  }
}
```

### For ChatGPT (Developer Mode)

ChatGPT supports MCP servers through Developer Mode. See [CHATGPT_SETUP.md](CHATGPT_SETUP.md) for detailed setup instructions.

**Production Server Available:** `https://couchloop-mcp-production.up.railway.app/mcp`

Quick steps:
1. Enable Developer Mode in ChatGPT Settings
2. Add as MCP connector with URL: `https://couchloop-mcp-production.up.railway.app/mcp`
3. No authentication required - uses session-based isolation

For local development:
- Use ngrok or deploy your own server
- Follow setup in [CHATGPT_SETUP.md](CHATGPT_SETUP.md)

## Available Tools

| Tool | Description |
|------|-------------|
| `create_session` | Start a new guided session, optionally with a journey |
| `resume_session` | Resume a previously paused session |
| `send_message` | Send a message through the therapeutic AI stack |
| `save_checkpoint` | Save progress or capture a key moment |
| `get_checkpoints` | Retrieve all checkpoints for a session |
| `list_journeys` | List available guided journeys |
| `get_journey_status` | Get current progress in a session/journey |
| `save_insight` | Capture a meaningful insight from the conversation |
| `get_insights` | Retrieve saved insights |
| `get_user_context` | Get relevant context for personalization |

## Available Journeys

- **Daily Reflection** (5 min) — A brief check-in to process your day
- **Gratitude Practice** (3 min) — Notice and name three things you appreciate
- **Weekly Review** (10 min) — Look back on your week and set intentions

## Example Usage

Start a daily reflection:
```
"Start a daily reflection session"
```

Resume where you left off:
```
"Resume my last session"
```

Save an insight:
```
"Save this insight: I notice I'm more energized in the mornings"
```

## Get Started

Sign up for API access at [couchloop.com](https://couchloop.com)

## Support

- Issues: [github.com/wisenbergg/couchloop-mcp/issues](https://github.com/wisenbergg/couchloop-mcp/issues)
- Email: support@couchloop.com

## License

MIT
