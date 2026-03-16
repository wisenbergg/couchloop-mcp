# CouchLoop Agent Runtime Contract v1

> **Status**: v1.1 — corrections applied after March 16, 2026 audit. See `RUNTIME_UPGRADE_PLAN.md` for gap matrix and upgrade tasks.
> **Scope**: Every request handled by the MCP server, regardless of transport (stdio, SSE, HTTP).
> **Date**: March 16, 2026 (v1.1 corrections: March 16, 2026)

---

## 1. Canonical Request Lifecycle

```
input (raw MCP tool call)
  │
  ▼
[1] CLASSIFY intent
  │  └─ couchloop router: regex patterns → tool + action
  │  └─ or: direct tool call with schema validation (Zod)
  │
  ▼
[2] VALIDATE inputs
  │  └─ Zod schema parse (throws ValidationError on failure)
  │  └─ sanitizeText / sanitizeCode applied to all user-supplied strings
  │
  ▼
[3] AUTHORIZE session
  │  └─ getOrCreateSession() — implicit session always exists
  │  └─ session must be status='active' for stateful writes
  │
  ▼
[4] ROUTE
  │  ├─ THERAPEUTIC path → sendMessage → shrink-chat backend
  │  └─ TOOL path       → handler function (local, no network)
  │
  ▼
[5] EXECUTE
  │  └─ Primary tool handler runs
  │  └─ Composite tools fan out to sub-handlers in parallel (Promise.allSettled)
  │
  ▼
[6] SELF-CORRECT (conversation path only)
  │  └─ If crisis_requires_intervention=true → revision round-trip to shrink-chat
  │  └─ Max 1 revision attempt per message
  │
  ▼
[7] VERIFY (explicit or intent-router-triggered only)
  │  └─ verify tool: code | packages | facts | response | all
  │  └─ NOT automatically invoked — must be called by the AI client or via couchloop
  │  └─ Async post-delivery governance for conversation turns only:
  │       runAsyncGovernanceEvaluation() — non-blocking, shadow mode (log-only, never blocks)
  │  └─ guard tool (explicit call): enforce mode by default, CAN block delivery
  │
  ▼
[8] PERSIST STATE (if needed)
  │  └─ Checkpoints: explicit saveCheckpoint() via remember tool — NOT from sendMessage
  │  └─ Insights: explicit saveInsight(), or saveCheckpoint with save_as_insight=true
  │  └─ Context: explicit storeContext() via preserve-context
  │  └─ Governance audit log: written only when issues detected
  │
  ▼
[9] NOTE: protect is NOT a lifecycle step.
  │  File protection is an independently-invoked tool.
  │  It does not intercept any operation unless explicitly called.
  │
  ▼
[10] RETURN structured response
     └─ sanitizeResponse() strips sensitive metadata (conversation path only)
     └─ Other tools return raw handler output — see §5.3 for sanitize gap
     └─ success | partial_success | rollback shape (see §9)
```

---

## 2. Intent Classification

### 2.1 Routing entry points

| Entry | How it works |
|---|---|
| `couchloop` tool (intent router) | Regex pattern matching against the `command` string. First match wins. Priority order is encoded in `INTENT_MAPPINGS` array order. |
| Direct tool call | AI client calls a named tool directly (e.g., `verify`, `code_review`). Bypasses the router entirely — Zod schema validates immediately. |

### 2.2 Classification output

```typescript
{
  tool: string,        // target tool name
  action?: string,     // sub-action within tool
  confidence: number,  // 0.9 = pattern match, 0.5 = default fallback
  args: Record<string, unknown>
}
```

### 2.3 Fallback rule

If no pattern matches in the intent router, the request routes to **`conversation` / action=`send`**. Confidence is 0.5. This is the only valid fallback — no silent discards.

---

## 3. Routing Decision: shrink-chat vs. local tool

| Condition | Destination |
|---|---|
| Tool is `conversation` or `brainstorm` | **shrink-chat** (`sendMessage` → `shrinkChatClient`) |
| Tool is `code_review`, `package_audit`, `remember`, `protect`, `status`, `verify`, `guard` | **local handler** (no network call) |
| `couchloop` routes to any non-conversation tool | **local handler** |
| Shrink-chat unreachable (timeout / ECONNREFUSED) | **`handleLocalFallback`** (graceful degraded response, no throw) |

### 3.1 shrink-chat invariants

- Every `sendMessage` call requires a `threadId` (created on first use, stored on `sessions.threadId`).
- Message history is **owned by shrink-chat** via `threadId`. The MCP server does not reconstruct history from checkpoints.
- `memoryContext` (userId, conversationType, emotionalState) is sent on every call.
- `idempotencyKey` (UUID v4) is generated per request to prevent duplicate processing.
- Timeout: `SEND_MESSAGE_TIMEOUT` env var (default 60 000 ms). Hard abort via `Promise.race`.

---

## 4. Tool Responsibilities and Call Permissions

### 4.1 Public tools (visible to MCP clients)

| Tool | Responsibility | Calls internally |
|---|---|---|
| `couchloop` | Intent classification, route dispatch | Any registered tool handler |
| `guard` | Per-turn governance (hallucination, package safety, clinical detection). **Must be called explicitly — no automatic invocation path exists.** | `GovernancePipeline`, `InterventionEngine`, `scanPackageList` |
| `verify` | Pre-delivery verification on demand | `AIErrorPreventer`, `PackageBlocker`, `EvaluationEngine` |
| `status` | Dashboard — session, history, context, protection | `getProtectionStatus`, `listBackups`, `getUserContext`, DB reads |
| `conversation` | AI chat with journey support and crisis detection | `sendMessage`, `createSession`, `endSession`, `resumeSession`, `getJourneyStatus` |
| `brainstorm` | Dev ideation via reflective questioning | `sendMessage` (with brainstorm system prompt) |
| `code_review` | Full code analysis in one call | `handleScanSecurity`, `handlePreReviewCode`, `handleDetectCodeSmell`, `handlePreventAIErrors` (parallel) |
| `package_audit` | Dependency validation and upgrade reports | `handleComprehensivePackageAudit` → `handleValidatePackages`, `handleCheckVersions`, `handleGenerateUpgradeReport` |
| `remember` | Context capture and recall | `handleSmartContext`, `getCheckpoints`, `getInsights`, `getUserContext` |
| `protect` | File safety, backups, rollback, code freeze | `protectFiles`, `getProtectionStatus`, `listBackups`, `rollbackFile`, `enableCodeFreeze` |

### 4.2 Tool-to-tool call rules

**Allowed:**
- `couchloop` → any tool handler (it is the universal dispatcher)
- `conversation` / `brainstorm` → `sendMessage` (one level deep)
- `code_review` → (`handleScanSecurity`, `handlePreReviewCode`, `handleDetectCodeSmell`, `handlePreventAIErrors`) in parallel
- `package_audit` → (`handleValidatePackages`, `handleCheckVersions`, `handleGenerateUpgradeReport`) in parallel
- `remember` → `handleSmartContext` → (`saveCheckpoint`, `saveInsight`, `storeContext`) **sequentially** (not parallel — see §13 gap 7)
- `checkpoint.saveCheckpoint` → `storeContext` (one level deep, for context-type saves)
- `status` → `getProtectionStatus`, `listBackups`, `getInsights`, `getUserContext` (all reads)

**Forbidden:**
- No tool may call `conversation` or `brainstorm` internally (would create recursive network calls).
- No tool may call `guard` or `verify` internally as blocking gates (governance is either async-post or explicit-on-demand).
- No tool may call `protect` automatically — protection is caller-opt-in or triggered by destructive op classification.
- `sendMessage` does not call any MCP tool. It calls `shrinkChatClient` (external service) only.

---

## 5. Preconditions and Postconditions

### 5.1 Preconditions (must hold before execution)

| Precondition | Enforcement point |
|---|---|
| Input validates against Zod schema | `ToolSchema.parse(args)` — throws `ValidationError` on failure |
| User-supplied strings are sanitized | `sanitizeText()` / `sanitizeCode()` called before any processing or storage |
| Session exists and is `active` for stateful writes | `getOrCreateSession()` — creates implicitly; write ops check `session.status !== 'active'` |
| Destructive file op is permitted | `fileGuardian.validateOperation()` returns `allowed=true` before file write proceeds |
| shrink-chat is reachable (conversation path) | Checked by `withTimeout()`; fallback fires on failure |

### 5.2 Postconditions (guaranteed after success)

| Postcondition | Enforcement point |
|---|---|
| Response strips sensitive metadata | `sanitizeResponse()` called on every `sendMessage` return |
| `session.lastActiveAt` is updated | Fire-and-forget update in `getOrCreateSession()` |
| Destructive ops create a backup first | `autoBackup.createBackup()` fires before `allowed` destructive write |
| Conversation governance is logged | `runAsyncGovernanceEvaluation()` fires post-delivery (non-blocking) |
| Crisis responses are self-corrected | `sendMessage` checks `crisis_requires_intervention` and requests revision before returning |

---

## 6. When `verify` Is Mandatory vs. Optional

| Scenario | `verify` requirement |
|---|---|
| User explicitly asks to verify content | **Caller-initiated** — couchloop routes to `verify`, or client calls directly |
| User's input matches verify intent patterns (double-check, fact-check, etc.) | **Caller-initiated** — couchloop routes here |
| AI is about to present package recommendations | **Caller-opt-in only** — no automatic enforcement |
| AI generates code blocks | **Caller-opt-in only** — no automatic enforcement |
| Routine chat responses without code/packages | **Not required** |
| Post-delivery governance on conversation turns | **Automatic** — `runAsyncGovernanceEvaluation` always fires after `sendMessage` (shadow/log-only) |

`verify` is a **manually-invoked analysis tool**. It does not intercept any response automatically.

The `guard` tool, when called explicitly, runs in `enforce` mode by default and CAN return `action: 'blocked'` or `action: 'modified'`.

Environment variable `GOVERNANCE_DEFAULT_MODE` (values: `enforce` | `shadow` | `bypass`, default: `shadow`) controls the `guard` tool's default mode when the `mode` parameter is not provided.

---

## 7. When `protect` Is Invoked Automatically

`protect` is **never invoked automatically by the system**. It is:

1. **Caller-initiated** — the AI or user explicitly calls `protect` with an action.
2. **Embedded in the destructive op path** — when `protectFiles()` is called directly (e.g., from the `protect` tool handler's `check` action), the file guardian runs before proceeding.
3. **Auto-backup on allowed destructive ops** — when `protectFiles()` validates and allows a `delete` or `overwrite`, `autoBackup.createBackup()` fires automatically as a postcondition.

**`protect` does NOT intercept file system operations made outside of MCP tool calls.** It only applies when `protectFiles()` is explicitly invoked.

**Additional constraints:**
- `CODE_FREEZE_MODE` env var is read only at `FileGuardian` construction. A code freeze cannot be enabled without restarting the process or explicitly calling `protect({ action: 'freeze' })` at runtime.
- The in-memory `operationLog` in `FileGuardian` is **not durable**. It is lost on process restart. Rollback is only available for operations that occurred within the current process lifetime.
- The `protect` tool's `check` and `backup` actions require `path` to be provided, but the current schema does not validate this. Callers must include `path` or the operation will fail silently.

---

## 8. State Written to Memory and When

### 8.1 Database tables and write triggers

| Table | Written when | By whom |
|---|---|---|
| `users` | First stateful tool use (implicit creation) | `getOrCreateSession` |
| `sessions` | First stateful tool use; `createSession` | `getOrCreateSession`, `createSession` |
| `sessions.lastActiveAt` | Every tool call that uses a session | `getOrCreateSession` (fire-and-forget) |
| `sessions.currentStep` | `saveCheckpoint` with `advance_step=true` | `saveCheckpoint` |
| `sessions.status` | `endSession`, journey completion | `session-manager`, `saveCheckpoint` |
| `sessions.threadId` | First `sendMessage` call for session | `sendMessage` |
| `checkpoints` | `saveCheckpoint` — explicit or when `save_checkpoint=true` in `sendMessage` | `checkpoint.ts` |
| `insights` | `saveCheckpoint` with `save_as_insight=true`; `saveInsight` explicit call | `checkpoint.ts`, `insight.ts` |
| `context entries` (file-based) | `storeContext` / `preserve-context` explicit call | `preserve-context.ts` |
| `crisisEvents` | `sendMessage` — when `crisis_level >= 7` | `sendMessage` |
| `governanceEvaluations` | After every `sendMessage` (async, non-blocking) | `runAsyncGovernanceEvaluation` |
| `governanceAuditLog` | `saveCheckpoint` when `governance_check=true` and issues found | `checkpoint.ts` |

**Not written automatically (common misunderstanding):**
- `checkpoints` are NOT written by `sendMessage` even when `save_checkpoint=true` is passed. That flag is a hint to shrink-chat only. The MCP server writes checkpoints only via explicit `saveCheckpoint()` through the `remember` tool.
- `sessions.status='abandoned'` is never written by any current handler. Session TTL cleanup is not implemented.

### 8.2 In-memory state

| State | Scope | Invalidation |
|---|---|---|
| `activeSessionCache` (Map) | Per-process | Cache miss → DB lookup; `endSession` removes entry. Stale entries (session externally closed without `endSession`) persist until process restart. |
| `governanceEngine` singleton | Per-process | Never invalidated (stateless evaluator) |
| `fileGuardian.operationLog` (array) | Per-process | Lost on restart — not durable |
| `fileGuardian.codeFreezeMode` (boolean) | Per-process | Set by `enableCodeFreezeMode()` / `disableCodeFreezeMode()`, or by `CODE_FREEZE_MODE` env var at construction only |
| Tool registry (Map in intent-router) | Per-process | `registerTools()` re-call clears and repopulates |

---

## 9. Success, Partial Success, and Rollback

### 9.1 Response shapes

**Success**
```json
{
  "success": true,
  // ...tool-specific fields
}
```

**Partial success** (composite tools, e.g., `code_review`)
```json
{
  "success": true,
  "partial": true,
  "issues_found": 3,
  "checks_run": ["security", "quality"],
  "checks_failed": ["ai-errors"],
  "all_issues": [...],
  "summary": "..."
}
```
Composite tools use `Promise.allSettled` — a sub-check failure is recorded but does not fail the parent. The parent `success` flag reflects whether the overall operation completed, not whether sub-checks found issues.

**Failure**
```json
{
  "success": false,
  "error": "human-readable message",
  "details": { ... }  // only in development mode
}
```

**Blocked operation** (protect tool)
```json
{
  "success": false,
  "allowed": false,
  "violations": [...],
  "action_required": "Human approval needed"
}
```

**Approval required** (protect tool — non-critical violations)
```json
{
  "success": false,
  "requires_approval": true,
  "violations": [...],
  "severity": "medium"
}
```

### 9.2 Rollback conditions

| Condition | Behavior |
|---|---|
| shrink-chat timeout / network failure | `handleLocalFallback()` returns graceful degraded response. No DB write to `sessions.threadId`. |
| Zod validation failure | Immediate return of `ValidationError` — no side effects, no DB writes |
| Session not found (explicit ID provided) | New session created implicitly, original ID discarded with warning log |
| Governance check fails (enforce mode) | Response blocked; `interventionApplied` recorded in `governanceEvaluations` |
| Destructive file op denied | `operation.status = 'denied'` logged; original file untouched |
| Journey completion during checkpoint | `session.status = 'completed'`; client informed via `journey_complete: true` |
| Crisis self-correction fails | Original response returned with `selfCorrected: false`; crisis fields still included for client handling |

---

## 10. Failure Handling and Error Classes

| Error class | HTTP equiv | When thrown |
|---|---|---|
| `ValidationError` | 400 | Zod parse failure, missing required fields |
| `AuthenticationError` | 401 | Token missing or invalid |
| `AuthorizationError` | 403 | Operation on protected resource without permission |
| `NotFoundError` | 404 | Session, journey, or backup ID not found |
| `ConflictError` | 409 | Duplicate resource creation |
| `DatabaseError` | 500 | DB query failure |
| `CouchLoopError` (base) | 500 | Any other internal failure |
| Raw `Error` | 500 | Unexpected / uncaught — logged, sanitized before client |

All tool handlers wrap execution in `try/catch` and return `{ error: string }` rather than throwing to the MCP transport layer. The transport layer never sees raw exceptions.

---

## 11. Logging Schema

Every significant event is logged via `logger` (structured JSON). Required fields:

```typescript
{
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  // context fields (always include when available):
  sessionId?: string,
  userId?: string,
  toolName?: string,
  durationMs?: number,
  // error fields:
  error?: string,
  stack?: string,   // development only
}
```

### 11.1 Mandatory log points

| Event | Level |
|---|---|
| Tool invocation start (`Running verification check`, `Sending message for session X`) | `info` |
| Session created (new vs. existing) | `info` |
| File operation allowed / denied | `info` / `warn` |
| Crisis detected / self-correction applied | `info` |
| Governance issues detected | `warn` |
| Governance evaluation exceeded 1000ms | `warn` |
| shrink-chat timeout or connection failure | `error` |
| Unexpected error in tool handler | `error` |
| Backup created | `info` |

### 11.2 What must NOT be logged

- Raw user message content at `info` or above (debug only)
- Authentication tokens or credentials
- Full stack traces in production (development only via `NODE_ENV=development` guard)
- Sensitive metadata stripped by `sanitizeResponse()`

---

## 12. Domain Detection and Priority

The `guard` tool (and `sendMessage` self-correction path) classify inputs into domains. **Clinical always takes priority over dev:**

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

## 13. Open Questions and Known Gaps

Gaps marked ✅ are addressed in `RUNTIME_UPGRADE_PLAN.md`. Items without ✅ require a policy decision.

1. ✅ **`guard` tool registration is broken**: `guardTool = registerGuardTool` is a `(server: McpServer) => void` function, not a `{ definition, handler }` object. `setupTools()` returns it in a flat array, which cannot register it correctly. Tracked as P1-A in upgrade plan.

2. ✅ **`MCP Usage Takeaways.guard.ts` filename**: Contains spaces, suggests a draft. Tracked as P1-B.

3. ✅ **Two governance systems with conflicting defaults**: `governance/middleware.ts` (dead code, shadow mode) vs `guard`+`GovernancePipeline` (active, enforce mode). The middleware is never called. Tracked as P1-D.

4. ✅ **`verify` description falsely implies automatic invocation**: Description says "CRITICAL: Call BEFORE presenting code" but nothing enforces this. Tracked as P2-A.

5. ✅ **Session TTL not implemented**: `status='abandoned'` never written. No background expiry job. Tracked as P3-A.

6. ✅ **`sanitizeResponse()` only called by `sendMessage`**: All other tools expose raw internal data to MCP clients. Tracked as P6-A.

7. ✅ **`remember`/`handleSmartContext` claims parallel writes but runs sequentially**: Tracked as P2-C.

8. ✅ **`save_checkpoint=true` in `sendMessage` does not trigger MCP-side checkpoint write**: The flag is a hint to shrink-chat only. Tracked as P1-C.

9. **`protect` does not intercept native file ops** (policy decision required): The `protect` tool only applies when the MCP client explicitly calls it. AI-generated file edits via `create_file` / `replace_string_in_file` bypass the guardian entirely. Decision required: narrow scope (document as opt-in only) or expand (add terminal command interception middleware).

10. **`guard` output format inconsistency**: `guard` returns `{ content: [{ type: 'text', text: '<JSON>' }] }` (MCP-native) while all other tools return plain objects. Callers must handle two different response shapes.

11. **`protect` tool missing required-field validation**: `path` is not validated as required when `action=check` or `action=backup`. Handler silently passes `undefined` to file system operations.
