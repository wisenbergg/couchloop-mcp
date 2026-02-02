# CouchLoop EQ — MCP Server

Behavioral governance layer for safer, more consistent AI conversations.

<p align="center">
  <img src="https://raw.githubusercontent.com/wisenbergg/couchloop-mcp/master/assets/logo/couchloop_EQ-IconLogo.png" alt="CouchLoop EQ" width="120" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/couchloop-eq-mcp"><img src="https://img.shields.io/npm/v/couchloop-eq-mcp.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://github.com/wisenbergg/couchloop-mcp"><img src="https://img.shields.io/github/stars/wisenbergg/couchloop-mcp?style=social" alt="GitHub stars"></a>
</p>

<p align="center">
  <a href="https://mcp.couchloop.com">🌐 Landing Page</a> •
  <a href="https://www.npmjs.com/package/couchloop-eq-mcp">📦 npm</a> •
  <a href="https://github.com/wisenbergg/couchloop-mcp">⭐ GitHub</a>
</p>

---

## 📖 Choose Your Guide

| Use Case | Guide | Description |
|----------|-------|-------------|
| 💻 **Developers** | [README-DEVELOPER.md](README-DEVELOPER.md) | Package validation, security scanning, code review, context preservation |
| 🧘 **Wellness** | [README-WELLNESS.md](README-WELLNESS.md) | Guided sessions, journeys, insights, reflection tools |

---

## What is CouchLoop EQ?

CouchLoop EQ is an MCP (Model Context Protocol) server that provides behavioral governance for LLMs. It monitors AI responses for hallucination, inconsistency, tone drift, and unsafe reasoning patterns—while also managing stateful sessions and guided journeys that remember where you left off.

## Why CouchLoop EQ?

Unlike raw LLMs that can hallucinate packages, generate insecure code, and lose context mid-conversation, CouchLoop EQ catches problems before they ship:

| Problem | CouchLoop EQ Solution |
|---------|----------------------|
| 🎭 **Hallucinated packages** | `validate_packages` catches fake npm/PyPI/Maven before install |
| 🔓 **Insecure code** | `scan_security` detects SQLi, XSS, hardcoded secrets |
| 📉 **Code bloat** | `detect_code_smell` flags over-engineering and verbose patterns |
| 🧠 **Lost context** | `preserve_context` stores architecture decisions across sessions |
| 🗂️ **Accidental deletion** | `protect_files` + `rollback_file` with automatic backups |
| 📚 **Deprecated APIs** | `validate_library_versions` warns about outdated patterns |
| 🔍 **Sloppy AI code** | `pre_review_code` catches console.logs, TODOs, missing error handling |

## Key Safety Features

### Behavioral Governance
- **Hallucination Detection**: Monitors for fabricated facts and unsupported claims
- **Consistency Checking**: Identifies contradictions and logical incoherence across turns
- **Tone Monitoring**: Detects emotional escalation, manipulation, or dependency-forming language
- **Safety Guardrails**: Prevents harmful advice, clinical overreach, and inappropriate moralizing

### Session Management
- **Stateful Conversations**: Maintains context across multiple interactions
- **Progress Tracking**: Remember where users left off in guided journeys
- **Crisis Detection**: Integration with therapeutic AI for emotional support
- **Memory Context**: Preserves important insights and checkpoints

## Quick Start

CouchLoop EQ is a standard MCP server that works with **any MCP-compatible client**—Claude Desktop, ChatGPT, Cursor, Windsurf, VS Code, and more.

### Option 1: Connect to Hosted Server (Easiest)

**Production endpoint:** `https://mcp.couchloop.com/mcp`

For Claude Desktop (v0.7.0+), add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "couchloop-eq": {
      "url": "https://mcp.couchloop.com/mcp",
      "transport": "streamable-http"
    }
  }
}
```

Restart Claude and try: **"Start a daily reflection session"**

### Option 2: Run Locally (v1.1.2)

```bash
npm install -g couchloop-eq-mcp
```

Add to Claude Desktop configuration:

```json
{
  "mcpServers": {
    "couchloop-eq": {
      "command": "couchloop-eq-mcp",
      "env": {
        "COUCHLOOP_SERVER": "https://mcp.couchloop.com"
      }
    }
  }
}
```

**New in v1.0.4**: Sessions automatically persist locally to `~/.couchloop-mcp/identity.json` - no signup required!

### For ChatGPT (Developer Mode)

ChatGPT supports MCP servers through Developer Mode. See [CHATGPT_SETUP.md](CHATGPT_SETUP.md) for detailed setup instructions.

### For Other MCP Clients

Any MCP-compatible client (Cursor, Windsurf, Continue, etc.) can connect using:
- **URL:** `https://mcp.couchloop.com/mcp`
- **Transport:** `streamable-http`
- **Auth:** None required (session-based isolation)

**Production Server Available:** `https://mcp.couchloop.com/mcp`

Quick steps:
1. Enable Developer Mode in ChatGPT Settings
2. Add as MCP connector with URL: `https://mcp.couchloop.com/mcp`
3. No authentication required - uses session-based isolation

For local development:
- Use ngrok or deploy your own server
- Follow setup in [CHATGPT_SETUP.md](CHATGPT_SETUP.md)

## Available Tools (23 total)

### Session & Journey
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

### Developer Safety
| Tool | Description |
|------|-------------|
| `validate_packages` | Catch hallucinated npm/PyPI/Maven packages before install |
| `validate_library_versions` | Check for deprecated APIs and outdated patterns |
| `scan_security` | Detect SQL injection, XSS, hardcoded secrets |
| `pre_review_code` | Screen AI code for console.logs, TODOs, missing error handling |
| `detect_code_smell` | Find verbose, over-engineered, or bloated code |

### Context & File Protection
| Tool | Description |
|------|-------------|
| `preserve_context` | Store architecture decisions across conversations |
| `get_operation_history` | Review file operations that were attempted |
| `enable_code_freeze` | Protect critical files from modification |
| `disable_code_freeze` | Re-enable file modifications |
| `protect_files` | Validate operations against protected paths |
| `rollback_file` | Restore files from backup snapshots |
| `get_protection_status` | View current file protection config |
| `list_backups` | See available backup snapshots |

## Real-World Usage

CouchLoop EQ is actively used in production development. Here's what 2 weeks of actual usage looks like:

### Usage Statistics
| Metric | Value |
|--------|-------|
| Insights captured | 49 |
| Active sessions | 5 |
| Unique tags | 85+ |
| Date range | Jan 19 - Feb 2, 2026 |

### Development Areas Tracked

| Category | Insights | Example |
|----------|----------|---------|
| 🔐 Security fixes | 12 | Auth flow hardening, validation improvements |
| 💳 Payment integration | 8 | Payment flow patterns, webhook handling |
| 📱 Mobile development | 15 | State management, navigation guards |
| 🗄️ Database operations | 6 | Data cleanup, schema optimization |
| 🏗️ Architecture decisions | 8 | Caching strategies, event patterns |

### Featured Insight: Complex Bug Resolution

```
PAYMENT FLOW BUG ROOT CAUSE IDENTIFIED:

Issue: Race condition between frontend state and backend data caused 
inconsistent user experience during payment retry flows.

Analysis: Traced through 5 components across iOS and backend to find 
the state synchronization gap.

FIX OPTIONS:
A) Data cleanup - reset stale records
B) Frontend fix - stricter validation
C) Backend fix - additional verification step

Recommended: Defense-in-depth approach combining A + B
```

This insight was captured mid-debugging session, preserved across context window resets, and referenced 3 days later when implementing the fix.

### Best Practices for Sprint Development

**Start of sprint:** Create a session to establish context
```
"Create a session for Sprint 42 - user authentication overhaul"
```

**After completing a feature:** Save insights, context, or checkpoints depending on complexity

| Feature Size | Recommended Actions |
|--------------|---------------------|
| **Small fix** | `save_insight` — Quick note of what was done and why |
| **Medium feature** | `save_insight` + `save_checkpoint` — Capture decisions and state |
| **Large feature set** | `preserve_context` + `save_checkpoint` + multiple `save_insight` — Full architecture context |

**Why this matters:** When you need to review or debug later, you can retrieve the exact context of what was just built—even weeks later, across different AI sessions.

```
"Get my insights tagged 'auth-refactor'" → Instant recall of decisions made
"Resume my Sprint 42 session" → Pick up exactly where you left off
```

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

## Screenshots

<p align="center">
  <img src="assets/screenshots/save_insights.png" alt="Save Insights" width="400" />
  <img src="assets/screenshots/checkpoint_session.png" alt="Checkpoint Session" width="400" />
  <img src="assets/screenshots/code_review_workflow.png" alt="Code Review Workflow" width="400" />
</p>

## Support

- Issues: [github.com/wisenbergg/couchloop-mcp/issues](https://github.com/wisenbergg/couchloop-mcp/issues)
- Email: support@couchloop.com

## License

MIT
