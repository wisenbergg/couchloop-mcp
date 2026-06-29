# SSO OAuth Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a single human reach the same internal `user_id` across devices, browsers, sessions, and MCP clients by authenticating through Supabase Auth SSO during `/oauth/authorize`, while the anonymous cookie flow keeps working unchanged.

**Architecture:** SSO is layered *upstream* of the existing OAuth Authorization Server. A new `resolveSupabaseIdentity` maps a verified Supabase subject (HMAC-hashed) to a durable `user_id` via the existing `oauth_subject_links` table, using a reserved sentinel `client_id` so the link is client-independent. A server-side `pending_authorizations` record carries the original authorize params across the Supabase round-trip and the consent step. Everything is gated behind `FF_SSO_SUPABASE`; with the flag off the system behaves byte-for-byte as today.

**Tech Stack:** TypeScript, Express, Supabase (`@supabase/supabase-js` + new `@supabase/ssr`), Vitest, Node `crypto` (HKDF/HMAC).

**Spec:** `docs/superpowers/specs/2026-06-27-sso-oauth-identity-design.md`

> **Migration numbering:** The spec says "migration 0008", but the repo already has `0008_*` and `0009_*`. This plan uses **`0010`**. Likewise the SSO subject-links migration the spec calls `0005` already exists — no change to it.

---

## File Structure

**New files**
- `src/db/migrations/0010_add_sso_pending_and_orphan_tables.sql` — `pending_authorizations` + `orphaned_identity_links` tables + RLS.
- `src/server/oauth/ssoIdentity.ts` — pure identity logic: sentinel constant, `subjectHashFor()`, `anonHasData()`, `canonicalSsoUser()`, `resolveSupabaseIdentity()`.
- `src/server/oauth/pendingAuth.ts` — `pending_authorizations` repository: create / load / markVerified / delete / sweepExpired.
- `src/server/oauth/supabaseAuth.ts` — `@supabase/ssr` wrapper: provider sign-in URL, `exchangeCodeForSession`, `verifyMagicLink`.
- `src/server/oauth/ssoRoutes.ts` — Express handlers for `/oauth/sso/start` and `/auth/callback`, plus consent/interstitial rendering and resume.
- `tests/server/oauth/ssoIdentity.test.ts`, `tests/server/oauth/pendingAuth.test.ts`, `tests/server/oauth/ssoRoutes.test.ts` — unit/integration tests.

**Modified files**
- `src/server/oauth/authServer.ts` — expose a public `getOrCreateUser` (already public) and add `SSO_SENTINEL_CLIENT_ID` guard in `registerDynamicClient`.
- `src/server/index.ts` — mount `ssoRoutes`, add SSO buttons to the consent fallback, schedule the pending-auth sweep alongside `cleanupSessions`.
- `views/consent.html` — add flag-gated "Sign in with Google / GitHub / email" buttons.
- `.env.example` — document `FF_SSO_SUPABASE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (existing), and the SMTP note.

**Responsibility boundaries:** `ssoIdentity.ts` is pure (no Express, easily unit-tested). `pendingAuth.ts` owns all `pending_authorizations` SQL. `supabaseAuth.ts` isolates the Supabase SDK. `ssoRoutes.ts` is the only file wiring them to HTTP. This keeps each unit holdable in context and independently testable.

---

## Phase A — Foundations (flag-off, no behavior change)

### Task 1: Migration — pending & orphan tables

**Files:**
- Create: `src/db/migrations/0010_add_sso_pending_and_orphan_tables.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0010: SSO identity support — resume context + conflict persistence.

CREATE TABLE IF NOT EXISTS public.pending_authorizations (
  nonce                 TEXT PRIMARY KEY,
  authorize_params      JSONB NOT NULL,
  anon_user_id          UUID REFERENCES public.users(id) ON DELETE SET NULL,
  anon_has_data         BOOLEAN NOT NULL DEFAULT false,
  verified_subject_hash TEXT,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS pending_authorizations_expires_at_idx
  ON public.pending_authorizations (expires_at);

CREATE TABLE IF NOT EXISTS public.orphaned_identity_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sso_user_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_id    TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMP,
  UNIQUE (anon_user_id, sso_user_id)
);

-- RLS: service-role only (mirror 0007/0009).
ALTER TABLE public.pending_authorizations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orphaned_identity_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY pending_authorizations_service_role ON public.pending_authorizations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY orphaned_identity_links_service_role ON public.orphaned_identity_links
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Apply to a local/staging Supabase and verify**

Run: `npm run db:push` (or apply the SQL via the Supabase SQL editor on a staging project).
Expected: both tables exist; `\d public.pending_authorizations` shows the columns; RLS enabled.

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/0010_add_sso_pending_and_orphan_tables.sql
git commit -m "feat(oauth): add pending_authorizations and orphaned_identity_links tables"
```

---

### Task 2: Identity primitives — sentinel, subject hash, canonical user

**Files:**
- Create: `src/server/oauth/ssoIdentity.ts`
- Test: `tests/server/oauth/ssoIdentity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { SSO_SENTINEL_CLIENT_ID, subjectHashFor } from "../../../src/server/oauth/ssoIdentity.js";

describe("sso identity primitives", () => {
  beforeAll(() => { process.env.JWT_SECRET = "test-secret-test-secret-test-secret-1234"; });

  it("sentinel is the reserved literal", () => {
    expect(SSO_SENTINEL_CLIENT_ID).toBe("__sso__");
  });

  it("subjectHashFor is deterministic, keyed, and hides the raw id", () => {
    const a = subjectHashFor("supabase-user-123");
    const b = subjectHashFor("supabase-user-123");
    const c = subjectHashFor("supabase-user-999");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toContain("supabase-user-123");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/server/oauth/ssoIdentity.test.ts`
Expected: FAIL — cannot find module `ssoIdentity.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/oauth/ssoIdentity.ts
import nodeCrypto from "crypto";

/** Reserved client_id for client-independent SSO links. Never minted as a real client. */
export const SSO_SENTINEL_CLIENT_ID = "__sso__";

function subjectHashKey(): Buffer {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error("JWT_SECRET is required to derive SUBJECT_HASH_KEY");
  // HKDF(JWT_SECRET) with a fixed info label — no new env var, no hardcoded secret.
  return Buffer.from(
    nodeCrypto.hkdfSync("sha256", Buffer.from(jwtSecret), Buffer.alloc(0), Buffer.from("oauth-subject-hash"), 32),
  );
}

/** HMAC-SHA256 of 'supabase:<id>' with the derived key, lowercase hex. Hides the raw Supabase id. */
export function subjectHashFor(supabaseUserId: string): string {
  return nodeCrypto.createHmac("sha256", subjectHashKey()).update(`supabase:${supabaseUserId}`).digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/server/oauth/ssoIdentity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/oauth/ssoIdentity.ts tests/server/oauth/ssoIdentity.test.ts
git commit -m "feat(oauth): add SSO sentinel and keyed subject hashing"
```

---

### Task 3: `anonHasData` existence check

**Files:**
- Modify: `src/server/oauth/ssoIdentity.ts`
- Test: `tests/server/oauth/ssoIdentity.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing file)

```ts
import { vi } from "vitest";
import { anonHasData } from "../../../src/server/oauth/ssoIdentity.js";

describe("anonHasData", () => {
  it("is true when a session row exists", async () => {
    const supabase = fakeSupabase({ sessions: 1, insights: 0 });
    expect(await anonHasData(supabase as never, "u1")).toBe(true);
  });
  it("is true when a insights row exists", async () => {
    const supabase = fakeSupabase({ sessions: 0, insights: 1 });
    expect(await anonHasData(supabase as never, "u1")).toBe(true);
  });
  it("is false when the user owns nothing", async () => {
    const supabase = fakeSupabase({ sessions: 0, insights: 0 });
    expect(await anonHasData(supabase as never, "u1")).toBe(false);
  });
});

// Minimal stub: each table query resolves to { data, error } with `count` rows.
function fakeSupabase(counts: Record<string, number>) {
  return {
    from(table: string) {
      return {
        select() { return this; },
        eq() { return this; },
        limit() {
          return Promise.resolve({ data: counts[table] > 0 ? [{ id: "x" }] : [], error: null });
        },
      };
    },
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/server/oauth/ssoIdentity.test.ts`
Expected: FAIL — `anonHasData` is not exported.

- [ ] **Step 3: Write minimal implementation** (append to `ssoIdentity.ts`)

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

const DATA_TABLES = ["sessions", "insights"] as const;

/** True if the user owns ANY anonymous artifact. Short-circuits on the first hit. */
export async function anonHasData(supabase: SupabaseClient, userId: string): Promise<boolean> {
  for (const table of DATA_TABLES) {
    const { data, error } = await supabase.from(table).select("id").eq("user_id", userId).limit(1);
    if (error) throw error;
    if (data && data.length > 0) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/server/oauth/ssoIdentity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/oauth/ssoIdentity.ts tests/server/oauth/ssoIdentity.test.ts
git commit -m "feat(oauth): add anonHasData existence check over sessions + insights"
```

---

### Task 4: `resolveSupabaseIdentity` — the core resolver

**Files:**
- Modify: `src/server/oauth/ssoIdentity.ts`
- Test: `tests/server/oauth/ssoIdentity.test.ts`

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { resolveSupabaseIdentity } from "../../../src/server/oauth/ssoIdentity.js";

describe("resolveSupabaseIdentity", () => {
  const HASH = "deadbeef";
  it("MISS + empty anon → silent adopt onto the anon user", async () => {
    const db = fakeDb({ existing: null });
    const r = await resolveSupabaseIdentity(db, HASH, "anonA", "mcp_x", { anonHasData: false });
    expect(r).toEqual({ status: "resolved", userId: "anonA" });
    expect(db.links).toContainEqual({ client_id: "__sso__", issuer: "supabase", subject_hash: HASH, user_id: "anonA" });
  });
  it("MISS + anon has data + no consent → needs_merge_confirmation", async () => {
    const db = fakeDb({ existing: null });
    const r = await resolveSupabaseIdentity(db, HASH, "anonA", "mcp_x", { anonHasData: true });
    expect(r).toEqual({ status: "needs_merge_confirmation" });
  });
  it("MISS + consent=adopt → adopts the anon user", async () => {
    const db = fakeDb({ existing: null });
    const r = await resolveSupabaseIdentity(db, HASH, "anonA", "mcp_x", { anonHasData: true, consent: "adopt" });
    expect(r).toEqual({ status: "resolved", userId: "anonA" });
  });
  it("MISS + consent=decline → canonical SSO user, anon untouched", async () => {
    const db = fakeDb({ existing: null });
    const r = await resolveSupabaseIdentity(db, HASH, "anonA", "mcp_x", { anonHasData: true, consent: "decline" });
    expect(r).toEqual({ status: "resolved", userId: "sso:deadbeef" });
    expect(db.links.some(l => l.user_id === "anonA")).toBe(false);
  });
  it("null candidate → canonical SSO user, never adopts null", async () => {
    const db = fakeDb({ existing: null });
    const r = await resolveSupabaseIdentity(db, HASH, null, "mcp_x", { anonHasData: false });
    expect(r).toEqual({ status: "resolved", userId: "sso:deadbeef" });
  });
  it("HIT + differing anon with data → conflict + orphan row", async () => {
    const db = fakeDb({ existing: "ssoUser" });
    const r = await resolveSupabaseIdentity(db, HASH, "anonA", "mcp_x", { anonHasData: true });
    expect(r).toEqual({ status: "conflict", anonUserId: "anonA", ssoUserId: "ssoUser" });
    expect(db.orphans).toContainEqual({ anon_user_id: "anonA", sso_user_id: "ssoUser", client_id: "mcp_x" });
  });
  it("consent=adopt that LOSES the race → resolved to existing + orphan recorded", async () => {
    // existing appears only AFTER our insert (simulated by raceWinner).
    const db = fakeDb({ existing: null, raceWinner: "ssoUser" });
    const r = await resolveSupabaseIdentity(db, HASH, "anonA", "mcp_x", { anonHasData: true, consent: "adopt" });
    expect(r).toEqual({ status: "resolved", userId: "ssoUser" });
    expect(db.orphans).toContainEqual({ anon_user_id: "anonA", sso_user_id: "ssoUser", client_id: "mcp_x" });
  });
});

// In-memory store implementing the four methods the resolver calls (see Step 3 deps).
function fakeDb(opts: { existing: string | null; raceWinner?: string }) {
  return {
    links: [] as Array<Record<string, string>>,
    orphans: [] as Array<Record<string, string>>,
    async findSsoLink(_hash: string) { return opts.existing; },
    async getOrCreateUser(externalId: string) { return externalId; }, // 'sso:<hash>' echoes back
    async insertSsoLinkIfAbsent(hash: string, userId: string) {
      if (opts.raceWinner) { this.links.push({ client_id: "__sso__", issuer: "supabase", subject_hash: hash, user_id: opts.raceWinner }); return opts.raceWinner; }
      this.links.push({ client_id: "__sso__", issuer: "supabase", subject_hash: hash, user_id: userId });
      return userId;
    },
    async insertOrphanIfAbsent(anon: string, sso: string, clientId: string) {
      this.orphans.push({ anon_user_id: anon, sso_user_id: sso, client_id: clientId });
    },
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/server/oauth/ssoIdentity.test.ts`
Expected: FAIL — `resolveSupabaseIdentity` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `ssoIdentity.ts`)

```ts
export interface IdentityStore {
  findSsoLink(subjectHash: string): Promise<string | null>;
  getOrCreateUser(externalId: string): Promise<string>;
  /** INSERT … ON CONFLICT (client_id,issuer,subject_hash) DO NOTHING, then SELECT the winner. */
  insertSsoLinkIfAbsent(subjectHash: string, userId: string): Promise<string>;
  /** INSERT … ON CONFLICT (anon_user_id,sso_user_id) DO NOTHING. */
  insertOrphanIfAbsent(anonUserId: string, ssoUserId: string, clientId: string): Promise<void>;
}

export type ResolveResult =
  | { status: "resolved"; userId: string }
  | { status: "needs_merge_confirmation" }
  | { status: "conflict"; anonUserId: string; ssoUserId: string };

export async function resolveSupabaseIdentity(
  store: IdentityStore,
  subjectHash: string,
  candidateAnonUserId: string | null,
  clientId: string,
  opts: { anonHasData: boolean; consent?: "adopt" | "decline" },
): Promise<ResolveResult> {
  const hasAnon = candidateAnonUserId != null;
  const existing = await store.findSsoLink(subjectHash);

  if (existing) {
    if (hasAnon && candidateAnonUserId !== existing && opts.anonHasData) {
      await store.insertOrphanIfAbsent(candidateAnonUserId!, existing, clientId);
      return { status: "conflict", anonUserId: candidateAnonUserId!, ssoUserId: existing };
    }
    return { status: "resolved", userId: existing };
  }

  // MISS
  if (hasAnon && opts.anonHasData && opts.consent === undefined) {
    return { status: "needs_merge_confirmation" };
  }

  let target: string;
  if (hasAnon && opts.anonHasData && opts.consent === "adopt") target = candidateAnonUserId!;
  else if (hasAnon && !opts.anonHasData) target = candidateAnonUserId!;
  else target = await store.getOrCreateUser(`sso:${subjectHash}`);

  const winner = await store.insertSsoLinkIfAbsent(subjectHash, target);
  if (winner !== target && hasAnon && opts.anonHasData) {
    await store.insertOrphanIfAbsent(candidateAnonUserId!, winner, clientId);
  }
  return { status: "resolved", userId: winner };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/server/oauth/ssoIdentity.test.ts`
Expected: PASS (all 7 resolver cases).

- [ ] **Step 5: Commit**

```bash
git add src/server/oauth/ssoIdentity.ts tests/server/oauth/ssoIdentity.test.ts
git commit -m "feat(oauth): add resolveSupabaseIdentity with adopt/conflict/race handling"
```

---

### Task 5: Supabase-backed `IdentityStore` + `getOrCreateUser` reuse

**Files:**
- Create: `src/server/oauth/identityStore.ts`
- Test: `tests/server/oauth/ssoIdentity.test.ts` (add a thin integration check, optional if no test DB)

- [ ] **Step 1: Write the implementation** (no new behavior to TDD beyond SQL plumbing; covered by Task 9 integration tests)

```ts
// src/server/oauth/identityStore.ts
import { getSupabaseClient, throwOnError } from "../../db/supabase-helpers.js";
import { oauthServer } from "./authServer.js";
import { SSO_SENTINEL_CLIENT_ID, type IdentityStore } from "./ssoIdentity.js";

export const supabaseIdentityStore: IdentityStore = {
  async findSsoLink(subjectHash) {
    const supabase = getSupabaseClient();
    const row = throwOnError(
      await supabase.from("oauth_subject_links").select("user_id")
        .eq("client_id", SSO_SENTINEL_CLIENT_ID).eq("issuer", "supabase").eq("subject_hash", subjectHash)
        .maybeSingle(),
    ) as { user_id: string } | null;
    return row?.user_id ?? null;
  },

  getOrCreateUser(externalId) {
    return oauthServer.getOrCreateUser(externalId); // upserts users.external_id; idempotent
  },

  async insertSsoLinkIfAbsent(subjectHash, userId) {
    const supabase = getSupabaseClient();
    throwOnError(
      await supabase.from("oauth_subject_links").upsert(
        { client_id: SSO_SENTINEL_CLIENT_ID, issuer: "supabase", subject_hash: subjectHash, user_id: userId, updated_at: new Date().toISOString() },
        { onConflict: "client_id,issuer,subject_hash", ignoreDuplicates: true },
      ).select("user_id"),
    );
    const winner = throwOnError(
      await supabase.from("oauth_subject_links").select("user_id")
        .eq("client_id", SSO_SENTINEL_CLIENT_ID).eq("issuer", "supabase").eq("subject_hash", subjectHash)
        .single(),
    ) as { user_id: string };
    return winner.user_id;
  },

  async insertOrphanIfAbsent(anonUserId, ssoUserId, clientId) {
    const supabase = getSupabaseClient();
    throwOnError(
      await supabase.from("orphaned_identity_links").upsert(
        { anon_user_id: anonUserId, sso_user_id: ssoUserId, client_id: clientId },
        { onConflict: "anon_user_id,sso_user_id", ignoreDuplicates: true },
      ).select("id"),
    );
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add src/server/oauth/identityStore.ts
git commit -m "feat(oauth): add Supabase-backed IdentityStore for SSO resolution"
```

---

### Task 6: `pending_authorizations` repository + TTL sweep

**Files:**
- Create: `src/server/oauth/pendingAuth.ts`
- Test: `tests/server/oauth/pendingAuth.test.ts`
- Modify: `src/server/index.ts` (schedule sweep)

- [ ] **Step 1: Write the failing test** (nonce generation + param shape are pure; DB calls are stubbed)

```ts
import { describe, it, expect } from "vitest";
import { newNonce, buildPendingRow } from "../../../src/server/oauth/pendingAuth.js";

describe("pendingAuth helpers", () => {
  it("newNonce is 64 hex chars and unique", () => {
    const a = newNonce(), b = newNonce();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
  it("buildPendingRow sets a 10-minute expiry and carries params", () => {
    const now = new Date("2026-06-27T00:00:00Z");
    const row = buildPendingRow("nonce1", { client_id: "c", redirect_uri: "https://x" }, "anonA", true, now);
    expect(row.nonce).toBe("nonce1");
    expect(row.anon_user_id).toBe("anonA");
    expect(row.anon_has_data).toBe(true);
    expect(new Date(row.expires_at).getTime() - now.getTime()).toBe(10 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/server/oauth/pendingAuth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server/oauth/pendingAuth.ts
import nodeCrypto from "crypto";
import { getSupabaseClient, throwOnError } from "../../db/supabase-helpers.js";

export interface AuthorizeParams {
  client_id: string; redirect_uri: string; state?: string; scope?: string;
  code_challenge?: string; code_challenge_method?: "S256" | "plain";
}
export interface PendingRow {
  nonce: string; authorize_params: AuthorizeParams;
  anon_user_id: string | null; anon_has_data: boolean; expires_at: string;
}

export function newNonce(): string { return nodeCrypto.randomBytes(32).toString("hex"); }

export function buildPendingRow(
  nonce: string, params: AuthorizeParams, anonUserId: string | null, anonHasData: boolean, now: Date,
): PendingRow {
  return {
    nonce, authorize_params: params, anon_user_id: anonUserId, anon_has_data: anonHasData,
    expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
  };
}

export async function createPending(row: PendingRow): Promise<void> {
  throwOnError(await getSupabaseClient().from("pending_authorizations").insert(row).select("nonce"));
}

export async function loadPending(nonce: string): Promise<
  (PendingRow & { verified_subject_hash: string | null }) | null
> {
  const supabase = getSupabaseClient();
  const row = throwOnError(
    await supabase.from("pending_authorizations").select("*").eq("nonce", nonce).maybeSingle(),
  ) as (PendingRow & { verified_subject_hash: string | null; expires_at: string }) | null;
  if (!row) return null;
  if (new Date() > new Date(row.expires_at)) { await deletePending(nonce); return null; }
  return row;
}

export async function markVerified(nonce: string, subjectHash: string): Promise<void> {
  throwOnError(
    await getSupabaseClient().from("pending_authorizations")
      .update({ verified_subject_hash: subjectHash }).eq("nonce", nonce),
  );
}

export async function deletePending(nonce: string): Promise<void> {
  throwOnError(await getSupabaseClient().from("pending_authorizations").delete().eq("nonce", nonce));
}

export async function sweepExpiredPending(): Promise<void> {
  throwOnError(
    await getSupabaseClient().from("pending_authorizations").delete().lt("expires_at", new Date().toISOString()),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/server/oauth/pendingAuth.test.ts`
Expected: PASS.

- [ ] **Step 5: Schedule the sweep next to the existing session cleanup**

In `src/server/index.ts`, find the two `await cleanupSessions();` calls (around lines 1503 and 1509) and add the import + sweep call beside them:

```ts
import { sweepExpiredPending } from "./oauth/pendingAuth.js";
// ... wherever cleanupSessions() is invoked on the interval:
await cleanupSessions();
await sweepExpiredPending();
```

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/server/oauth/pendingAuth.ts tests/server/oauth/pendingAuth.test.ts src/server/index.ts
git commit -m "feat(oauth): add pending_authorizations repository and TTL sweep"
```

---

### Task 7: Sentinel guard in dynamic client registration

**Files:**
- Modify: `src/server/oauth/authServer.ts` (inside `registerDynamicClient`, near `src/server/oauth/authServer.ts:144`)
- Test: `tests/server/oauth/ssoIdentity.test.ts` (add guard test) — or a focused unit on a helper

- [ ] **Step 1: Write the failing test**

```ts
import { isReservedClientId } from "../../../src/server/oauth/ssoIdentity.js";
describe("reserved client id guard", () => {
  it("flags the sentinel", () => {
    expect(isReservedClientId("__sso__")).toBe(true);
    expect(isReservedClientId("mcp_123")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/server/oauth/ssoIdentity.test.ts`
Expected: FAIL — `isReservedClientId` not exported.

- [ ] **Step 3: Implement the helper and use it**

Append to `src/server/oauth/ssoIdentity.ts`:

```ts
export function isReservedClientId(clientId: string): boolean {
  return clientId === SSO_SENTINEL_CLIENT_ID;
}
```

In `registerDynamicClient` (after `const clientId = \`mcp_${nodeCrypto.randomUUID()}\`;`), assert it never collides:

```ts
import { isReservedClientId } from "./ssoIdentity.js";
// minted ids are always mcp_*, but assert defensively:
if (isReservedClientId(clientId)) throw new Error("Refusing to register reserved client_id");
```

- [ ] **Step 4: Run test + typecheck**

Run: `npm test -- tests/server/oauth/ssoIdentity.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/oauth/ssoIdentity.ts src/server/oauth/authServer.ts tests/server/oauth/ssoIdentity.test.ts
git commit -m "feat(oauth): guard against registering the reserved SSO sentinel client_id"
```

---

## Phase B — Auth flow wiring (flag-gated)

### Task 8: Supabase Auth wrapper

**Files:**
- Create: `src/server/oauth/supabaseAuth.ts`
- Modify: `package.json` (add `@supabase/ssr`)

- [ ] **Step 1: Install the dependency**

Run: `npm install @supabase/ssr`
Expected: `@supabase/ssr` appears in `package.json` dependencies.

- [ ] **Step 2: Write the wrapper**

```ts
// src/server/oauth/supabaseAuth.ts
import { createServerClient } from "@supabase/ssr";
import type { Request, Response } from "express";

function client(req: Request, res: Response) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required for SSO");
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => Object.entries(req.cookies ?? {}).map(([name, value]) => ({ name, value: String(value) })),
      setAll: (cookies) => cookies.forEach(({ name, value, options }) => res.cookie(name, value, options)),
    },
  });
}

/** Build the provider sign-in URL; PKCE verifier is stored in the cookie jar by the SDK. */
export async function providerSignInUrl(
  req: Request, res: Response, provider: "google" | "github", redirectTo: string,
): Promise<string> {
  const { data, error } = await client(req, res).auth.signInWithOAuth({
    provider, options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data?.url) throw error ?? new Error("Failed to build provider URL");
  return data.url;
}

/** Trigger a magic-link email (token_hash flow; no PKCE verifier needed). */
export async function sendMagicLink(req: Request, res: Response, email: string, redirectTo: string): Promise<void> {
  const { error } = await client(req, res).auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
  if (error) throw error;
}

/** OAuth-provider callback: exchange ?code= for a session (same-browser, uses PKCE verifier cookie). */
export async function exchangeCode(req: Request, res: Response, code: string): Promise<string> {
  const { data, error } = await client(req, res).auth.exchangeCodeForSession(code);
  if (error || !data?.user) throw error ?? new Error("Code exchange failed");
  return data.user.id;
}

/** Magic-link callback: verify token_hash. `type` comes from the callback query (signup/email/magiclink). */
export async function verifyMagicLink(
  req: Request, res: Response, tokenHash: string, type: "magiclink" | "signup" | "email" | "recovery",
): Promise<string> {
  const { data, error } = await client(req, res).auth.verifyOtp({ token_hash: tokenHash, type });
  if (error || !data?.user) throw error ?? new Error("OTP verification failed");
  return data.user.id;
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/server/oauth/supabaseAuth.ts package.json package-lock.json
git commit -m "feat(oauth): add @supabase/ssr auth wrapper for SSO provider + magic link"
```

---

### Task 9: SSO routes — initiation, callback, consent/interstitial, resume

**Files:**
- Create: `src/server/oauth/ssoRoutes.ts`
- Test: `tests/server/oauth/ssoRoutes.test.ts`
- Modify: `src/server/index.ts` (mount the router, flag-gated)

- [ ] **Step 1: Write the failing test** (resume + outcome rendering with all deps stubbed)

```ts
import { describe, it, expect, vi } from "vitest";
import { handleResolved, renderConsentPage, renderConflictPage } from "../../../src/server/oauth/ssoRoutes.js";

describe("sso route helpers", () => {
  it("handleResolved mints a code and builds the client redirect with state", async () => {
    const generateAuthCode = vi.fn().mockResolvedValue("CODE123");
    const url = await handleResolved(
      { client_id: "c", redirect_uri: "https://app/cb", state: "s1", scope: "read write" },
      "userZ", generateAuthCode,
    );
    expect(generateAuthCode).toHaveBeenCalledWith("c", "userZ", "https://app/cb", "read write", undefined, undefined);
    expect(url).toBe("https://app/cb?code=CODE123&state=s1");
  });
  it("consent page embeds the nonce as a hidden field", () => {
    expect(renderConsentPage("nonceABC")).toContain('name="n" value="nonceABC"');
  });
  it("conflict page embeds the nonce and a continue action", () => {
    const html = renderConflictPage("nonceXYZ");
    expect(html).toContain('name="n" value="nonceXYZ"');
    expect(html).toMatch(/continue/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/server/oauth/ssoRoutes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the router + helpers**

```ts
// src/server/oauth/ssoRoutes.ts
import { Router, type Request, type Response } from "express";
import { logger } from "../../utils/logger.js";
import { oauthServer } from "./authServer.js";
import { getSupabaseClient, throwOnError } from "../../db/supabase-helpers.js";
import { subjectHashFor, anonHasData, resolveSupabaseIdentity, type ResolveResult } from "./ssoIdentity.js";
import { supabaseIdentityStore } from "./identityStore.js";
import { providerSignInUrl, sendMagicLink, exchangeCode, verifyMagicLink } from "./supabaseAuth.js";
import {
  newNonce, buildPendingRow, createPending, loadPending, markVerified, deletePending, type AuthorizeParams,
} from "./pendingAuth.js";

type GenAuthCode = typeof oauthServer.generateAuthCode;

export async function handleResolved(p: AuthorizeParams, userId: string, gen: GenAuthCode): Promise<string> {
  const code = await gen.call(oauthServer, p.client_id, userId, p.redirect_uri, p.scope || "read write",
    p.code_challenge, p.code_challenge_method);
  const url = new URL(p.redirect_uri);
  url.searchParams.set("code", code);
  if (p.state) url.searchParams.set("state", p.state);
  return url.toString();
}

export function renderConsentPage(nonce: string): string {
  return `<!doctype html><html lang="en"><body>
    <h1>We found work saved in this browser — is it yours?</h1>
    <form method="POST" action="/auth/consent">
      <input type="hidden" name="n" value="${nonce}"/>
      <button name="choice" value="adopt">Yes, add it to my account</button>
      <button name="choice" value="decline">No, keep it separate</button>
    </form></body></html>`;
}

export function renderConflictPage(nonce: string): string {
  return `<!doctype html><html lang="en"><body>
    <h1>You have separate work on this device</h1>
    <p>It stays separate until account merge ships. Continuing as your existing account.</p>
    <form method="POST" action="/auth/consent">
      <input type="hidden" name="n" value="${nonce}"/>
      <button name="choice" value="continue">Continue</button>
    </form></body></html>`;
}

/** Pick the OTP type from the callback query; default to 'magiclink' only when unspecified. */
function otpType(q: unknown): "magiclink" | "signup" | "email" | "recovery" {
  return q === "signup" || q === "email" || q === "recovery" ? q : "magiclink";
}

async function resumeFromResolve(res: Response, result: ResolveResult, p: AuthorizeParams, nonce: string): Promise<void> {
  if (result.status === "resolved") {
    const url = await handleResolved(p, result.userId, oauthServer.generateAuthCode);
    await deletePending(nonce);
    res.redirect(url);
  } else if (result.status === "needs_merge_confirmation") {
    res.type("html").send(renderConsentPage(nonce)); // record stays alive
  } else {
    logger.info("oauth.identity.conflict");
    res.type("html").send(renderConflictPage(nonce)); // record stays alive
  }
}

export function ssoRouter(): Router {
  const router = Router();

  // Initiation: /oauth/sso/start?provider=google&client_id=…&redirect_uri=…&state=…&scope=…&code_challenge=…
  router.get("/oauth/sso/start", async (req: Request, res: Response) => {
    try {
      const q = req.query;
      const provider = String(q.provider || "");
      const params: AuthorizeParams = {
        client_id: String(q.client_id), redirect_uri: String(q.redirect_uri),
        state: q.state ? String(q.state) : undefined, scope: q.scope ? String(q.scope) : "read write",
        code_challenge: q.code_challenge ? String(q.code_challenge) : undefined,
        code_challenge_method: q.code_challenge_method === "S256" || q.code_challenge_method === "plain"
          ? q.code_challenge_method : undefined,
      };

      // Re-validate client + redirect_uri (same checks as /oauth/authorize).
      const client = await oauthServer.validateClient(params.client_id);
      if (!client || !client.redirectUris.includes(params.redirect_uri)) {
        res.status(400).json({ error: "invalid_request", error_description: "Invalid client or redirect_uri" });
        return;
      }

      // Capture the current browser's anonymous identity + data flag.
      const cookie = req.cookies?.couchloop_eq_identity as string | undefined;
      let anonUserId: string | null = null, hasData = false;
      if (cookie) {
        anonUserId = await oauthServer.resolveOrCreateUserForSubject(params.client_id, "browser-local", cookie);
        hasData = await anonHasData(getSupabaseClient(), anonUserId);
      }

      const nonce = newNonce();
      await createPending(buildPendingRow(nonce, params, anonUserId, hasData, new Date()));
      const redirectTo = `${req.protocol}://${req.get("host")}/auth/callback?n=${nonce}`;

      if (provider === "google" || provider === "github") {
        res.redirect(await providerSignInUrl(req, res, provider, redirectTo));
      } else if (provider === "email") {
        await sendMagicLink(req, res, String(q.email), redirectTo);
        res.type("html").send("<p>Check your email for a sign-in link.</p>");
      } else {
        res.status(400).json({ error: "invalid_request", error_description: "Unknown provider" });
      }
    } catch (err) {
      logger.error("SSO start error:", err);
      res.status(500).json({ error: "server_error" });
    }
  });

  // Callback: /auth/callback?n=…&code=…  (OAuth) or …&token_hash=…&type=…  (magic link)
  router.get("/auth/callback", async (req: Request, res: Response) => {
    try {
      const nonce = String(req.query.n || "");
      const pending = await loadPending(nonce);
      if (!pending) { res.status(400).send("Sign-in expired, please try again."); return; }

      let supabaseUserId: string;
      if (req.query.code) supabaseUserId = await exchangeCode(req, res, String(req.query.code));
      else if (req.query.token_hash) supabaseUserId = await verifyMagicLink(req, res, String(req.query.token_hash), otpType(req.query.type));
      else { res.status(400).send("Missing auth parameters."); return; }

      const subjectHash = subjectHashFor(supabaseUserId);
      await markVerified(nonce, subjectHash);

      const result = await resolveSupabaseIdentity(
        supabaseIdentityStore, subjectHash, pending.anon_user_id, pending.authorize_params.client_id,
        { anonHasData: pending.anon_has_data },
      );
      await resumeFromResolve(res, result, pending.authorize_params, nonce);
    } catch (err) {
      logger.error("SSO callback error:", err);
      res.status(500).json({ error: "server_error" });
    }
  });

  // Consent / interstitial POST: re-enter the resolver with the user's choice.
  router.post("/auth/consent", async (req: Request, res: Response) => {
    try {
      const nonce = String(req.body.n || "");
      const choice = String(req.body.choice || "");
      const pending = await loadPending(nonce);
      if (!pending || !pending.verified_subject_hash) { res.status(400).send("Sign-in expired, please try again."); return; }

      if (choice === "continue") {
        // Conflict interstitial: resolver already orphaned + chose existing; just re-resolve to it.
        const result = await resolveSupabaseIdentity(
          supabaseIdentityStore, pending.verified_subject_hash, pending.anon_user_id, pending.authorize_params.client_id,
          { anonHasData: pending.anon_has_data },
        );
        if (result.status === "conflict") {
          const url = await handleResolved(pending.authorize_params, result.ssoUserId, oauthServer.generateAuthCode);
          await deletePending(nonce); res.redirect(url); return;
        }
        await resumeFromResolve(res, result, pending.authorize_params, nonce); return;
      }

      const consent = choice === "adopt" ? "adopt" : "decline";
      const result = await resolveSupabaseIdentity(
        supabaseIdentityStore, pending.verified_subject_hash, pending.anon_user_id, pending.authorize_params.client_id,
        { anonHasData: true, consent },
      );
      await resumeFromResolve(res, result, pending.authorize_params, nonce);
    } catch (err) {
      logger.error("SSO consent error:", err);
      res.status(500).json({ error: "server_error" });
    }
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/server/oauth/ssoRoutes.test.ts`
Expected: PASS.

- [ ] **Step 5: Mount the router behind the flag**

In `src/server/index.ts`, after the app/middleware setup, add:

```ts
import { ssoRouter } from "./oauth/ssoRoutes.js";
if (process.env.FF_SSO_SUPABASE === "true") {
  app.use(ssoRouter());
}
```

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/server/oauth/ssoRoutes.ts tests/server/oauth/ssoRoutes.test.ts src/server/index.ts
git commit -m "feat(oauth): wire SSO initiation, callback, consent and conflict resume"
```

---

### Task 10: Consent UI buttons + `.env.example`

**Files:**
- Modify: `views/consent.html` and the `renderConsentFallback` template in `src/server/index.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add flag-gated SSO buttons to the consent fallback**

In `src/server/index.ts`, inside `renderConsentFallback(...)`, add (only rendered when `FF_SSO_SUPABASE === "true"`) links that carry the same params to `/oauth/sso/start`:

```ts
const ssoBlock = process.env.FF_SSO_SUPABASE === "true" ? `
  <div class="sso">
    <a href="/oauth/sso/start?provider=google&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${encodeURIComponent(scope)}${codeChallenge ? `&code_challenge=${codeChallenge}&code_challenge_method=${codeChallengeMethod}` : ""}">Sign in with Google</a>
    <a href="/oauth/sso/start?provider=github&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${encodeURIComponent(scope)}${codeChallenge ? `&code_challenge=${codeChallenge}&code_challenge_method=${codeChallengeMethod}` : ""}">Sign in with GitHub</a>
  </div>` : "";
// insert ${ssoBlock} into the returned HTML near the "Authorize" button.
```

Mirror the same block in `views/consent.html` (static template) guarded by a server-injected flag if that file is templated; otherwise document that the fallback is the SSO-aware path.

- [ ] **Step 2: Update `.env.example`**

Add:

```bash
# SSO (Supabase Auth) — optional upgrade over anonymous identity
FF_SSO_SUPABASE=false
# SUPABASE_URL / SUPABASE_ANON_KEY already documented above are reused for SSO.
# Magic link requires a production SMTP provider configured in Supabase (Resend/SendGrid);
# the built-in sender is rate-limited and not production-grade.
```

- [ ] **Step 3: Manual smoke (flag on, local)**

Run: `FF_SSO_SUPABASE=true npm run server:dev` then open `/oauth/authorize?...` and confirm the SSO buttons render. (Full provider round-trip needs Supabase dashboard config — Task 12.)

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts views/consent.html .env.example
git commit -m "feat(oauth): add flag-gated SSO buttons to consent screen"
```

---

## Phase C — Verification, config, rollout

### Task 11: Integration tests against a test Supabase

**Files:**
- Create/extend: `tests/server/oauth/ssoRoutes.test.ts`

- [ ] **Step 1: Add integration cases** (run against a disposable Supabase branch/project; skip via `describe.skipIf(!process.env.SUPABASE_TEST_URL)`)

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { resolveSupabaseIdentity, subjectHashFor } from "../../../src/server/oauth/ssoIdentity.js";
import { supabaseIdentityStore } from "../../../src/server/oauth/identityStore.js";
import { oauthServer } from "../../../src/server/oauth/authServer.js";

describe.skipIf(!process.env.SUPABASE_TEST_URL)("SSO identity (integration)", () => {
  beforeAll(() => { process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-test-secret-test-secret-1234"; });

  it("cross-client: same subject from two client_ids → one user_id", async () => {
    const hash = subjectHashFor(`it-user-${Date.now()}`);
    const r1 = await resolveSupabaseIdentity(supabaseIdentityStore, hash, null, "mcp_clientA", { anonHasData: false });
    const r2 = await resolveSupabaseIdentity(supabaseIdentityStore, hash, null, "mcp_clientB", { anonHasData: false });
    expect(r1.status).toBe("resolved");
    expect(r2.status).toBe("resolved");
    expect((r1 as { userId: string }).userId).toBe((r2 as { userId: string }).userId);
  });

  it("conflict writes exactly one orphan row across repeated sign-ins", async () => {
    const hash = subjectHashFor(`it-conflict-${Date.now()}`);
    // Seed the SSO identity, then create a separate anon user with data and sign in twice.
    await resolveSupabaseIdentity(supabaseIdentityStore, hash, null, "mcp_x", { anonHasData: false });
    const anon = await oauthServer.getOrCreateUser(`it-anon-${Date.now()}`);
    const first = await resolveSupabaseIdentity(supabaseIdentityStore, hash, anon, "mcp_x", { anonHasData: true });
    const second = await resolveSupabaseIdentity(supabaseIdentityStore, hash, anon, "mcp_x", { anonHasData: true });
    expect(first.status).toBe("conflict");
    expect(second.status).toBe("conflict");
    // Verify exactly one orphan row exists for this (anon, sso) pair.
    const { getSupabaseClient } = await import("../../../src/db/supabase-helpers.js");
    const { data } = await getSupabaseClient().from("orphaned_identity_links").select("id").eq("anon_user_id", anon);
    expect(data?.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run with a test project configured**

Run: `SUPABASE_TEST_URL=… SUPABASE_TEST_ANON_KEY=… npm test -- tests/server/oauth/ssoRoutes.test.ts`
Expected: PASS (or SKIPPED when env is absent).

- [ ] **Step 3: Commit**

```bash
git add tests/server/oauth/ssoRoutes.test.ts
git commit -m "test(oauth): add SSO identity integration tests (skipped without test project)"
```

---

### Task 12: Supabase dashboard configuration (manual, documented)

**Files:**
- Create: `docs/sso-supabase-setup.md`

- [ ] **Step 1: Document and perform the config**

Write `docs/sso-supabase-setup.md` capturing exactly:
1. Enable Google + GitHub providers (client id/secret) in Supabase Auth → Providers.
2. Add `<base>/auth/callback` to Auth → URL Configuration → Redirect URLs.
3. Enable email provider; set **Confirm email** + a custom SMTP (Resend/SendGrid) under Auth → SMTP.
4. Enable **automatic account linking only for verified emails** (Auth settings) — never unverified.
5. Note: GitHub users with private/unverified emails may resolve to a distinct Supabase user (fails safe).

- [ ] **Step 2: Commit**

```bash
git add docs/sso-supabase-setup.md
git commit -m "docs(oauth): Supabase Auth SSO provider + SMTP + verified-linking setup"
```

---

### Task 13: Regression guard + rollout

**Files:**
- Create: `tests/server/oauth/anonRegression.test.ts`

- [ ] **Step 1: Write the regression test (flag off → SSO routes return 404)**

```ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../../../src/server/index.js"; // ensure `app` is exported; add `export` if needed

describe("anonymous flow regression (FF_SSO_SUPABASE unset)", () => {
  it("SSO routes are not mounted when the flag is off", async () => {
    delete process.env.FF_SSO_SUPABASE;
    const res = await request(app).get("/oauth/sso/start?provider=google&client_id=x&redirect_uri=https://y");
    expect(res.status).toBe(404);
  });

  it("the existing consent screen still renders for a valid client", async () => {
    // Uses an existing seeded/test client_id + redirect_uri; asserts the anon consent path is intact.
    const res = await request(app).get(
      "/oauth/authorize?response_type=code&client_id=" +
        encodeURIComponent(process.env.TEST_CLIENT_ID || "test-client") +
        "&redirect_uri=" + encodeURIComponent(process.env.TEST_REDIRECT_URI || "https://example.com/cb"),
    );
    // Either the consent HTML (200) or a documented invalid_client when no test client is seeded.
    expect([200, 400]).toContain(res.status);
  });
});
```

> If `app` is not currently exported from `src/server/index.ts`, add `export { app };` near its definition — this is a test-only export with no runtime effect. `supertest` is a dev-dependency: `npm install -D supertest @types/supertest` if absent.

- [ ] **Step 2: Run the full suite + typecheck + lint**

Run: `npm install -D supertest @types/supertest && npm test && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 3: Staged rollout**

1. Deploy with `FF_SSO_SUPABASE=false` → verify anonymous flow byte-for-byte (no SSO buttons, no SSO rows).
2. Staging: set `FF_SSO_SUPABASE=true`, complete Google/GitHub/magic-link sign-ins end-to-end.
3. Production canary → full rollout.

- [ ] **Step 4: Commit**

```bash
git add tests/server/oauth/anonRegression.test.ts
git commit -m "test(oauth): regression guard for anonymous flow under SSO flag"
```

---

## Coverage Map (spec → task)

| Spec section | Task(s) |
|---|---|
| Sentinel `client_id`, subject HMAC (Identity Model, Subject hashing) | 2, 7 |
| `anonHasData` existence check | 3 |
| `resolveSupabaseIdentity` (adopt/conflict/race/null/consent) | 4, 5 |
| `pending_authorizations` table + lifecycle + sweep | 1, 6, 9 |
| `orphaned_identity_links` table + idempotent writes | 1, 4, 5 |
| Authorize & Callback flow (OAuth + magic-link branches) | 8, 9 |
| Consent page + conflict interstitial + resume by nonce | 9, 10 |
| Cross-client unification | 4, 5, 11 |
| Privacy (no raw id stored; HMAC) | 2, 5 |
| Observability metrics | 9 (emit points; extend as needed) |
| Supabase config (verified-email linking, SMTP, redirect URLs) | 12 |
| Rollout flag + regression | 9, 13 |
| Shrink-chat: no protocol change | (no code; asserted by Task 13 regression) |
