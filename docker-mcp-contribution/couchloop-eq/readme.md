# CouchLoop EQ — MCP Server

Your AI remembers conversations. Add persistent memory, safety checks, and developer guardrails to Claude and ChatGPT.

<p align="center">
  <img src="https://raw.githubusercontent.com/wisenbergg/couchloop-mcp/master/assets/logo/couchloop_EQ-IconLogo.png" alt="CouchLoop EQ" width="120" />
</p>

## The Problem

AI assistants forget everything between sessions. Users repeat context, lose progress on multi-step workflows, and get inconsistent responses. Worse, LLMs can hallucinate packages, introduce vulnerabilities, delete critical files, or drift into harmful territory without guardrails.

**CouchLoop EQ fixes this.** It's an MCP server with **8 primary tools** that give your AI persistent memory, intent routing, code review, pre-delivery verification, and developer protection. Just say what you want—the `couchloop` meta-tool routes to the right tool automatically.

## Quick Start (30 seconds)

### Try Without Signup

Use the public demo server to test immediately:

**For Claude Desktop**, add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "couchloop-eq": {
      "command": "npx",
      "args": ["-y", "couchloop-eq-mcp"],
      "env": {
        "COUCHLOOP_SERVER": "https://mcp.couchloop.com/mcp"
      }
    }
  }
}
```

Restart Claude and try: **"Start a daily reflection session"**

> **Demo limits:** 5 sessions/day, basic journeys only. Your data stays private via session-based isolation.

### For ChatGPT

1. Open ChatGPT → Settings → Developer Mode
2. Add MCP connector:
   - **URL**: `https://mcp.couchloop.com/mcp`
   - **Auth**: None required
3. Try: **"List available journeys"**

> **Note**: ChatGPT MCP support is in beta—expect occasional disconnects.

## Production Setup

For unlimited sessions and custom journeys:

```bash
npm install -g couchloop-eq-mcp
```

Add to Claude Desktop config:

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

**Get your API key:** [couchloop.com/signup](https://couchloop.com/signup)

## How It Works

CouchLoop runs as an MCP server between your AI client and its responses. It intercepts messages, applies safety checks, and manages session state.

```
┌─────────────────┐
│ Claude Desktop  │
│   or ChatGPT    │
└────────┬────────┘
         │ MCP Protocol
         ▼
┌─────────────────┐
│ CouchLoop EQ    │
│  ┌───────────┐  │
│  │  Safety   │  │ ← Fact-checking, tone monitoring
│  │  Layer    │  │
│  └───────────┘  │
│  ┌───────────┐  │
│  │  Session  │  │ ← State persistence, checkpoints
│  │  Manager  │  │
│  └───────────┘  │
│  ┌───────────┐  │
│  │  Journey  │  │ ← Guided workflows, templates
│  │  Engine   │  │
│  └───────────┘  │
└─────────────────┘
```

### Code Example

```javascript
import { MCPClient } from '@modelcontextprotocol/sdk';

const mcp = new MCPClient({ server: 'couchloop-eq' });

// Start a guided session
const session = await mcp.call('create_session', {
  journey: 'daily-reflection',
  userId: 'user_123'
});
// → Returns session ID and first prompt

// User completes session, days pass...

// Resume with full context restored
await mcp.call('resume_session', { userId: 'user_123' });
// → "Last time you mentioned feeling energized in the mornings.
//    How has that been this week?"
```

## Features

### Persistent Memory
- **Session state**: Conversations survive browser closes, app restarts, device switches
- **Checkpoints**: Save progress at key moments in multi-step workflows
- **Insights**: Capture and retrieve important user reflections over time
- **Context preservation**: Maintains architectural decisions and requirements across sessions

### Safety Checks
- **Fact-checking**: Catches fabricated information and unsupported claims
- **Consistency tracking**: Flags contradictions across the conversation
- **Conversation boundaries**: Detects manipulation patterns and harmful suggestions
- **Tone stability**: Maintains consistent personality without emotional drift

### Developer Protection Tools (v1.2.0)
- **Intent router**: Just say "end session", "review code", "save this"—routes automatically
- **Code review**: Security scan + quality check + AI error detection in one call
- **Package audit**: Validates packages exist across 7 registries (npm, PyPI, Maven, etc.)
- **Remember**: Context persistence across sessions—checkpoints, insights, decisions
- **Protect**: Automatic backups with rollback capability for accidental deletions

### Guided Journeys
Pre-built workflows for common use cases:

| Journey | Duration | Description |
|---------|----------|-------------|
| Daily Reflection | 5 min | Brief check-in to process your day |
| Gratitude Practice | 3 min | Notice and name things you appreciate |
| Weekly Review | 10 min | Look back and set intentions |

## Available Tools (8 Primary)

Just say what you want—the `couchloop` meta-tool routes your intent automatically.

| Tool | What It Does | Trigger Phrases |
|------|--------------|-----------------|
| `couchloop` | Universal entry point—routes ANY loose command | "end session", "start", "where should I start", "hi" |
| `verify` | Pre-delivery verification for AI-generated content | "verify this code", "check my response", "is this correct" |
| `status` | Dashboard: session progress, history, context | "how am I doing", "my settings", "show my status" |
| `conversation` | Session management and wellness workflows | "start a reflection", "end session", "resume" |
| `code_review` | Security + quality + AI error detection | "review code", "is this safe", "lint this" |
| `package_audit` | Validate packages across 7 registries | "audit dependencies", "does this package exist" |
| `remember` | Context persistence: checkpoints, insights | "save this", "remember that", "checkpoint" |
| `protect` | File backups with rollback capability | "backup my code", "rollback", "freeze" |

### Why 8 Tools?

We found that **94% of user intents** map to these 8 archetypes. Instead of exposing 23+ granular tools and expecting users to remember which one to call, CouchLoop bundles related functionality and uses intent routing.

**Example:** 
- Before: `save_checkpoint`, `get_checkpoints`, `save_insight`, `get_insights`, `preserve_context`, `store_context`, `retrieve_context`
- Now: `remember` (or just say "save this" and let `couchloop` route it)

### New in v1.2.0: Verification-First Architecture

The `verify` tool catches common AI mistakes BEFORE they reach users:
- **24%** of AI package suggestions don't exist
- **Hallucinated APIs** that compile but fail at runtime
- **ESM/CJS confusion** in TypeScript projects
- **Inconsistencies** with earlier statements in the conversation

Call `verify` before presenting code, packages, or factual claims.

## Example Usage

### Just Talk Naturally
```
"Where should I start?"
"End session"
"How am I doing?"
"Review this code before I commit"
"Verify this looks correct"
"Remember this decision: we're using ESM"
"Backup my files before I refactor"
```

### Session Management
```
"Start a daily reflection session"
"Resume my last session"
"Save this insight: I notice I'm more energized in the mornings"
```

### Developer Safety
```
"Review my code for security issues"
"Does the package 'lodash-es' exist?"
"Verify this code snippet before I show it to the user"
"Check my status - what context do you have?"
```

## Authentication

| Mode | Access | Limits | Best For |
|------|--------|--------|----------|
| **Demo** | Public server, no signup | 5 sessions/day, basic journeys | Testing, evaluation |
| **Production** | API key from couchloop.com | Unlimited sessions, custom journeys | Production apps |

## Use Cases

### For Conversation Management
- **Customer support agents**: Maintain conversation history across tickets and channels
- **Onboarding flows**: Guide users through multi-step setup with progress tracking
- **AI assistants with memory**: Remember user preferences, past decisions, and context
- **Compliance-sensitive apps**: Add safety validation for financial, legal, or healthcare AI
- **Multi-session workflows**: Any AI interaction that spans days, devices, or interruptions

### For Developer Protection
- **AI code generation**: Prevent package hallucination and dependency errors
- **Security-sensitive development**: Catch hardcoded credentials before they're committed
- **Code review automation**: Pre-screen AI suggestions for quality issues
- **Legacy code maintenance**: Detect deprecated APIs and version incompatibilities
- **Critical file protection**: Automatic backups before AI-driven refactoring

> **Building wellness or therapeutic apps?** See our [wellness integration guide](https://couchloop.com/docs/wellness) for purpose-built journeys and crisis detection features.


## Support

- **Issues**: [github.com/wisenbergg/couchloop-mcp/issues](https://github.com/wisenbergg/couchloop-mcp/issues)
- **Email**: support@couchloop.com
- **Docs**: [couchloop.com/docs](https://couchloop.com/docs)

## License

MIT
