# CouchLoop EQ — Developer Safety Tools

**Catch AI mistakes before they ship.**

<p align="center">
  <img src="https://raw.githubusercontent.com/wisenbergg/couchloop-mcp/master/assets/logo/couchloop_EQ-IconLogo.png" alt="CouchLoop EQ" width="120" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/couchloop-eq-mcp"><img src="https://img.shields.io/npm/v/couchloop-eq-mcp.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

---

## The Problem

AI coding assistants hallucinate. They suggest packages that don't exist, generate insecure code, and lose context mid-conversation. CouchLoop EQ catches these problems before they hit production.

| Problem                      | What Happens                                             | CouchLoop EQ Solution                                    |
| ---------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| 🎭 **Hallucinated packages** | `npm install ai-super-validator` → package doesn't exist | `review(mode: "packages")` verifies against real registries |
| 🔓 **Insecure code**         | SQL injection, XSS, hardcoded secrets                    | `review(mode: "code")` detects vulnerabilities with CWE codes |
| 📉 **Code bloat**            | Over-engineered, verbose patterns                        | `review(mode: "code")` flags complexity issues             |
| 🧠 **Lost context**          | Re-explain architecture every session                    | `memory` stores decisions permanently                     |
| 📚 **Deprecated APIs**       | Using outdated patterns                                  | `review(mode: "packages")` warns about breaking changes   |
| 🔍 **Sloppy AI code**        | Console.logs, TODOs, missing error handling              | `review(mode: "verify")` catches before commit             |

---

## Quick Start

### Connect to Hosted Server

**Endpoint:** `https://mcp.couchloop.com/mcp`

Add to your MCP client configuration:

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

Works with Claude Desktop, Cursor, Windsurf, VS Code, and any MCP-compatible client.

### Run Locally

```bash
npm install -g couchloop-eq-mcp
```

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

---

## Developer Tools

### Package Validation

Catch hallucinated packages before `npm install` fails:

```
"Validate these packages: react-native-super-auth, axios, lodash-utils-pro"
```

**Output:**

```
✅ axios — verified on npm
❌ react-native-super-auth — NOT FOUND (did you mean react-native-auth?)
❌ lodash-utils-pro — NOT FOUND (did you mean lodash?)
```

### Security Scanning

Detect vulnerabilities before code review:

```
"Scan this code for security issues:
const query = `SELECT * FROM users WHERE id = ${userId}`"
```

**Output:**

```
🔴 CRITICAL: SQL Injection (CWE-89)
   Line 1: String interpolation in SQL query
   Fix: Use parameterized queries
```

### Pre-Review Screening

Catch sloppy code before committing:

```
"Pre-review this function for issues"
```

**Detects:**

- Console.log statements left in
- TODO/FIXME comments
- Missing error handling
- Hardcoded values
- Type issues
- Complexity problems

### Code Smell Detection

Find over-engineering and bloat:

```
"Check this code for smells and complexity"
```

**Metrics:**

- Cyclomatic complexity
- Nesting depth
- Function length
- Duplicate patterns

### Context Preservation

Store architecture decisions across sessions:

```
"Store this context: We're using event sourcing for the order system
because we need full audit trails and replay capability"
```

**Later, in a new session:**

```
"Get my architecture context for the order system"
```

→ Instant recall of decisions made weeks ago

### File Protection

Prevent accidental destructive operations:

```
"Enable code freeze for src/core/"
```

- Protected paths can't be deleted
- Automatic backups before modifications
- Rollback capability if something goes wrong

---

## Best Practices for Sprint Development

### Start of Sprint

Create a session to establish context:

```
"Create a session for Sprint 42 - user authentication overhaul"
```

### After Completing Features

| Feature Size          | Recommended Actions                                              |
| --------------------- | ---------------------------------------------------------------- |
| **Small fix**         | `memory(action: "save")` with type `insight` — Quick note       |
| **Medium feature**    | `memory(action: "save")` with `insight` + `checkpoint`           |
| **Large feature set** | Multiple `memory` saves (insight, checkpoint, decision)          |

### Why This Matters

When you need to review or debug later, retrieve exact context of what was built—even weeks later:

```
"Get my insights tagged 'auth-refactor'"
"Resume my Sprint 42 session"
```

---

## Tool Reference (v2.1.0)

CouchLoop EQ uses 4 primary tools. Each tool has a clear, focused responsibility.

> **v2.1.0 policy layer:** Every tool call passes through `withPolicy()` which auto-invokes the `guard` (governance) on every response. The `review` tool combines code review, package audit, and verification into one tool with modes.

### Core Tools

| Tool            | Purpose                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `memory`        | **Hero tool** — save/recall context, checkpoints, insights, decisions (Supabase-backed)          |
| `conversation`  | AI conversation with crisis detection, journeys, and session memory                              |
| `review`        | Unified code review, package audit, and verification. Modes: code, packages, verify, full        |
| `status`        | Dashboard — session progress, context window, saved insights                                     |

### Internal (auto-invoked, not user-facing)

| Tool    | Purpose                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------ |
| `guard` | Per-turn governance — auto-invoked by policy wrapper, threshold-gated at 50KB                    |

### Usage Examples

```
# Direct calls
review(mode: "code", code: "function foo()...")  # Security + quality analysis
review(mode: "packages", content: "lodash-utils-pro")  # Catches hallucinated packages
review(mode: "verify", content: "AI response to check")  # Pre-delivery verification
review(mode: "full", code: "...")  # All checks combined
memory(action: "save", content: "Architecture uses event sourcing")
memory(action: "recall")  # Get all saved context
conversation(action: "start", message: "Begin daily reflection")
status()  # System dashboard
```

---

## Unified Review Tool

The `review` tool replaces the old standalone `code_review`, `package_audit`, and `verify` tools with a single unified interface:

| Mode       | What It Does                                                    |
| ---------- | --------------------------------------------------------------- |
| `code`     | Security scan + code quality + AI error detection               |
| `packages` | Validate packages exist across 7 registries, check versions     |
| `verify`   | Pre-delivery verification — catches hallucinations before users |
| `full`     | All of the above in one pass                                    |

```
"Review my code for security issues"  →  review(mode: "code")
"Does the package 'lodash-es' exist?" →  review(mode: "packages")
"Verify this before I show the user"  →  review(mode: "verify")
```

---

## Real-World Usage

From 2 weeks of production development:

| Category        | Insights Saved | Examples                                 |
| --------------- | -------------- | ---------------------------------------- |
| 🔐 Security     | 12             | Auth flow improvements, validation fixes |
| 💳 Payments     | 8              | Payment patterns, webhook handling       |
| 📱 Mobile       | 15             | State management, navigation guards      |
| 🏗️ Architecture | 8              | Caching strategies, event patterns       |

**Example: Complex Bug Resolution**

A payment flow race condition was tracked across 5 debugging sessions:

1. Initial symptom → saved as insight
2. Client-side investigation → checkpoint
3. Root cause found → architecture context stored
4. Fix options analyzed → insight with tags
5. Implementation verified → final checkpoint

Each piece persisted across context window resets, enabling continuous progress.

---

## Privacy

**CouchLoop EQ stores zero personal data.**

| What We Store               | What We Don't         |
| --------------------------- | --------------------- |
| Session IDs (anonymous)     | ❌ Emails             |
| Your saved insights         | ❌ Names              |
| Checkpoint progress         | ❌ Passwords          |
| Context you explicitly save | ❌ API keys / secrets |

- **No authentication required** — sessions are anonymous
- **No tracking** — no analytics, no telemetry
- **No data sharing** — nothing goes to third parties
- **You control deletion** — your session, your data

## Support

- [GitHub Issues](https://github.com/wisenbergg/couchloop-mcp/issues)
- Email: support@couchloop.com

## See Also

- [Main README](README.md) — Overview of all features
- [Wellness Guide](README-WELLNESS.md) — Sessions, journeys, and reflection tools

## License

MIT
