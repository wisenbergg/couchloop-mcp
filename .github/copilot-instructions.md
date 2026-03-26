# CouchLoop EQ MCP Server — Copilot Instructions

## What this repo is

CouchLoop EQ is an MCP (Model Context Protocol) server deployed on Railway at `mcp.couchloop.com`. It gives AI assistants (Claude, Copilot, ChatGPT) a set of tools for context persistence, code review, package auditing, and wellness journeys. Published to npm as `couchloop-eq-mcp`.

## Stack

- **Runtime:** Node.js 20, TypeScript (ESM, `.js` extensions required on all imports)
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Database:** Supabase (project `tvqjkrghxnxmgaatlnfn`) via Supabase JS client (`getSupabase()` from `src/db/client.ts`)
- **ORM:** Drizzle (also connected, used for sessions/checkpoints/insights — existing tables only)
- **Deployment:** Railway (auto-deploy on push to `master`)
- **Package registry:** npm (`couchloop-eq-mcp`)

## Architecture

```
src/
  index.ts              — Server entry point, initialises DB + tools + resources (tools/list cached)
  tools/
    primary-tools.ts    — setupTools() — the 4 public MCP tools
    couchloop-v2.ts     — Intent router (internal, used by legacy compatibility)
    intent-router.ts    — Legacy tool registry (intent mappings)
    [tool].ts           — Individual tool handlers
  policy/
    wrapper.ts          — runToolWithPolicy() — mandatory wrapper, auto-invokes guard
    types.ts            — Policy layer types
  core/
    registry/registry.ts  — V2 ToolRegistry singleton (health tracking)
    intent/classifier.ts  — Intent classification
    init.ts               — Orchestration init (tracing + registry)
  db/
    client.ts           — initDatabase(), getDb(), getSupabase()
    schema.ts           — Drizzle schema (users, sessions, checkpoints, insights, context_entries...)
    migrations/         — Plain SQL migration files
  developer/
    managers/
      context-manager.ts — ContextManager class (Supabase-backed, no filesystem)
```

## Public tools (4)

| Tool | Description |
|------|-------------|
| `memory` | **Hero tool** — save/recall context, checkpoints, insights, decisions (Supabase-backed). Actions: save, recall, list |
| `conversation` | AI conversation with crisis detection, journeys, session memory |
| `review` | Unified code review, package audit, and verification. Modes: code, packages, verify, full |
| `status` | Dashboard — session, history, context, protection, preferences |

### Internal tools (not exposed to users)

| Tool | Description |
|------|-------------|
| `guard` | Per-turn governance — auto-invoked by the policy wrapper on every tool call. Threshold-gated at 50KB. |

## Critical rules

### TypeScript / ESM
- All imports must use `.js` extension: `import { foo } from './bar.js'`
- Never use `require()` — ESM only
- `tsconfig.json` targets ES2022, module `NodeNext`

### File creation
- Always use `create_file` tool — never bash heredocs (causes corruption)
- Split files on logical separation, not line count

### Database
- New tables: write plain SQL migration in `src/db/migrations/` then run in Supabase dashboard
- `getSupabase()` returns `null` if env vars are missing — always null-check before use
- `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are only set in Railway env vars, not in local `.env.local`
- Never use filesystem for persistence — Railway containers have a read-only `/app` at runtime

### Tool registration
- Tools are registered in `primary-tools.ts` via `setupTools()`
- All tool handlers must be wrapped with `withPolicy()` before registration
- The policy wrapper (`runToolWithPolicy`) auto-invokes the `guard` tool on every call (threshold-gated at 50KB)
- Every tool definition needs: `description` with trigger phrases, `annotations` (readOnlyHint, destructiveHint, idempotentHint, openWorldHint), full `inputSchema` with parameter descriptions

### Deployment
- Push to `master` → Railway auto-deploys
- Build command: `npm run build` (runs `tsc`)
- Start command: `node dist/index.js`
- Build failures show in Railway dashboard → Deployments

## Environment variables

Set in Railway dashboard. Local `.env.local` has placeholders for Supabase keys — real keys are Railway-only.

Key vars: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `SHRINK_CHAT_API_URL`

## Common tasks

**Add a new tool:**
1. Create `src/tools/my-tool.ts` with handler + definition (include annotations + full descriptions)
2. Import and add to `rawDomainTools` array in `primary-tools.ts`
3. Wrap with `withPolicy()` in `setupTools()`

**Add a new DB table:**
1. Write migration SQL in `src/db/migrations/NNNN_description.sql`
2. Run it in Supabase dashboard (project tvqjkrghxnxmgaatlnfn) SQL editor
3. Add Drizzle schema entry in `src/db/schema.ts` if needed for existing ORM usage

**Deploy:**
```bash
git add .
git commit -m "feat/fix: description"
git push
```
Railway deploys automatically. Monitor at railway.app dashboard.
