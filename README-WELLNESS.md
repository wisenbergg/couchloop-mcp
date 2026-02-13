# CouchLoop EQ — Wellness & Reflection Tools

**AI-guided sessions that remember where you left off.**

<p align="center">
  <img src="https://raw.githubusercontent.com/wisenbergg/couchloop-mcp/master/assets/logo/couchloop_EQ-IconLogo.png" alt="CouchLoop EQ" width="120" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/couchloop-eq-mcp"><img src="https://img.shields.io/npm/v/couchloop-eq-mcp.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

---

## What is CouchLoop EQ?

CouchLoop EQ is an MCP server that adds memory and structure to AI conversations. Unlike standard AI chats that forget everything between sessions, CouchLoop EQ:

- **Remembers** your insights and progress
- **Guides** you through structured journeys
- **Persists** across conversations and context windows
- **Detects** when you might need support

Perfect for daily reflection, gratitude practice, journaling, and personal growth work with AI assistants.

---

## Quick Start

### Connect to Hosted Server

**Endpoint:** `https://mcp.couchloop.com/mcp`

For Claude Desktop, add to your config:

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

Restart Claude and try:

```
"Start a daily reflection session"
```

---

## Available Journeys

### Daily Reflection (5 min)

A brief check-in to process your day.

```
"Start a daily reflection"
```

Steps through:

1. How are you feeling right now?
2. What's on your mind today?
3. What would make today successful?
4. Any insights to capture?

### Gratitude Practice (3 min)

Notice and name three things you appreciate.

```
"Start a gratitude practice"
```

### Weekly Review (10 min)

Look back on your week and set intentions.

```
"Start a weekly review"
```

Steps through:

1. Highlights from the week
2. Challenges faced
3. Lessons learned
4. Intentions for next week

---

## Core Features (v1.3.1)

CouchLoop EQ now uses 9 primary tools. Just say what you want—the `couchloop` intent router handles the rest.

### Quick Commands

```
"end session"            → ends and saves current session
"save this insight"      → captures to remember tool
"start daily reflection" → begins conversation journey
"how am I doing"         → retrieves your context and insights
"brainstorm this"        → reflective thinking partner mode
"help"                   → shows all capabilities
```

### Brainstorm Mode (NEW)

Use CouchLoop as a reflective thinking partner—not just for technical decisions, but for personal exploration:

```
"brainstorm: I'm feeling stuck in my current routine"
```

CouchLoop asks clarifying questions to help you think through what's really going on, rather than jumping to solutions. Great for:

- Exploring feelings or patterns you've noticed
- Thinking through life decisions
- Processing something that happened
- Clarifying what you actually want

### Sessions

Sessions provide continuity across conversations:

```
"Create a session for my morning check-in"
```

Later:

```
"Resume my last session"
```

Your progress, mood, and context are preserved.

### Insights

Capture meaningful moments that you want to remember:

```
"Save this insight: I notice I'm more creative after morning walks"
```

Retrieve them anytime:

```
"Get my recent insights"
"Get insights tagged 'creativity'"
```

### Checkpoints

Save progress at key moments:

```
"Save a checkpoint: completed week 2 of meditation practice"
```

### User Context

CouchLoop EQ learns your patterns over time:

```
"Get my user context"
```

Returns:

- Recent session summaries
- Common themes in your insights
- Patterns in your check-ins

---

## Example Conversations

### Morning Check-In

**You:** Start a daily reflection session

**AI:** _Creates session, begins guided check-in_

How are you feeling this morning?

**You:** A bit anxious about the presentation today

**AI:** _Acknowledges, asks follow-up_

That makes sense. What would help you feel more prepared?

**You:** Actually, I realized I know this material well. Save that insight.

**AI:** _Saves insight with context_

Captured: "Realized I know the presentation material well - anxiety was unfounded"

### Continuing Later

**You:** Resume my session

**AI:** _Restores context_

Welcome back. Earlier today you were feeling anxious about your presentation but realized you knew the material well. How did it go?

---

## Tool Reference

| Tool                 | Purpose                                      |
| -------------------- | -------------------------------------------- |
| `create_session`     | Start a new guided session                   |
| `resume_session`     | Continue where you left off                  |
| `send_message`       | Send a message through the therapeutic stack |
| `save_checkpoint`    | Capture progress at a key moment             |
| `get_checkpoints`    | Retrieve all checkpoints for a session       |
| `list_journeys`      | See available guided journeys                |
| `get_journey_status` | Check progress in current journey            |
| `save_insight`       | Capture a meaningful realization             |
| `get_insights`       | Retrieve saved insights                      |
| `get_user_context`   | Get personalization context                  |

---

## Safety Features

### Crisis Detection

CouchLoop EQ monitors for signs of distress and can:

- Acknowledge difficult emotions
- Suggest appropriate resources
- Maintain supportive boundaries

### Behavioral Guardrails

The system prevents:

- Clinical overreach (not a replacement for therapy)
- Dependency-forming language
- Harmful advice
- Inappropriate moralizing

### Privacy

**CouchLoop EQ stores zero personal data.**

| What We Store           | What We Don't         |
| ----------------------- | --------------------- |
| Session IDs (anonymous) | ❌ Emails             |
| Your saved insights     | ❌ Names              |
| Checkpoint progress     | ❌ Passwords          |
| Journey state           | ❌ API keys / secrets |

- **No authentication required** — sessions are completely anonymous
- **No tracking** — no analytics, no telemetry, no cookies
- **No data sharing** — nothing goes to third parties
- **Sessions isolated** — no data shared between users
- **You control deletion** — your session, your data

---

## Tips for Best Use

### Be Consistent

Regular check-ins build better context. Even a 3-minute daily reflection compounds over time.

### Tag Your Insights

Tags make retrieval easier:

```
"Save insight: Exercise helps my focus. Tags: health, productivity, morning"
```

### Use Journeys for Structure

When you're not sure what to reflect on, journeys provide guided prompts.

### Review Periodically

```
"Get my insights from the past week"
```

Patterns often become visible only in retrospect.

---

## Support

- [GitHub Issues](https://github.com/wisenbergg/couchloop-mcp/issues)
- Email: support@couchloop.com

## See Also

- [Main README](README.md) — Overview of all features
- [Developer Guide](README-DEVELOPER.md) — Code safety and context tools

## License

MIT
