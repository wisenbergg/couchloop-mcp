# OAuth Stable Identity Specification

## Purpose
Define how CouchLoop EQ maps OAuth authorizations to a stable internal user UUID so users can retrieve prior work across new sessions.

## Problem Statement
Current authorization behavior can create a new pseudonymous user per authorization event. This breaks continuity for:
- prior sessions
- saved checkpoints
- stored context and decisions
- user preferences

## Goals
- Use a stable identity key per real user and client.
- Reuse the same internal user UUID across new sessions and token refreshes.
- Preserve pseudonymity, do not store personal data.
- Maintain compatibility with existing sessions and tokens during rollout.

## Non-Goals
- Cross-provider account linking by email or real-world identifiers.
- Rewriting historical token payloads.
- Changing public OAuth grant types.

## Identity Model
### Canonical Internal Identity
- `users.id` remains the canonical internal UUID.

### Stable External Subject Key
Resolve an immutable subject key from trusted identity context:
- preferred: `issuer + subject` from authenticated provider context
- fallback: `client_id + stable platform subject` (for example OpenAI subject claim)
- never use `state`, timestamps, or conversation IDs as primary identity

### Hashing
Store only a deterministic hash of the stable subject key:
- hash input: `issuer + ':' + client_id + ':' + subject`
- algorithm: SHA-256
- output format: lowercase hex string

## Database Design
### New Mapping Table
`oauth_subject_links`
- `id` UUID primary key
- `client_id` text not null
- `issuer` text not null
- `subject_hash` text not null
- `user_id` UUID not null references `users(id)`
- `created_at` timestamp not null default now
- `updated_at` timestamp not null default now

### Constraints
- unique (`client_id`, `issuer`, `subject_hash`)
- index on `user_id`

### Rationale
Keep `users` stable as the owner of long-term work, and decouple authentication subject mapping from user profile persistence.

## Authorization and Token Flow
1. Client calls `/oauth/authorize`.
2. Server validates client and redirect URI.
3. Server resolves stable subject key from trusted context.
4. Server looks up `oauth_subject_links` by (`client_id`, `issuer`, `subject_hash`).
5. If found, reuse `user_id`.
6. If missing, create user and mapping atomically in one transaction.
7. Server issues authorization code tied to that `user_id`.
8. Client exchanges code at `/oauth/token`.
9. Access token `sub` is set to stable `user_id`.

## Required Implementation Changes
### src/server/index.ts
- Replace ad hoc anonymous external ID generation in `/oauth/authorize`.
- Call new resolver API to get stable `user_id`.

### src/server/oauth/authServer.ts
Add methods:
- `resolveOrCreateUserForSubject(clientId, issuer, subject): Promise<string>`
- `hashStableSubject(issuer, clientId, subject): string`

Requirements:
- use upsert style behavior and unique constraints to avoid races
- never mint user UUID from request `state`

### src/server/middleware/auth.ts
No API shape changes required. Continue using token `sub` as `req.user.userId`.

## Migration Strategy
1. Add `oauth_subject_links` migration.
2. Deploy code that can resolve via mapping table.
3. Backfill optional links for known stable subjects where deterministically available.
4. Keep legacy users intact.
5. Do not auto-merge ambiguous legacy users.

## Rollout
Use feature flag:
- `FF_STABLE_OAUTH_SUBJECT=true`

Phased rollout:
1. staging verification
2. production canary
3. full rollout

## Security and Privacy
- No raw subject stored, hashed only.
- Redirect URI validation remains mandatory.
- Client credential checks unchanged.
- Subject hash is deterministic and scoped by client and issuer.

## Observability
Track metrics:
- `oauth.identity.link.hit`
- `oauth.identity.link.miss`
- `oauth.identity.user.created`
- `oauth.identity.resolve.error`
- `oauth.token.invalid_grant`

Log fields:
- `client_id`
- `issuer`
- `identity_resolution` (`hit` or `miss`)
- never log raw subject or client secret

## Testing Requirements
### Unit Tests
- same (`issuer`, `client_id`, `subject`) resolves same `user_id`
- different subject resolves different `user_id`
- race condition test for concurrent first-login requests

### Integration Tests
- first auth creates user and mapping
- second auth reuses same user
- saved session/context retrieval works across new authorizations

### Regression Tests
- review, package audit, status, memory, conversation flows unchanged
- OAuth metadata and token endpoints unchanged

## Acceptance Criteria
- repeated authorizations for same subject return same internal user UUID
- prior work is retrievable in new sessions
- no increase in auth error rate
- no developer tool regressions

## Open Questions
- What is the authoritative provider subject source in each client integration path
- Should identity continuity be per-client only, or support configurable cross-client linking
- What is the retention policy for stale subject links
