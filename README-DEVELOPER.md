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

| Problem                      | What Happens                                             | CouchLoop EQ Solution                                  |
| ---------------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| 🎭 **Hallucinated packages** | `npm install ai-super-validator` → package doesn't exist | `validate_packages` verifies against real registries   |
| 🔓 **Insecure code**         | SQL injection, XSS, hardcoded secrets                    | `scan_security` detects vulnerabilities with CWE codes |
| 📉 **Code bloat**            | Over-engineered, verbose patterns                        | `detect_code_smell` flags complexity issues            |
| 🧠 **Lost context**          | Re-explain architecture every session                    | `preserve_context` stores decisions permanently        |
| 🗂️ **Accidental deletion**   | `rm -rf` the wrong directory                             | `protect_files` + `rollback_file` with auto-backups    |
| 📚 **Deprecated APIs**       | Using outdated patterns                                  | `check_versions` warns about breaking changes          |
| 🔍 **Sloppy AI code**        | Console.logs, TODOs, missing error handling              | `pre_review_code` catches before commit                |

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
| **Small fix**         | `save_insight` — Quick note of what was done and why             |
| **Medium feature**    | `save_insight` + `save_checkpoint` — Capture decisions and state |
| **Large feature set** | `preserve_context` + `save_checkpoint` + multiple `save_insight` |

### Why This Matters

When you need to review or debug later, retrieve exact context of what was built—even weeks later:

```
"Get my insights tagged 'auth-refactor'"
"Resume my Sprint 42 session"
```

---

## Tool Reference (v1.4.0)

CouchLoop EQ now uses 10 primary tools. The `couchloop` meta-tool routes natural language to the correct tool.

> **v1.4.0 policy layer:** Every tool call passes through `sanitize → verify-if-required → normalize → log`. `code_review` and `package_audit` auto-trigger a verify pass; responses containing technical claims or code trigger full governance checks.

### Universal Entry Point

| Tool        | Purpose                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------- |
| `couchloop` | Routes any loose command: "review code", "audit packages", "brainstorm feature", "save this" |

### Developer Tools

| Tool            | Purpose                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `verify`        | Pre-delivery verification — catches AI hallucinations before presenting to users                 |
| `status`        | Dashboard — session progress, context window, saved insights                                     |
| `conversation`  | AI conversation with crisis detection and session memory                                         |
| `brainstorm`    | **Standalone dev thinking partner** — trade-off analysis, feature design, architecture decisions |
| `code_review`   | Security scan + code quality + AI error detection in one call                                    |
| `package_audit` | Validate packages exist, check versions, find vulnerabilities                                    |
| `remember`      | Store/recall context, checkpoints, insights                                                      |
| `protect`       | File backup, freeze, rollback, restore                                                           |
| `guard`         | Governance pipeline: sanitize → verify-if-required → normalize → log                            |

### Usage Examples

```
# Via couchloop (natural language)
"review this code"       → routes to code_review
"audit my dependencies"  → routes to package_audit
"brainstorm a caching layer" → routes to brainstorm
"save this context"      → routes to remember
"backup src/core/"       → routes to protect

# Direct calls (precise control)
brainstorm(message: "Redis vs Memcached for sessions?")
verify(type: "packages", content: "lodash-utils-pro")  # Catches hallucinated packages
code_review(code: "...", auto_fix: true)
package_audit(packages: ["axios", "lodash"])
remember(action: "recall")
protect(action: "freeze", path: "src/core/")
```

---

## Brainstorm Mode (NEW)

Use CouchLoop as a **thinking partner** for architecture decisions, feature design, or technology choices.

```
"brainstorm: should I use Redis or Memcached for session storage?"
```

**How it works:**

1. Asks 1-2 clarifying questions about your context (scale, team, existing stack)
2. Provides structured comparison with trade-offs
3. Gives a direct recommendation with reasoning

**Example flow:**

```
You: "brainstorm a caching layer for my API"

CouchLoop: "What's your expected request volume, and do you need
cache invalidation when data changes?"

You: "~1000 req/s, and yes invalidation matters"

CouchLoop: "Redis is your best bet. Here's why:
- Built-in pub/sub for cache invalidation
- Handles 1K req/s easily (it's designed for 100K+)
- Supports data structures you'll likely need later
- Use Redis Cluster if you grow past single-node limits

Alternative: If you're already on AWS, ElastiCache
with Redis engine simplifies operations."
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
