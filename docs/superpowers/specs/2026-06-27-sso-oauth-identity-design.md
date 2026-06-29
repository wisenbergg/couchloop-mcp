# SSO OAuth Identity — Design Spec

**Date:** 2026-06-27
**Status:** Approved for planning (rev 4 — third-pass review: resume-context lifecycle, deterministic canonical SSO user, race-safe consent, signature/constraint fixes)
**Supersedes parts of:** `docs/OAUTH_STABLE_IDENTITY_SPEC.md` (resolves its Open Questions #1 and #2)

## Purpose

Give a single human a **durable, cross-device, cross-client** internal identity by authenticating them through Supabase Auth SSO during the OAuth `/oauth/authorize` flow. Today, identity is anchored to a per-browser cookie ([index.ts:610](../../../src/server/index.ts:610)), so continuity breaks on a new device, incognito window, or cookie clear. This design replaces the *source* of identity (a cookie) with a verified provider subject, while keeping the durable mapping layer (`oauth_subject_links`) that already exists and works.

## Goals

- A signed-in user resolves to the **same internal `user_id`** across devices, browsers, sessions, token refreshes, **and MCP clients** (ChatGPT, Claude, etc.).
- Preserve the current frictionless anonymous flow — SSO is an **optional upgrade**, not a gate, with **no regression** to the anonymous path.
- Preserve pseudonymity: store only a keyed hash of the subject, never email or raw provider sub.
- Carry a user's pre-sign-in work forward when they sign in, safely, **without re-keying data** across our tables or shrink-chat.

## Non-Goals

- Mandatory authentication / removing anonymous access.
- Cross-provider linking by raw email in our own code (we rely on Supabase's verified-email linking instead).
- **Re-keying / merging an established anonymous user into an *already-existing* SSO identity** — that requires a cross-table + shrink-chat data migration and is deferred to a **Phase 2 manual-merge tool**.
- Passing a verifiable identity token *to* shrink-chat (future hardening; shrink-chat still trusts the MCP-supplied `userId`).

## Decisions (locked)

| Decision | Choice |
|---|---|
| Auth gate | **Optional upgrade** — anonymous cookie flow still works; sign-in upgrades to durable identity |
| Providers (Phase 1) | **Google, GitHub, Email magic link** |
| Providers (deferred) | Apple (App Store overhead), Microsoft/Azure AD (enable if enterprise users appear) |
| Stable subject | **Supabase `auth.users.id`** (`issuer='supabase'`) — one identity per human across providers via Supabase verified-email linking |
| Client scope | **Cross-client unified** — `issuer='supabase'` links use a reserved **sentinel `client_id`** so they collapse to one row regardless of which MCP client signed in |
| Pre-sign-in work | **Adopt-on-miss only.** Silent adopt only when the browser has **zero** anonymous data; any anonymous data → a one-click "is this yours?" merge consent. An existing SSO identity always wins; a conflicting anonymous user is persisted for the Phase 2 merge tool, never silently destroyed |
| Integration | **Server-side broker** using `@supabase/ssr` PKCE flow |
| Rollout flag | `FF_SSO_SUPABASE` |

## Identity Model

`users.id` remains the canonical internal UUID. Continuity lives in `oauth_subject_links` (table + full unique index from migration `0005`, **unchanged**).

- **Anonymous links** (unchanged): `issuer='browser-local'`, `client_id` = real client, `subject_hash` = hash of the browser cookie. Per-client.
- **SSO links** (new): `issuer='supabase'`, `client_id = SSO_SENTINEL_CLIENT_ID` (a reserved constant, see below), `subject_hash = HMAC-SHA256(SUBJECT_HASH_KEY, 'supabase:' + supabaseUserId)`.

Because the sentinel `client_id` is a fixed constant for every SSO row, the existing unique index `(client_id, issuer, subject_hash)` makes SSO rows unique **on the subject hash alone** — so two different MCP clients signing in with the same Supabase identity collapse to the same row and the same `user_id`. This delivers cross-client unification **without changing the schema or the existing upsert code path** (fixes review #1/#2).

### Sentinel constant

```ts
// A reserved value that can never be issued as a real client_id.
// Dynamic clients are minted as `mcp_<uuid>` (authServer.ts:144); pre-provisioned
// clients are controlled, so `__sso__` is collision-free.
export const SSO_SENTINEL_CLIENT_ID = "__sso__";
```

`registerDynamicClient` must reject any attempt to register this literal as a client_id (defensive; it already only mints `mcp_*`).

### Subject hashing (review #7)

SSO `subject_hash` uses **HMAC-SHA256 with an app-side key**. A bare unsalted SHA-256 of a stable Supabase id would be reversible by a DB-read adversary who can enumerate the id space; HMAC closes that.

The key is **derived deterministically from `JWT_SECRET`** (already required in production, [authServer.ts:54-59](../../../src/server/oauth/authServer.ts:54)) via HKDF with a fixed info label:

```ts
const SUBJECT_HASH_KEY = hkdf("sha256", JWT_SECRET, "", "oauth-subject-hash", 32);
```

This is the *defined* scheme, not a fallback — it introduces **no new env var** and adds no hardcoded secret (CLAUDE.md forbids `|| 'dev-secret'`-style fallbacks). It **intentionally diverges** from the existing `issuer:clientId:subject` SHA-256 scheme used for cookie links ([authServer.ts:567](../../../src/server/oauth/authServer.ts:567)) — documented here so future readers don't assume one scheme. Cookie subjects are already 24 bytes of randomness so unsalted SHA-256 is non-reversible there; only the low-entropy Supabase id needs HMAC. Only the hash is stored; never the email, raw Supabase id, or provider sub.

## Schema

**No schema change to `oauth_subject_links`.** SSO rows reuse the existing table and its full unique index `(client_id, issuer, subject_hash)` via the sentinel `client_id`. `client_id` stays `NOT NULL`. RLS from `0007` already restricts the table to the service role and continues to apply. With `FF_SSO_SUPABASE` off, no SSO rows are ever written, so identity rollback is trivial.

**One new table — `pending_authorizations`** (migration `0010`). The resume context between authorize-initiation and `/auth/callback` must survive across server instances (this service can run multi-instance on Railway/Vercel), so it cannot live in process memory:

```sql
CREATE TABLE IF NOT EXISTS public.pending_authorizations (
  nonce                 TEXT PRIMARY KEY,      -- 32 random bytes, hex
  authorize_params      JSONB NOT NULL,        -- client_id, redirect_uri, state, scope, PKCE challenge
  anon_user_id          UUID REFERENCES public.users(id) ON DELETE SET NULL,
  anon_has_data         BOOLEAN NOT NULL DEFAULT false,
  verified_subject_hash TEXT,                  -- set after the Supabase exchange; lets the consent POST resume
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMP NOT NULL      -- set by the app on insert: NOW() + 10 min
);
```

`expires_at` is **set by the application on insert** (`now + 10 min`); Postgres cannot default one column from another, so there is no column DEFAULT (rev 3 review). The record is **kept alive through the consent/conflict round-trip and deleted only when the auth code is successfully minted** (rev 4 review #1) — *not* deleted at first callback. `verified_subject_hash` is written after the Supabase code/OTP exchange so the consent-page POST can resume by `nonce` without re-verifying or ever handling the raw Supabase id. TTL-swept by the existing periodic cleanup job (same one that prunes expired `authorization_codes`/`oauth_tokens`). RLS: service-role only, no anon access (mirror `0007`). `redirect_uri` lives here server-side, never on the wire, so it cannot be tampered between hops.

**One more table — `orphaned_identity_links`** (same migration `0010`). Persists the conflict case so the Phase 2 merge tool can actually find and consolidate orphaned anonymous work — without it, "queued for Phase 2 / recoverable" is unbacked (review #2):

```sql
CREATE TABLE IF NOT EXISTS public.orphaned_identity_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sso_user_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_id    TEXT,                          -- which MCP client surfaced the conflict
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMP,                     -- set when the Phase 2 tool consolidates
  UNIQUE (anon_user_id, sso_user_id)          -- repeated conflicts are idempotent (rev 4 review #6)
);
```

The conflict write is `INSERT … ON CONFLICT (anon_user_id, sso_user_id) DO NOTHING`, so a user who keeps re-authorizing from the same anonymous browser produces exactly one orphan row, not one per sign-in.

## Resolver (`src/server/oauth/authServer.ts`)

Keep `resolveOrCreateUserForSubject(clientId, issuer, subject)` for the cookie path, **unchanged** — it keeps using its existing `.upsert({ onConflict: "client_id,issuer,subject_hash", ignoreDuplicates: true })` against the full index ([authServer.ts:593-606](../../../src/server/oauth/authServer.ts:593)).

Add `resolveSupabaseIdentity(subjectHash, candidateAnonUserId, clientId, opts: { anonHasData, consent })`. **One governing rule: we only ever ADOPT on a miss; we never sweep anonymous data into an account without consent; an existing SSO identity always wins; a conflicting anonymous user is persisted for Phase 2, never silently destroyed.**

The caller passes the **already-computed `subjectHash`** (the raw Supabase id never reaches this function — privacy). `clientId` is the real MCP client_id (for the orphan record, rev 4 review #3). `consent` is `undefined` on the first call and `'adopt' | 'decline'` when re-entered from the consent page.

```
-- The canonical SSO user is deterministic and idempotent (rev 4 review #4/#5):
-- external_id = 'sso:' + subjectHash  → getOrCreateUser upserts on it, never stores the raw id.
function canonicalSsoUser(subjectHash) = getOrCreateUser('sso:' + subjectHash)

-- Null candidate (anon expired/deleted in the 10-min window, ON DELETE SET NULL) → treat as no anon.
hasAnon = candidateAnonUserId != null

existing = SELECT user_id FROM oauth_subject_links
           WHERE client_id = SSO_SENTINEL_CLIENT_ID AND issuer='supabase'
             AND subject_hash = subjectHash               -- .maybeSingle()

if existing:                                              -- HIT: identity seen before
    if hasAnon AND candidateAnonUserId != existing.user_id AND anonHasData:
        INSERT orphaned_identity_links {anon_user_id: candidateAnonUserId, sso_user_id: existing.user_id, client_id: clientId}
            ON CONFLICT (anon_user_id, sso_user_id) DO NOTHING
        return { status: 'conflict', anonUserId: candidateAnonUserId, ssoUserId: existing.user_id }
    return { status: 'resolved', userId: existing.user_id }

-- MISS: first time this SSO identity is seen.
if hasAnon AND anonHasData AND consent == undefined:
    return { status: 'needs_merge_confirmation' }         -- consent gate (shared-browser)

-- Decide the target user_id:
if hasAnon AND anonHasData AND consent == 'adopt':
    targetUser = candidateAnonUserId                      -- user confirmed the data is theirs
else if hasAnon AND not anonHasData:
    targetUser = candidateAnonUserId                      -- empty anon → silent adopt, no data move
else:
    targetUser = canonicalSsoUser(subjectHash)            -- no anon, or consent=='decline'

-- Atomic claim: first writer wins; a concurrent HIT created between the SELECT and here
-- collapses to the existing row, and we re-resolve so a consented adopt that lost the race
-- becomes a conflict (orphan recorded) instead of silently vanishing (rev 4 review #2).
INSERT link {client_id: SSO_SENTINEL_CLIENT_ID, issuer:'supabase', subject_hash, user_id: targetUser}
    ON CONFLICT (client_id, issuer, subject_hash) DO NOTHING
winner = SELECT user_id ...subjectHash...                 -- the actual row now present
if winner != targetUser AND hasAnon AND anonHasData:
    INSERT orphaned_identity_links {anon_user_id: candidateAnonUserId, sso_user_id: winner, client_id: clientId}
        ON CONFLICT DO NOTHING
return { status: 'resolved', userId: winner }
```

The consent-page entrypoints simply **re-enter this same function** with the persisted context (from the pending record by `nonce`) — they are not a separate code path, which is what makes them race-safe (rev 4 review #2):
- Confirm → `resolveSupabaseIdentity(verified_subject_hash, anon_user_id, client_id, { anonHasData: true, consent: 'adopt' })`.
- Decline → `…, { anonHasData: true, consent: 'decline' }` → resolves to the canonical SSO user; the anonymous user is left untouched.

**`anonHasData` is a single existence query** (review #1/#4) — one `SELECT EXISTS(...)` over a `UNION ALL` of "any row for this `user_id`" in `sessions` and `insights` (the user_id-keyed work tables; `context_entries`/`checkpoints` are thread-/session-scoped with no user_id), short-circuiting on the first hit. The earlier attempt to exempt "just tried it, now signing in" via a session-timestamp boundary was unsound: normal use creates sessions *before* the authorize click, so that boundary classified almost everyone as "returning" (or, if loosened, missed same-visit shared-browser data). Because we cannot tell from timestamps whether the data belongs to the person now signing in, we **ask** whenever any data exists. The friction is one click, once, and only for users who actually have anonymous work — precisely the population where shared-browser contamination is a risk, which for a mental-health product is the right place to spend a click. A genuinely empty browser (no sessions/artifacts) has nothing to leak → silent adopt, zero friction.

## Authorize & Callback Flow (`src/server/index.ts`)

1. `/oauth/authorize` renders the consent screen with the existing **"Continue anonymously"** path plus flag-gated **"Sign in with Google / GitHub / email"** buttons.
2. **Anonymous path:** unchanged — `getOrCreateBrowserSubject` → `resolveOrCreateUserForSubject(client_id, 'browser-local', cookie)` → `generateAuthCode`.
3. **SSO path (initiation):**
   a. Resolve the current browser's anonymous `user_id` and compute `anonHasData` *now* (in the originating browser, where the cookie exists).
   b. Create a server-side **pending-authorization record** holding the original authorize params (`client_id`, `redirect_uri`, `state`, `scope`, `code_challenge`, `code_challenge_method`), the captured `anonUserId`, and `anonHasData`. Key it by a random single-use **`nonce`** (32 bytes), TTL 10 min.
   c. Redirect with `redirectTo = <base>/auth/callback?n=<nonce>`. The nonce travels **in the redirect URL, not the OAuth `state`** — Supabase owns the provider-hop `state`/PKCE, so we cannot inject our own there (review #5).
4. **`/auth/callback`** — two branches by sign-in type (review #6):
   a. **OAuth providers (Google/GitHub):** PKCE flow → callback receives `?code=` → `exchangeCodeForSession(code)`. The PKCE `code_verifier` lives in the initiating browser, so this branch is inherently **same-browser** (standard and expected for an interactive "Sign in with…" click).
   b. **Email magic link:** uses the **`token_hash` / `verifyOtp`** flow, **not** PKCE. The OTP `type` is **taken from the callback `type` query param** (`magiclink` for returning users, `signup`/`email` for first-time users) — do **not** hardcode `type: 'magiclink'`, which would reject new-user signups (review #4). This needs no `code_verifier`, so a link clicked on a **different device** still verifies, and the nonce-in-URL carries the resume context (and the originating browser's captured `anonUserId`) across that device boundary. Do **not** route magic links through `exchangeCodeForSession`: PKCE would fail cross-device because the verifier isn't present.
   c. Either branch yields `user.id`. Read `n` from the URL and **load** the pending record (do **not** delete yet — review #1). If absent/expired → restart the authorize flow. Compute `subjectHash` from `user.id` and `UPDATE` the record's `verified_subject_hash` (so a later consent POST can resume without re-verifying or touching the raw id).
   d. Call `resolveSupabaseIdentity(subjectHash, anonUserId, client_id, { anonHasData })`:
      - `resolved` → `generateAuthCode(...)` with the stashed params, **delete the pending record**, redirect to the MCP client with the code (+ `state`).
      - `needs_merge_confirmation` → render the **"We found work saved in this browser — is it yours?"** consent page, carrying the `nonce` (hidden field). The Yes/No POST re-loads the still-alive record by `nonce`, re-enters `resolveSupabaseIdentity` with `consent: 'adopt' | 'decline'`, then mints the code, **deletes the record**, and redirects.
      - `conflict` → render the **informational interstitial** ("You have separate work on this device; it stays separate until account merge ships — continuing as your existing account"), carrying the `nonce`; its "continue" POST resumes by `nonce`, mints the code, **deletes the record**, redirects. The `orphaned_identity_links` row was already written by the resolver and `oauth.identity.conflict` emitted. The interstitial is required so the user is not *silently* switched (review #6); it is informational, not a gate.

The pending record is **deleted exactly once, on the terminal mint**, in every branch. Redirect-URI and client validation remain mandatory and unchanged; `redirect_uri` lives in the record server-side, never on the wire.

## Shrink-Chat Interaction

The MCP↔shrink-chat connection is **unchanged**: [`shrinkChatClient.ts`](../../../src/clients/shrinkChatClient.ts) still POSTs to `COUCHLOOP_SERVER` with `X-Source: mcp-server` and the same payload. SSO sits entirely upstream and only changes which `user_id` is resolved. **No shrink-chat code changes are required for Phase 1.**

shrink-chat keys two things differently:

- **Conversation history → `threadId`** (`session.thread_id`), owned by shrink-chat, follows the *session*.
- **Long-term memory / RAG → `userId`** (`session.user_id`), follows the *human*.

**Benefit:** a stable `userId` lets shrink-chat's RAG correctly unify a person's therapeutic memory across devices, instead of fragmenting it per browser cookie.

**Identity behavior** (the only cross-system edge case):

| Resolver outcome | `userId` to shrink-chat | shrink-chat memory effect |
|---|---|---|
| Adopt (miss, fresh anon) | stays `A` | Fully preserved — shrink-chat sees no change |
| Adopt confirmed (miss, anon has data, user said "yes") | stays `A` | Fully preserved |
| Conflict (SSO identity already exists) | switches `A`→ existing SSO id | Anon RAG memory under `A` orphaned on shrink-chat side; anon persisted in `orphaned_identity_links` for Phase 2 merge |
| Adopt declined | switches to fresh SSO id | Anon RAG history not surfaced under the new id |

Because adoption keeps the anonymous `user_id`, shrink-chat needs **zero awareness of the merge** in the common path. Re-keying would have forced a cross-service memory migration, which this design avoids — and is exactly why the conflict case is deferred to Phase 2 rather than auto-merged.

**Phase 1 behavior for the switch cases:** accept **fresh-start** for shrink-chat user-memory (conversation threads still persist per-session because they are thread-scoped). Log `oauth.identity.shrinkchat.memory_orphaned`. A true memory-follows-merge requires a shrink-chat alias/merge endpoint that does not exist today → **Phase 2 dependency**, explicitly out of scope here.

**Security note:** shrink-chat currently trusts the MCP-supplied `userId` without verification (`X-Source` header only). SSO makes that `userId` trustworthy but does not make shrink-chat *verify* it; passing a verifiable token to shrink-chat is future hardening, not in scope.

## Security & Privacy

- Store only `subject_hash` (HMAC-SHA256, app-side key); never email, raw Supabase id, or provider sub.
- Enable Supabase automatic account linking for **verified emails only** — this closes the account-takeover vector. GitHub users with private/unverified emails may land as a separate Supabase user and therefore may not cross-provider-link (acceptable, fails safe).
- Pending-auth nonce is random, single-use, 10-min TTL; the record holds `redirect_uri` server-side. Mandatory redirect-URI and client validation unchanged.
- Magic-link requires a production SMTP provider (e.g. Resend/SendGrid); Supabase's built-in sender is rate-limited and not production-grade.

## Edge Cases (from review)

1. **Anonymous-flow regression (review #1)** — *resolved*: sentinel `client_id` keeps the existing full unique index and the existing upsert code path untouched. No partial indexes.
2. **Race-safe adoption (review #2)** — *resolved*: adoption reuses the same `.upsert(onConflict:'client_id,issuer,subject_hash', ignoreDuplicates)` pattern, now valid because the index is unchanged.
3. **Shared-browser contamination** — long-lived cookie + a second human signing in. Neutralized by the consent gate: any browser holding anonymous data triggers "is this yours?" before adoption. Same-visit data is covered because the gate keys on *existence of data*, not on a timestamp (review #1).
4. **Existing-identity conflict, incl. multi-client (review #3)** — same human signs in under client X, then client Y (a HIT). If the current client's anon has data and differs from the resolved SSO user, the resolver writes an `orphaned_identity_links` row and returns `conflict`; the anon user is left intact and persisted for Phase 2 — never silently orphaned. One rule covers single-device and multi-client cases. **The canonical `user_id` is whichever identity signed in *first* (order-dependent, not "most data"); this is deterministic and lossless — the Phase 2 manual-merge tool consolidates the persisted anon work into it.**
5. **Email-linking conditionality / takeover** — verified-email-only linking; unverified providers fail safe to a separate identity.
6. **Concurrent first sign-in race** — `upsert … ignoreDuplicates` + re-select winner.
7. **Magic-link / cross-device callback (review #6)** — magic link uses the `token_hash`/`verifyOtp` flow (no PKCE `code_verifier`), so a link opened on another device verifies; the nonce-in-URL carries the resume context across the device boundary. OAuth providers use PKCE `exchangeCodeForSession` (same-browser). Routing magic links through PKCE would fail cross-device — explicitly avoided.

## Rollout

- `FF_SSO_SUPABASE=true` enables SSO buttons + the callback. Off → today's cookie-only behavior, byte-for-byte (no SSO rows, no pending records written).
- The `0010` `pending_authorizations` table is additive and inert while the flag is off, so it can ship ahead of enablement. `oauth_subject_links` is unchanged, so identity data needs no rollback.
- Phases: staging verification → production canary → full rollout.

## Observability

Extend existing metrics (names aligned to the resolver outcomes and `confirmAdopt`/`declineAdopt` entrypoints, review #7):
- `oauth.identity.sso.hit`, `oauth.identity.sso.miss`
- `oauth.identity.adopt.silent`, `oauth.identity.adopt.confirmed`, `oauth.identity.adopt.declined`
- `oauth.identity.conflict`
- `oauth.identity.shrinkchat.memory_orphaned`

Log fields: `client_id`, `issuer`, `identity_resolution` (`hit`/`miss`/`adopt_silent`/`adopt_confirmed`/`adopt_declined`/`conflict`). Never log raw subject, email, or client secret.

## Testing

**Unit**
- adopt-silent: miss + empty anon (no data) → SSO link created on the anon `user_id`, reusing the existing upsert.
- hit-existing-wins: existing SSO link → returned; anon untouched.
- has-data (miss + any anonymous artifact) → `needs_merge_confirmation`.
- `anonHasData` is existence-only: a brand-new anon with one in-progress session **and any saved artifact, or any session at all** → has data → confirmation; a truly empty anon (zero sessions/artifacts) → silent adopt. No timestamp boundary.
- null candidate (anon expired/deleted in the window) → canonical SSO user (`external_id='sso:'+hash`), no `NOT NULL` violation.
- canonical SSO user is idempotent: two calls for the same subject (decline, or no-anon) → one user row, never duplicates.
- consented-adopt loses the race: SSO link created concurrently between gate and confirm → re-entry returns `resolved` to the existing user **and** writes an `orphaned_identity_links` row — consented data never silently vanishes (review #2).
- orphan idempotency: repeated conflicts for the same (anon, sso) pair → one row (`ON CONFLICT DO NOTHING`, review #6).
- external_id never contains the raw Supabase id (privacy); only `sso:<hash>`.
- new-user magic link: `verifyOtp` uses the callback `type` (`signup`/`email`), not hardcoded `magiclink` (review #4).
- multi-client conflict: existing SSO link + current anon has data → `conflict`, `orphaned_identity_links` row written, anon not deleted.
- concurrent-adopt race → single winner, no duplicate links.
- cross-client: same Supabase id from two `client_id`s → same `user_id` (sentinel collapses them).
- hash: HMAC keyed; same id+key → same hash; different key → different hash.

**Integration**
- anon work → sign-in (adopt) → work retrievable under same `user_id`.
- two MCP clients, same Google account → one identity, one history.
- shared browser, second human signs in → confirmation shown, no contamination.
- adopt declined → canonical SSO `user_id`; anon session threads still resolve under the anon cookie.
- consent round-trip: gate → consent-page POST (different request) resumes by `nonce`, mints the code, redirects to the MCP client; pending record deleted exactly once.
- magic-link clicked in a different browser/device → `verifyOtp(token_hash)` succeeds (no PKCE verifier needed); nonce-in-URL resumes and adopts the originating browser's captured anon user.
- pending-authorization record survives across a simulated multi-instance hop (written by one instance, read by another); expired/missing nonce → restart, not crash.

**Regression**
- anonymous flow unchanged (same index, same upsert); review / memory / status / conversation unchanged.
- OAuth metadata + token endpoints unchanged.
- MCP↔shrink-chat payload unchanged (`userId`, `threadId`, headers).

## Acceptance Criteria

- Repeated sign-ins by the same human (any enabled provider, any MCP client) return the same internal `user_id`.
- Pre-sign-in work is retrievable after sign-in via adopt; established-anon and shared-browser cases require explicit confirmation; conflicts are flagged, never lost.
- Anonymous flow still works with **no regression** and no required login (same index, same code path).
- No raw subject/email persisted; only keyed hashes.
- No MCP↔shrink-chat protocol changes; no new shrink-chat dependency in Phase 1.
- No increase in auth error rate; no developer-tool regressions.
