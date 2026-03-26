# CouchLoop Agent Runtime Contract v2

> **Status**: v2.0 — rewritten to reflect v2.1.0 tool consolidation (10→4 public tools).
> **Scope**: Every request handled by the MCP server, regardless of transport (stdio, SSE, HTTP).
> **Date**: March 25, 2026

---

## 1. Canonical Request Lifecycle

```
input (raw MCP tool call)
  │
  ▼
[1] VALIDATE inputs
  │  └─ Zod schema parse (throws ValidationError on failure)
  │  └─ sanitizeText / sanitizeCode applied to all user-supplied strings
  │
  ▼
[2] AUTHORIZE session
  │  └─ getOrCreateSession() — implicit session always exists
  │  └─ session must be status='active' for stateful writes
  │
  ▼
[3] ROUTE
  │  ├─ THERAPEUTIC path → sendMessage → shrink-chat backend
  │  └─ TOOL path       → handler function (local, no network)
  │
  ▼
[4] EXECUTE via withPolicy() wrapper
  │  └─ Primary tool handler runs
  │  └─ Composite tools fan out to sub-handlers in parallel (Promise.allSettled)
  │
  ▼
[5] GUARD (auto-invoked by policy wrapper)
  │  └─ Threshold-gated: skipped for responses > 50KB
  │  └─ Exempt tools: guard, memory
  │  └─ Actions: pass, modified, or blocked
  │  └─ On block: response fully reassigned via sanitizeUniversalResponse()
  │
  ▼
[6] SELF-CORRECT (conversation path only)
  │  └─ If crisis_requires_intervention=true → revision round-trip to shrink-chat
  │  └─ Max 1 revision attempt per message
  │
  ▼
[7] PERSIST STATE (if needed)
  │  └─ Checkpoints: explicit via memory(action: save) tool
  │  └─ Insights: explicit via memory(action: save, type: insight)
  │  └─ Context: explicit via memory(action: save)
  │  └─ Governance audit log: written only when issues detected
  │
  ▼
[8] RETURN structured response
     └─ sanitizeUniversalResponse() normalizes all tool output
     └─ guard_result attached to response envelope when guard ran
     └─ success | partial_success | rollback shape (see §8)
```

---

## 2. Tool Responsibilities and Call Permissions

### 2.1 Public tools (4 — visible to MCP clients)

| Tool | Responsibility | Calls internally |
|---|---|---|
| `memory` | **Hero tool** — save/recall context, checkpoints, insights, decisions (Supabase-backed). Actions: save, recall, list | `handleSmartContext`, `getCheckpoints`, `getInsights`, `getUserContext` |
| `conversation` | AI chat with journey support and crisis detection | `sendMessage`, `createSession`, `endSession`, `resumeSession`, `getJourneyStatus` |
| `review` | Unified code review, package audit, and verification. Modes: code, packages, verify, full | `handleScanSecurity`, `handlePreReviewCode`, `handleDetectCodeSmell`, `handlePreventAIErrors`, `handleValidatePackages`, `handleCheckVersions` (parallel) |
| `status` | Dashboard — session, history, context, preferences | `getUserContext`, DB reads |

### 2.2 Internal tools (not exposed to users)

| Tool | Responsibility | Invocation |
|---|---|---|
| `guard` | Per-turn governance (hallucination, safety, clinical detection). **Auto-invoked by withPolicy() wrapper — never called by users.** Threshold-gated at 50KB. | `GovernancePipeline`, `InterventionEngine` |

### 2.3 Tool-to-tool call rules

**Allowed:**
- `conversation` → `sendMessage` (one level deep)
- `review` → sub-handlers in parallel via Promise.allSettled
- `memory` → `handleSmartContext` → (`saveCheckpoint`, `saveInsight`, `storeContext`) sequentially
- `status` → `getInsights`, `getUserContext` (all reads)

**Forbidden:**
- No tool may call `conversation` internally (would create recursive network calls).
- No tool may call `guard` directly — it is auto-invoked by the policy wrapper only.
- `sendMessage` does not call any MCP tool. It calls `shrinkChatClient` (external service) only.

---

## 3. Routing Decision: shrink-chat vs. local tool

| Condition | Destination |
|---|---|
| Tool is `conversation` | **shrink-chat** (`sendMessage` → `shrinkChatClient`) |
| Tool is `memory`, `review`, `status` | **local handler** (no network call) |
| shrink-chat unreachable (timeout / ECONNREFUSED) | **handleLocalFallback** (graceful degraded response, no throw) |

### 3.1 shrink-chat invariants

- Every `sendMessage` call requires a `threadId` (created on first use, stored on `sessions.threadId`).
- Message history is **owned by shrink-chat** via `threadId`. The MCP server does not reconstruct history from checkpoints.
- `memoryContext` (userId, conversationType, emotionalState) is sent on every call.
- `idempotencyKey` (UUID v4) is generated per request to prevent duplicate processing.
- Timeout: `SEND_MESSAGE_TIMEOUT` env var (default 60 000 ms). Hard abort via `Promise.race`.

---

## 4. Policy Wrapper (withPolicy)

Every public tool is wrapped with `withPolicy()` before registration. This wrapper:

1. Executes the tool handler
2. Normalizes the response via `sanitizeUniversalResponse()`
3. Auto-invokes `guard` on the response (unless exempt or oversized)
4. If guard blocks: fully reassigns sanitized response — no key leakage from original
5. Attaches `guard_result` to normalized response envelope
6. Logs policy decision trace

### 4.1 Guard exemptions

- **Exempt tools:** `guard`, `memory` (in `GUARD_EXEMPT_TOOLS` set)
- **Size threshold:** Responses > 50KB (`GUARD_MAX_RESPONSE_BYTES = 50_000`) skip guard
- **Failure mode:** Fail-open — if guard errors, original response is delivered

---

## 5. Preconditions and Postconditions

### 5.1 Preconditions

| Precondition | Enforcement point |
|---|---|
| Input validates against Zod schema | `ToolSchema.parse(args)` — throws `ValidationError` on failure |
| User-supplied strings are sanitized | `sanitizeText()` / `sanitizeCode()` called before processing |
| Session exists and is `active` for stateful writes | `getOrCreateSession()` — creates implicitly |
| shrink-chat is reachable (conversation path) | Checked by `withTimeout()`; fallback fires on failure |

### 5.2 Postconditions

| Postcondition | Enforcement point |
|---|---|
| All responses normalized | `sanitizeUniversalResponse()` in policy wrapper |
| Guard governance applied | Auto-invoked by `withPolicy()` (unless exempt/oversized) |
| `session.lastActiveAt` is updated | Fire-and-forget update in `getOrCreateSession()` |
| Crisis responses are self-corrected | `sendMessage` checks `crisis_requires_intervention` |

---

## 6. Review Tool Modes

The `review` tool replaces the old `code_review`, `package_audit`, and `verify` standalone tools.

| Mode | What it does | Sub-handlers |
|---|---|---|
| `code` | Security scan + code quality + AI error detection | `handleScanSecurity`, `handlePreReviewCode`, `handleDetectCodeSmell`, `handlePreventAIErrors` |
| `packages` | Dependency validation, version checks, vulnerability scan | `handleValidatePackages`, `handleCheckVersions` |
| `verify` | Pre-delivery verification — catches hallucinations | `handlePreventAIErrors`, `PackageBlocker` |
| `full` | All of the above in one pass | All sub-handlers in parallel |

Composite modes use `Promise.allSettled` — a sub-check failure is recorded but does not fail the parent.

---

## 7. State Written to Memory and When

### 7.1 Database tables and write triggers

| Table | Written when | By whom |
|---|---|---|
| `users` | First stateful tool use (implicit creation) | `getOrCreateSession` |
| `sessions` | First stateful tool use; `createSession` | `getOrCreateSession`, `createSession` |
| `sessions.lastActiveAt` | Every tool call that uses a session | `getOrCreateSession` (fire-and-forget) |
| `sessions.currentStep` | `saveCheckpoint` with `advance_step=true` | `saveCheckpoint` |
| `sessions.status` | `endSession`, journey completion | `session-manager`, `saveCheckpoint` |
| `sessions.threadId` | First `sendMessage` call for session | `sendMessage` |
| `checkpoints` | explicit via `memory(action: save)` tool | `checkpoint.ts` |
| `insights` | explicit via `memory(action: save, type: insight)` | `checkpoint.ts`, `insight.ts` |
| `context entries` | explicit via `memory(action: save)` | `context-manager.ts` |
| `crisisEvents` | `sendMessage` — when `crisis_level >= 7` | `sendMessage` |
| `governanceEvaluations` | After every `sendMessage` (async, non-blocking) | `runAsyncGovernanceEvaluation` |

### 7.2 In-memory state

| State | Scope | Invalidation |
|---|---|---|
| `activeSessionCache` (Map) | Per-process | Cache miss → DB lookup; `endSession` removes entry |
| `cachedToolDefinitions` | Per-process | `Object.freeze()` at startup — never invalidated |
| Tool registry (Map in intent-router) | Per-process | `registerTools()` re-call clears and repopulates |

---

## 8. Success, Partial Success, and Failure

### 8.1 Response shapes

**Success**
```json
{
  "success": true,
  "guard_result": { "action": "pass" }
}
```

**Partial success** (composite tools, e.g., `review(mode: "full")`)
```json
{
  "success": true,
  "partial": true,
  "checks_run": ["security", "quality", "packages"],
  "checks_failed": ["ai-errors"],
  "all_issues": [...],
  "summary": "..."
}
```

**Failure**
```json
{
  "success": false,
  "error": "human-readable message"
}
```

**Guard blocked**
```json
{
  "success": false,
  "guard_result": { "action": "blocked", "reason": "..." }
}
```

---

## 9. Failure Handling and Error Classes

| Error class | HTTP equiv | When thrown |
|---|---|---|
| `ValidationError` | 400 | Zod parse failure, missing required fields |
| `AuthenticationError` | 401 | Token missing or invalid |
| `AuthorizationError` | 403 | Operation on protected resource without permission |
| `NotFoundError` | 404 | Session, journey, or backup ID not found |
| `ConflictError` | 409 | Duplicate resource creation |
| `DatabaseError` | 500 | DB query failure |
| `CouchLoopError` (base) | 500 | Any other internal failure |

All tool handlers wrap execution in `try/catch` and return `{ error: string }` rather than throwing to the MCP transport layer.

---

## 10. Domain Detection and Priority

The `guard` tool classifies inputs into domains. **Clinical always takes priority over dev:**

```
clinicalScore >= 1  →  domain = 'clinical'  (crisis resources, safe language)
devScore >= 2       →  domain = 'dev'        (package validation, code review)
else                →  domain = 'unknown'    (general conversation fallback)
```

Clinical domain triggers:
- Higher `guard` intervention threshold (protect user safety first)
- `sendMessage` self-correction on any `crisis_requires_intervention=true`
- `crisisEvents` DB write when `crisis_level >= 7`

---

## 11. Logging Schema

Every significant event is logged via `logger` (structured JSON). Required fields:

```typescript
{
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  sessionId?: string,
  userId?: string,
  toolName?: string,
  durationMs?: number,
  error?: string,
  stack?: string,   // development only
}
```

### 11.1 What must NOT be logged

- Raw user message content at `info` or above (debug only)
- Authentication tokens or credentials
- Full stack traces in production
- Sensitive metadata stripped by `sanitizeUniversalResponse()`
