# CouchLoop Runtime Upgrade Plan

> **Historical document.** This audit was performed against the v1.4.0 codebase (10-tool architecture with `couchloop` intent router). As of v2.1.0, most gaps identified here have been resolved: guard is now auto-invoked via `withPolicy()`, tools consolidated to 4 public tools, protect/brainstorm/verify removed as standalone tools, and `remember` replaced by `memory`. See [CHANGELOG.md](./CHANGELOG.md).

> Companion to `AGENT_RUNTIME_CONTRACT.md`.
> Status: Working document — track resolved items as PRs close.
> Scope: Gaps between v1 contract claims and actual enforcement as of the March 16, 2026 codebase audit.

---

## Part 1: Contract vs Implementation Gap Matrix

Every row answers the question: "does the code actually do what the contract says?"

Legend: ✅ Enforced in code | ⚠️ Partially enforced | ❌ Policy only / not enforced | 🔥 Actively misleading

### 1.1 Core lifecycle

| Contract claim | Actual code behavior | Gap verdict |
|---|---|---|
| `[1] CLASSIFY intent` | `classifyIntent()` runs regex on `intent` field; first match wins | ✅ Works as described |
| Classification confidence is 0.9 on match, 0.5 on fallback | Hard-coded constants in `classifyIntent()` — not computed from signal quality | ⚠️ Numbers are arbitrary labels, not scores |
| Fallback routes to `conversation/send`, no silent discard | Confirmed in `classifyIntent()` default return | ✅ Correct |
| `[2] VALIDATE inputs` (Zod) | Every public tool handler calls `Schema.parse(args)` | ✅ Enforced |
| `sanitizeText()` called on all user strings | Called in `sendMessage`, `handleSmartContext`. **Not called** in `verify`, `code_review`, `package_audit`, `status` handlers | ⚠️ Partial |
| `sanitizeCode()` called on code inputs | Called in `handleComprehensiveCodeReview`. **Not called** in `verify` handler before passing to sub-checks | ⚠️ Partial |
| `[3] AUTHORIZE session` — implicit session always exists | `getOrCreateSession()` creates one if missing | ✅ Correct |
| Session must be `active` for stateful writes | `saveCheckpoint` checks `session.status !== 'active'`; `sendMessage` does not check before writing | ⚠️ Partial |
| `[4] ROUTE` — only `conversation`/`brainstorm` go to shrink-chat | Confirmed by reading all tool handlers | ✅ Correct |
| shrink-chat fallback on timeout/ECONNREFUSED | `handleLocalFallback()` exists and is called in `sendMessage` catch block | ✅ Correct |
| `[5] EXECUTE` — composite tools use `Promise.allSettled` | `handleComprehensiveCodeReview`, `handleComprehensivePackageAudit` confirmed | ✅ Correct |
| `[6] SELF-CORRECT` — max 1 revision attempt | Single revision branch in `sendMessage`, no retry loop | ✅ Correct |
| `[7] VERIFY` — governance runs async post-delivery | `runAsyncGovernanceEvaluation()` is called fire-and-forget after `sendMessage` return | ✅ Correct |
| `[7] VERIFY` — shadow mode default | `governance/middleware.ts` defaults to `shadow`. `guard` tool defaults to `enforce`. **These are two separate systems with conflicting defaults** | 🔥 Misleading — the contract implies one governance system |
| `[8] PERSIST STATE` — checkpoints written on `save_checkpoint=true` | `sendMessage` sets `save_checkpoint: true` in brainstorm and conversation paths; but does NOT call `saveCheckpoint` — it's passed as metadata to shrink-chat only | 🔥 Claim is false — `save_checkpoint=true` is a flag sent to shrink-chat, not honored by the MCP server |
| `[9] PROTECT` — `fileGuardian.validateOperation()` before destructive write | Only fires when `protect` tool is explicitly called. Not wired to any other tool | ❌ Not automatic |
| `autoBackup.createBackup()` before allowed destructive write | Code confirmed in `protect-files.ts` | ✅ Correct when `protect` is called |
| `[10] RETURN` — `sanitizeResponse()` on every response | Only called in `sendMessage`. Not called in `code_review`, `verify`, `package_audit`, `status`, `protect`, `remember` | ⚠️ Partial |

### 1.2 Tool responsibilities

| Contract claim | Actual code behavior | Gap verdict |
|---|---|---|
| `guard` — "per-turn governance, called automatically by companion skill" | `guard` is registered as an MCP tool. It is **never called automatically**. The "companion skill" is an instruction to external AI clients, not implemented code | 🔥 "Automatically" is false |
| `guard` tool uses standard `{ definition, handler }` shape | `guardTool = registerGuardTool` which is a `(server: McpServer) => void` function. `setupTools()` returns it in the `domainTools` array, which breaks if the MCP server registration code expects `{ definition, handler }` | 🔥 Registration is structurally broken |
| `verify` — called before presenting code to users | Has a trigger phrase in intent router but is **never auto-invoked** by any other tool or lifecycle hook | ❌ Not enforced |
| `remember` → `handleSmartContext` → sub-handlers in parallel | `handleSmartContext` runs sub-handlers sequentially with individual `await`s, not in parallel | ⚠️ Claim of parallel execution is incorrect |
| `status` calls `getProtectionStatus`, `listBackups`, `getInsights`, `getUserContext` | Confirmed in `status.ts` | ✅ Correct |

### 1.3 Session lifecycle

| Contract claim | Actual code behavior | Gap verdict |
|---|---|---|
| Session expiry / TTL | No TTL job. `status='abandoned'` is defined in the schema type but **never written** by any handler | ❌ Non-existent |
| `endSession` clears `activeSessionCache` | Confirmed — `activeSessionCache.delete(externalUserId)` | ✅ Correct |
| Cache invalidated on session end | Only invalidated by `endSession`. Process restart also clears it. No automatic stale-check interval | ⚠️ Cache can serve stale data if session is externally terminated without calling `endSession` |

### 1.4 Governance

| Contract claim | Actual code behavior | Gap verdict |
|---|---|---|
| Single governance system | There are **two separate governance systems**: (A) `governance/middleware.ts` with `governancePreCheck`/`governancePostCheck` — shadow mode default, not wired to any tool execution path; (B) `guard` tool using `GovernancePipeline`/`InterventionEngine` — enforce mode default, manually invoked | 🔥 Contract treats them as one |
| `governance/middleware.ts` — `governancePreCheck` fires before code generation tools | The middleware exports `governancePreCheck` and lists `CODE_GENERATION_TOOLS`, but nothing wraps any tool with `withGovernance()`. The `wrapWithGovernance` helper exists but is **never called** | 🔥 Dead code — not wired |
| Governance evaluation time target `<1000ms` | Logged as warning in `evaluationEngine.ts` | ✅ Monitoring exists |

### 1.5 Protect tool scope

| Contract claim | Actual code behavior | Gap verdict |
|---|---|---|
| "`protect` does NOT intercept file ops outside MCP calls" | Correct — this is accurately stated in v1 contract | ✅ Accurate |
| `CODE_FREEZE_MODE` env var disables all writes | `FileGuardian` reads `process.env.CODE_FREEZE_MODE === 'true'` at construction. **Not dynamically re-read** — restart required | ⚠️ Only effective at startup |
| File operation log persists for rollback | `operationLog` is an in-memory array on `FileGuardian` instance. Lost on process restart | ⚠️ Non-durable |

### 1.6 Sanitize.ts audit

| Contract claim | Actual code behavior | Gap verdict |
|---|---|---|
| `sanitizeResponse()` strips sensitive fields | Uses a denylist of 30 field names. Returns only fields in `SAFE_FIELDS` allowlist | ✅ Works |
| `SAFE_FIELDS` only exposes `success`, `content`, `message`, `timestamp`, `type`, `error`, `crisis_resources` | Every tool that doesn't call `sanitizeResponse()` returns its full internal structure to the MCP client | ⚠️ Most tools bypass this |

---

## Part 2: Prioritized Upgrade Plan

### Priority 1 — Fix the broken wiring (correctness bugs)

These are not policy decisions. The code is wrong or dead.

---

#### P1-A: Wire `guard` tool registration correctly

**Problem**: `guardTool = registerGuardTool` is typed as `(server: McpServer) => void`. `setupTools()` returns it in the `domainTools` array alongside objects with `{ definition, handler }` shape. The MCP server registration loop (`server.tool(...)`) cannot handle both shapes. `guard` either silently fails to register or throws at startup.

**Fix**: `registerGuardTool` already calls `server.tool(...)` internally. Change `setupTools()` to call `registerGuardTool(server)` directly during server init, instead of including it in the flat `domainTools` array.

**Acceptance criteria**:
- [ ] `guard` tool appears in `server/tools/list` MCP response after server start
- [ ] Calling `guard` with a test response returns a valid `GuardResult` JSON
- [ ] No TypeScript errors on `setupTools()` return type

---

#### P1-B: Rename `MCP Usage Takeaways.guard.ts`

**Problem**: The file name contains spaces and suggests it is a draft/notes file. This causes import ambiguity and makes intent unclear.

**Fix**: Rename to `src/tools/guard.ts`. Update the single import in `primary-tools.ts`.

**Acceptance criteria**:
- [ ] No file in `src/` has spaces in the name
- [ ] `import { guardTool } from './guard.js'` resolves without error

---

#### P1-C: `save_checkpoint=true` in `sendMessage` does not trigger `saveCheckpoint`

**Problem**: `sendMessage` passes `save_checkpoint: true` to the shrink-chat client. This is a hint to the external service — the MCP server never calls `saveCheckpoint()`. The contract claims the MCP server persists checkpoints here.

**Fix — Option A (narrow)**: Remove `save_checkpoint` from the `SendMessageSchema` and update the contract to state that checkpoint persistence is explicit-only.

**Fix — Option B (expand)**: After a successful `sendMessage` response, call `saveCheckpoint({ session_id, key: 'message', value: { message, response: responseContent } })` when `input.save_checkpoint === true`.

**Recommendation**: Option A unless explicit checkpoint persistence on every message is actually wanted. Option B adds a DB write to every conversation turn.

**Acceptance criteria (Option A)**:
- [ ] `save_checkpoint` parameter removed from `SendMessageSchema`
- [ ] Contract §8.1 updated to remove the false claim
- [ ] No test references rely on the removed field

---

#### P1-D: `governance/middleware.ts` `wrapWithGovernance()` is dead code

**Problem**: `governancePreCheck`/`governancePostCheck`/`wrapWithGovernance` are exported but never called anywhere in the execution path. The middleware file is effectively unreachable.

**Fix — Option A (remove dead code)**: Delete `src/governance/middleware.ts`. Document that all governance runs through the `guard` tool.

**Fix — Option B (wire it)**: Call `wrapWithGovernance(handler)` when registering tools in `setupTools()` for the tools listed in `CODE_GENERATION_TOOLS`.

**Recommendation**: Option A. The `guard` tool is the established governance path. The middleware is a separate, weaker implementation that duplicates responsibility.

**Acceptance criteria (Option A)**:
- [ ] `src/governance/middleware.ts` deleted
- [ ] No import of `governancePreCheck`/`governancePostCheck`/`wrapWithGovernance` in any active file
- [ ] Contract §13.5 (gap note) resolved and removed

---

### Priority 2 — Make automatic claims true or remove them

These are places where documentation says "automatic" but code does not enforce it.

---

#### P2-A: `verify` — remove "CRITICAL: Call BEFORE presenting code" from tool description

**Problem**: The `verify` tool description says "CRITICAL: Pre-delivery verification... Call BEFORE presenting code, package recommendations, or factual claims to users." Nothing enforces this. It is an instruction to an AI client, not the system itself.

**Two honest paths**:

**Path A (narrow scope)**: Rewrite the description to accurately state what `verify` does: "Manual verification tool. Call when you want to check code, packages, or facts before presenting them. Does not auto-intercept deliveries."

**Path B (add real gate)**: Add a `pre_delivery` hook in `sendMessage` that runs `verifyPackages` (lightweight) on the response content before returning it to the caller. The `verify` tool becomes the explicit API for the full check.

**Recommendation**: Path A now; Path B as a separate P3 improvement. Do not falsely advertise capability that does not exist.

**Acceptance criteria (Path A)**:
- [ ] `verify` tool description rewritten without "CRITICAL" framing
- [ ] No claim of automatic pre-delivery interception in any tool description or docs
- [ ] Contract §6 updated to reflect honest scope

---

#### P2-B: `guard` — remove "called automatically by companion skill" language

**Problem**: `primary-tools.ts` comments say `// Invisible per-turn governance (called automatically by companion skill)`. There is no companion skill in this codebase. The `guard` tool is an MCP tool that must be explicitly called.

**Fix**: Remove the comment. Update `guard` tool description to state: "Per-turn governance tool. Call explicitly with each response draft before delivery. Supports enforce, shadow, and bypass modes."

**Acceptance criteria**:
- [ ] Comment removed from `setupTools()`
- [ ] `guard` description does not use the word "invisible" or "automatic"
- [ ] Contract §4.1 updated

---

#### P2-C: `remember` — fix false parallelism claim

**Problem**: Contract §4.2 states `remember → handleSmartContext → (saveCheckpoint, saveInsight, storeContext) in parallel`. The `handleSmartContext` implementation uses sequential `await` calls, not `Promise.all`.

**Fix**: Either update the contract to say "sequentially", or refactor `handleSmartContext` to run the non-dependent writes in parallel with `Promise.allSettled`.

**Recommendation**: Fix the code for real parallelism since these are independent writes. Adds performance improvement.

**Acceptance criteria (if code fixed)**:
- [ ] `handleSmartContext` uses `Promise.allSettled` for independent writes
- [ ] TypeScript compiles cleanly
- [ ] Existing tests pass

---

### Priority 3 — Complete session lifecycle

---

#### P3-A: Implement session TTL and `abandoned` status

**Problem**: Sessions created implicitly but never terminated accumulate indefinitely. `status='abandoned'` is in the schema but never written.

**Fix**: Add a background cleanup job that runs on server startup and periodically:
```typescript
// Mark sessions inactive for > TTL as abandoned
const TTL_HOURS = parseInt(process.env.SESSION_TTL_HOURS || '48');
await db.update(sessions)
  .set({ status: 'abandoned', updatedAt: new Date() })
  .where(and(
    eq(sessions.status, 'active'),
    lt(sessions.lastActiveAt, new Date(Date.now() - TTL_HOURS * 3600_000))
  ));
// Evict stale cache entries
activeSessionCache.clear(); // simplest safe option
```

**Acceptance criteria**:
- [ ] `SESSION_TTL_HOURS` env var documented in `.env.example`
- [ ] Cleanup job runs at server start and every N hours (configurable)
- [ ] `status='abandoned'` is written to DB for qualifying sessions
- [ ] Test confirms a session accessed more than TTL hours ago is marked abandoned on next cleanup run

---

#### P3-B: `activeSessionCache` stale-entry protection

**Problem**: The in-memory cache can hold a session ID that has been externally marked `abandoned` or `completed` in the DB. The cache is only cleared by `endSession()` and process restart.

**Fix**: In `getOrCreateSession()`, when pulling from cache, the code already re-validates against DB (`eq(sessions.status, 'active')`). If the DB validation fails, it removes from cache and looks for a new active session. This is already partially correct. The gap is that it falls through to create a new implicit session, which may be surprising.

**Fix**: On stale cache entry, log clearly that the cached session was stale, then either resume the most-recent completed session or start fresh with an explicit log entry.

**Acceptance criteria**:
- [ ] Stale cache detection is logged at `warn` level with the stale session ID
- [ ] No silent implicit session creation when a session ID was explicitly provided but is stale

---

### Priority 4 — Honest confidence scoring

---

#### P4-A: Replace arbitrary confidence constants with heuristic labels

**Problem**: The intent router returns `confidence: 0.9` for any pattern match and `confidence: 0.5` for fallback. These numbers carry no meaning — a match on `/\btalk\b/i` has identical confidence to a match on a 5-keyword phrase.

**Two honest approaches**:

**Approach A (label)**: Replace numeric confidence with a categorical enum:
```typescript
confidence: 'PATTERN_MATCH' | 'FALLBACK'
```

**Approach B (score)**: Compute a real score based on: number of keywords matched in the pattern, specificity of the match (full phrase vs. single word), context overlap between matched intent and provided context.

**Recommendation**: Approach A immediately (cheap, honest); Approach B as a future improvement.

**Acceptance criteria (Approach A)**:
- [ ] `ClassificationResult.confidence` changes type to `'PATTERN_MATCH' | 'FALLBACK'`
- [ ] All callers updated
- [ ] Contract §2.2 updated

---

### Priority 5 — Governance rollout and enforce-mode definition

---

#### P5-A: Declare which governance system is authoritative

**Problem**: Two governance systems exist:
- System A: `governance/middleware.ts` — dead code, shadow mode, checking package commands and code quality
- System B: `guard` tool + `GovernancePipeline` — active, enforce mode by default, full detector pipeline

**Fix**: Declare System B as authoritative. Delete System A (covered by P1-D). Add an env var `GOVERNANCE_DEFAULT_MODE` (values: `enforce` | `shadow` | `bypass`, default: `shadow`) that is read by the `guard` tool and used when no `mode` parameter is passed.

**Acceptance criteria**:
- [ ] `GOVERNANCE_DEFAULT_MODE` env var implemented and documented
- [ ] `guard` tool reads default from env when `mode` param is not provided
- [ ] Effect of each mode is documented in `guard` tool description

---

#### P5-B: Define governance escalation thresholds explicitly

**Problem**: `evaluationEngine.ts` uses `this.config.interventionThresholds.block/modify/warn` but these thresholds are loaded from `governance/config.ts` which is not audited. The exact values are opaque to tool consumers.

**Fix**: Document the threshold values in `AGENT_RUNTIME_CONTRACT.md` §7 and in the `guard` tool description. Add them to `.env.example` as configurable values.

**Acceptance criteria**:
- [ ] Block threshold, modify threshold, warn threshold documented with their default values
- [ ] Contract updated to include threshold table

---

### Priority 6 — Sanitize response uniformly

---

#### P6-A: Apply `sanitizeResponse()` to all public tool returns

**Problem**: Only `sendMessage` calls `sanitizeResponse()`. All other tools return raw internal data structures to the MCP client including DB row IDs, internal timestamps, and in some cases error stack details.

**Fix**: Either:
- (A) Wrap each tool's return in `sanitizeResponse()` with appropriate `allowFields` per tool
- (B) Add `sanitizeResponse()` call in the MCP transport layer before any tool result is serialized to the wire

**Recommendation**: Option B (transport-layer) is safer — single enforcement point. Requires modifying `src/index.ts` and `src/server/sse.ts`.

**Acceptance criteria**:
- [ ] All tool responses received by MCP clients are sanitized
- [ ] Each tool's expected safe fields are explicitly declared (not relying on SAFE_FIELDS allowlist which is `conversation`-only)
- [ ] No internal DB IDs, threadIds, or crisis metadata exposed

---

## Part 3: v1.1 Contract Corrections

The following are corrections to `AGENT_RUNTIME_CONTRACT.md`. Apply in the next contract revision.

### §1 Lifecycle — correct steps 7, 8, 9

**Current text (step 7)**:
> `Governance runs async post-delivery (shadow mode default — logs, never blocks)`

**Correction**: This applies only to `runAsyncGovernanceEvaluation` after `sendMessage`. The `guard` tool defaults to `enforce` mode when called explicitly. The two systems are independent. Rewrite as:
> Async governance evaluation (`runAsyncGovernanceEvaluation`) runs post-delivery for conversation turns only, in shadow mode (log-only). The `guard` tool, when called explicitly, runs in enforce mode by default and CAN block delivery.

**Current text (step 8)**:
> `Checkpoints: stateful journey progress` (implied: written automatically when `save_checkpoint=true` in `sendMessage`)

**Correction**: `save_checkpoint=true` is a hint passed to shrink-chat. The MCP server does not write checkpoints from `sendMessage`. Checkpoints are written only by explicit `saveCheckpoint()` calls via the `remember` tool.

**Current text (step 9)**:
> `PROTECT (destructive ops only)` — positioned as a lifecycle step that runs automatically

**Correction**: `protect` is not a lifecycle step. It is a separate, explicitly-invoked tool. Remove it from the lifecycle diagram. Add: "File protection must be explicitly requested. It is not part of the default request lifecycle."

### §4.1 — `guard` tool responsibility

**Current**: "Per-turn governance (hallucination, package safety, clinical detection) — called automatically by companion skill"

**Correction**: "Per-turn governance (hallucination, package safety, clinical detection). Must be called explicitly per response. Has no automatic invocation path in this codebase."

### §4.2 — `remember` parallelism

**Current**: "`remember` → `handleSmartContext` → (`saveCheckpoint`, `saveInsight`, `storeContext`) in parallel"

**Correction**: "sequential — uses individual `await` calls"

### §6 — `verify` mandatory scenarios

**Current**: "AI is about to present package recommendations — Strongly recommended"

**Correction**: No tool enforces this. Change all "Strongly recommended" and "Recommended" entries to: "Caller-opt-in only. No automatic enforcement."

### §7 — `protect` auto-invocation

**Current**: "Auto-backup on allowed destructive ops — `autoBackup.createBackup()` fires automatically as a postcondition"

**Addition required**: "The in-memory `operationLog` in `FileGuardian` is lost on process restart. It does not persist to DB. Rollback from log is only available within the current process lifetime."

### §8.2 — In-memory state

**Addition**:
> `fileGuardian.operationLog` — process-scoped — lost on restart. Not durable.

### §13 Open questions — remove resolved gaps and add new

Remove resolved items that are addressed by this upgrade plan. Add:
- Gap 6: `sanitizeResponse()` is not applied uniformly — only `sendMessage` calls it.
- Gap 7: `remember` / `handleSmartContext` claims parallel execution but runs sequentially.
- Gap 8: `CODE_FREEZE_MODE` env var is only read at `FileGuardian` construction, not dynamically.

---

## Part 4: Schema Pack — All Public Tools

These are the canonical input and output types for every public tool. They are derived from the existing Zod schemas. Deviations between what's documented here and what the code implements are noted as bugs.

---

### 4.1 `couchloop`

**Input**
```typescript
{
  intent: string;           // required — loose natural language command
  context?: string;         // optional — code, message content, etc.
  session_id?: string;      // optional — UUID
}
```

**Output** — pass-through to routed tool output. No canonical shape guaranteed.
**Gap**: No typed output schema. The caller cannot statically type the response.

---

### 4.2 `guard`

**Input** (Zod-validated via `server.tool()` in `registerGuardTool`)
```typescript
{
  response: string;         // required — draft response to evaluate
  conversation?: Array<{    // optional — last 5–10 turns
    role: 'user' | 'assistant';
    content: string;
  }>;
  domain?: 'dev' | 'clinical' | 'auto';  // default: 'auto'
  session_id?: string;
  mode?: 'enforce' | 'shadow' | 'bypass'; // default: 'enforce'
}
```

**Output** (wrapped in MCP `content[0].text` as JSON string)
```typescript
{
  action: 'pass' | 'modified' | 'blocked';
  response: string;         // original or corrected response
  intervention?: {
    type: string;
    reason: string;
    confidence: number;     // 0–1
    original_response?: string;
  };
  domain_detected: 'dev' | 'clinical' | 'unknown';
  evaluation_id: string;
  elapsed_ms: number;
  mode: 'enforce' | 'shadow' | 'bypass';
  corpus_version: string;
  detector_results?: Record<string, unknown>;
}
```

**Gap**: Output is returned as `{ content: [{ type: 'text', text: '<JSON>' }] }`. This is MCP-native but requires callers to `JSON.parse(result.content[0].text)`. All other tools return plain objects. This shape is inconsistent.

---

### 4.3 `verify`

**Input**
```typescript
{
  type: 'code' | 'packages' | 'facts' | 'response' | 'all'; // required
  content: string;          // required — content to verify
  language?: string;        // optional — default 'typescript'
  registry?: 'npm' | 'pypi' | 'maven' | 'cargo' | 'go' | 'nuget' | 'gem'; // default 'npm'
  context?: string;
  session_id?: string;      // UUID
}
```

**Output**
```typescript
{
  success: boolean;
  verified: boolean;
  type: string;
  checks_run: string[];
  issues: string[];
  fixes: string[];
  warnings: string[];
  confidence: number;       // 0–1; computed as 1 - (issues.length * 0.15), min 0.1
  code_verification?: CodeVerificationResult;
  package_verification?: PackageVerificationResult;
  governance_verification?: GovernanceVerificationResult;
  summary: string;
  recommendation: string;
  error?: string;           // only on failure
}
```

**Gap**: `sanitizeText()` / `sanitizeCode()` not called on `content` before sub-checks.

---

### 4.4 `status`

**Input**
```typescript
{
  check: 'session' | 'history' | 'context' | 'protection' | 'preferences' | 'all'; // required
  session_id?: string;
}
```

**Output**
```typescript
{
  success: boolean;
  check: string;
  timestamp: string;        // ISO 8601
  session?: SessionStatus;
  history?: HistoryStatus;
  context?: ContextStatus;
  protection?: ProtectionStatus;
  preferences?: PreferencesStatus;
  summary?: string;
  next_steps?: string[];
  error?: string;
}
```

---

### 4.5 `conversation`

**Input**
```typescript
{
  message: string;          // required
  action?: 'send' | 'start' | 'end' | 'resume' | 'status'; // default: 'send'
  journey?: string;         // journey slug
  session_id?: string;      // UUID
}
```

**Output — action=send** (from `sendMessage`, after `sanitizeResponse()`)
```typescript
{
  success: boolean;
  content: string;          // AI response text
  message?: string;
  timestamp: string;
  // internal fields stripped by sanitizeResponse()
}
```

**Output — action=start** (from `createSession`)
```typescript
{
  session_id: string;
  journey: object | null;
  current_step: object | null;
  message: string;
}
```

**Gap**: `action=end`, `action=resume`, `action=status` outputs are not typed in the same interface. Each sub-handler returns a different shape.

---

### 4.6 `brainstorm`

**Input**
```typescript
{
  message: string;          // required
  session_id?: string;
}
```

**Output**: Same as `conversation action=send` (routes to `sendMessage`).

---

### 4.7 `code_review`

**Input**
```typescript
{
  code: string;             // required
  language?: string;        // default: 'typescript'
  auto_fix?: boolean;       // default: false
  // Note: 'context' and 'focus' fields exist in internal handler but not in public tool schema
}
```

**Output**
```typescript
{
  success: boolean;
  all_issues: Array<{
    category: 'security' | 'quality' | 'smell' | 'ai-error';
    severity: string;
    message: string;
    location?: string;
  }>;
  security?: object;
  quality?: object;
  smell?: object;
  ai_errors?: object;
  total_issues: number;
  critical_issues: number;
  high_issues: number;
  summary: string;
  recommendation: string;
  partial?: boolean;        // if any sub-check failed
  checks_run?: string[];
  checks_failed?: string[];
}
```

**Gap**: The public tool's `inputSchema` omits `context` and `focus` fields that the internal handler accepts. Callers cannot pass these. Either remove from internal handler or expose in schema.

---

### 4.8 `package_audit`

**Input**
```typescript
{
  packages: string[];       // required
  registry?: 'npm' | 'pypi' | 'maven' | 'cargo' | 'go' | 'nuget' | 'gem'; // default: 'npm'
}
```

**Output**
```typescript
{
  success: boolean;
  packages_checked: number;
  results: {
    validation?: object;
    versions?: object;
    upgrades?: object;
  };
  summary: string;
  all_issues: Array<{ severity: string; message: string }>;
  critical_issues: number;
  partial?: boolean;
}
```

---

### 4.9 `remember`

**Input**
```typescript
{
  content: string;          // required (even for recall/list — misleading)
  type?: 'checkpoint' | 'insight' | 'decision' | 'requirement' | 'constraint' | 'pattern';
  tags?: string[];
  action?: 'save' | 'recall' | 'list'; // default: 'save'
  session_id?: string;
}
```

**Gap**: `content` is marked required but is ignored for `action=recall` and `action=list`. Schema should make `content` optional when `action != 'save'`.

**Output — action=save**: Same as `handleSmartContext` output.
**Output — action=recall**:
```typescript
{
  checkpoints: object;
  insights: object;
  user_context: object;
}
```
**Output — action=list**: Array of insights.

---

### 4.10 `protect`

**Input**
```typescript
{
  action: 'check' | 'backup' | 'rollback' | 'freeze' | 'unfreeze' | 'status' | 'history'; // required
  path?: string;            // required for: check, backup, rollback
  operation?: 'delete' | 'overwrite' | 'move'; // required for: check
  backup_id?: string;       // required for: rollback
}
```

**Gap**: No validation that `path` is provided when `action=check` or `action=backup`. The handler silently passes `undefined` to `protectFiles()` which will fail at file system access.

**Output — action=check**:
```typescript
{
  success: boolean;
  operation_id: string;
  allowed: boolean;
  requires_approval?: boolean;
  violations?: ProtectionViolation[];
  message: string;
  backup_path?: string;     // if backup was created
}
```

---

## Part 5: Policy Layer Specification

This section defines what must be true at the policy level and what mechanism enforces it.

### 5.1 Policy: Governance

| Rule | Mode | Enforcement mechanism | Current state |
|---|---|---|---|
| All conversation responses are evaluated for hallucination, inconsistency, tone drift, unsafe reasoning | REQUIRED | `runAsyncGovernanceEvaluation()` post-delivery | Implemented (async, non-blocking) |
| Package names in any response are checked against hallucination corpus before delivery | REQUIRED | `guard` tool with domain='dev' | Manual only — not auto-invoked |
| Clinical content triggers full 4-detector evaluation | REQUIRED | `guard` tool with domain='clinical' | Manual only |
| Governance issues are logged to `governanceEvaluations` DB table | REQUIRED | `runAsyncGovernanceEvaluation()` | Implemented |
| Governance blocking threshold is explicit and documented | REQUIRED | `INTERVENTION_THRESHOLD_BLOCK` env var | Not implemented (config file only) |

**Required**: `INTERVENTION_THRESHOLD_BLOCK`, `INTERVENTION_THRESHOLD_MODIFY`, `INTERVENTION_THRESHOLD_WARN` must be environment-variable configurable with documented defaults.

### 5.2 Policy: Input validation

| Rule | Enforcement mechanism | Current state |
|---|---|---|
| All string inputs validated with Zod before handler runs | Zod `.parse()` in every handler | ✅ Done |
| All user-supplied free text stripped of null bytes and HTML | `sanitizeText()` | ⚠️ Missing in `verify`, `code_review`, `status` |
| Code inputs stripped of null bytes | `sanitizeCode()` | ⚠️ Missing in `verify` |
| Max string lengths enforced | Zod `.max()` or `sanitizeText()` truncation | ⚠️ Zod max on `message` in `sendMessage`; not enforced uniformly |

### 5.3 Policy: Response sanitization

| Rule | Enforcement mechanism | Current state |
|---|---|---|
| No internal DB IDs (session_id, user_id, thread_id) exposed to MCP client | `sanitizeResponse()` | ⚠️ Only `sendMessage` calls it |
| No crisis metadata (crisis_level, crisis_confidence) exposed | `sanitizeResponse()` | ⚠️ Only `sendMessage` |
| Error details only available in `NODE_ENV=development` | `handleError()` checks `NODE_ENV` | ✅ Done |

### 5.4 Policy: File protection

| Rule | Enforcement mechanism | Current state |
|---|---|---|
| `.env*`, `*.key`, `*.pem` files require approval before overwrite | `FileGuardian.validateOperation()` | ✅ Works when protect is called |
| `.git`, `node_modules`, `dist` are forbidden delete targets | `FileGuardian.isForbiddenPath()` | ✅ Works when protect is called |
| Backup created before every allowed destructive op | `autoBackup.createBackup()` | ✅ Works when protect is called |
| All of the above apply when the protect tool is NOT called | ❌ Not applicable | ❌ Protection is opt-in |

**Required policy decision**: Either (a) narrow the protection scope to only when `protect` is called explicitly (update all docs to say "opt-in protection"), or (b) add an MCP server middleware that intercepts `run_in_terminal` commands containing `rm`, `mv`, or `>` and routes through protect before allowing.

### 5.5 Policy: Session lifecycle

| Rule | Enforcement mechanism | Current state |
|---|---|---|
| Sessions expire after configurable TTL | Background TTL job | ❌ Not implemented |
| Expired sessions are marked `abandoned` | TTL job | ❌ Not implemented |
| Users cannot write to a non-active session | `session.status !== 'active'` check | ⚠️ Only in `saveCheckpoint`, not `sendMessage` |
| `endSession` invalidates the in-memory cache | `activeSessionCache.delete()` | ✅ Done |

---

## Part 6: Validation Test Plan

These tests must pass before each item in the upgrade plan is considered complete.

### 6.1 `guard` tool registration (covers P1-A, P1-B)

```
TEST guard-reg-01: After server.init(), tools/list response includes "guard"
TEST guard-reg-02: guard({ response: "Use left-pad" }) returns GuardResult JSON
TEST guard-reg-03: guard result.action is one of ['pass', 'modified', 'blocked']
TEST guard-reg-04: guard with known malicious package → action = 'blocked'
TEST guard-reg-05: guard with mode='bypass' → action always = 'pass'
TEST guard-reg-06: guard with mode='shadow' → action always = 'pass' even with malicious package
```

### 6.2 Checkpoint persistence (covers P1-C)

```
TEST chk-01: sendMessage({ message: 'hello', save_checkpoint: true }) does NOT create a record in checkpoints table
TEST chk-02: remember({ content: 'foo', type: 'checkpoint' }) DOES create a record in checkpoints table
TEST chk-03: After removing save_checkpoint from SendMessageSchema, passing it returns ValidationError
```

### 6.3 Governance middleware dead code (covers P1-D)

```
TEST gov-mid-01: No import of governance/middleware.ts exists in any active handler
TEST gov-mid-02: TypeScript compiles cleanly after middleware removal
```

### 6.4 `verify` description accuracy (covers P2-A)

```
TEST ver-desc-01: verify tool description does not contain "CRITICAL" or "automatically"
TEST ver-desc-02: verify({ type: 'packages', content: 'npm install left-pad' }) returns verified=true
TEST ver-desc-03: verify({ type: 'packages', content: 'npm install confirmshaming' }) returns verified=false (hallucinated pkg)
TEST ver-desc-04: verify({ type: 'code', content: 'eval(userInput)' }) returns issues including eval warning
```

### 6.5 `sanitizeText` coverage (covers P6-A)

```
TEST san-01: verify({ type: 'code', content: '<script>alert(1)</script>' + validCode }) — HTML stripped before analysis
TEST san-02: code_review({ code: '\0malicious\0' }) — null bytes stripped
TEST san-03: All public tool calls with null-byte inputs do not throw uncaught errors
```

### 6.6 Session TTL (covers P3-A)

```
TEST ttl-01: Session with lastActiveAt > SESSION_TTL_HOURS is marked abandoned after cleanup job runs
TEST ttl-02: Attempting sendMessage with an abandoned session_id creates a new session, logs warning
TEST ttl-03: activeSessionCache does not serve an abandoned session ID
```

### 6.7 `protect` tool input validation (covers schema gap)

```
TEST prot-01: protect({ action: 'check' }) (no path) returns { success: false, error: 'path required for check' }
TEST prot-02: protect({ action: 'backup' }) (no path) returns { success: false, error: 'path required for backup' }
TEST prot-03: protect({ action: 'rollback' }) (no backup_id) returns { success: false, error: 'backup_id required' }
```

### 6.8 `remember` schema (covers schema gap)

```
TEST rem-01: remember({ action: 'recall' }) — no content required — returns checkpoints + insights
TEST rem-02: remember({ action: 'list' }) — no content required — returns insights list
TEST rem-03: remember({ content: 'x', action: 'save', type: 'insight' }) creates insight record
```

### 6.9 `guard` output format consistency (covers §4.2 gap)

```
TEST guard-out-01: guard result is plain JSON object (not wrapped in {content: [{type:'text',text:...}]})
  OR
TEST guard-out-02: Contract documents that guard returns MCP-native format and callers must unwrap
```

### 6.10 Confidence scoring (covers P4-A)

```
TEST conf-01: classifyIntent("end session") returns { confidence: 'PATTERN_MATCH' } (or numeric ≥ 0.8)
TEST conf-02: classifyIntent("blergh xyzzy") returns { confidence: 'FALLBACK' } (or numeric ≤ 0.5)
TEST conf-03: classifyIntent("talk") vs classifyIntent("I need help, I'm feeling overwhelmed and anxious")
             — if numeric, longer phrase scores higher than single word
```

---

## Appendix: Bypass Paths (explicit)

These are paths through the system that bypass a stated protection. Each must be explicitly acknowledged.

| Protection | Bypass path |
|---|---|
| `guard` governance evaluation | Calling any tool other than `guard` — no other tool auto-invokes it |
| `verify` pre-delivery check | Any tool call that doesn't explicitly call `verify` |
| File protection (guardian + backup) | Any file write that doesn't go through the `protect` tool |
| `sanitizeResponse()` | Any tool other than `sendMessage` — they return raw objects |
| `sanitizeText()` / `sanitizeCode()` | `verify`, `code_review`, `package_audit`, `status` handlers |
| Session `active` status check | `sendMessage` — does not check session status before writing |
| Stale session detection | `endSession` never called — cache serves stale data until process restart |
| Governance `enforce` mode | `guard` called with `mode='shadow'` or `mode='bypass'` |
| Governance `enforce` mode | shrink-chat response self-correction uses its own crisis detection, not `guard` |
