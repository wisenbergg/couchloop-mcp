# Supabase Auth SSO — Dashboard Setup

This is the **manual configuration** required before flipping `FF_SSO_SUPABASE=true`. It is done in the Supabase dashboard for the **CouchLoop MCP** project (`tvqjkrghxnxmgaatlnfn`). The code reuses the existing `SUPABASE_URL` / `SUPABASE_ANON_KEY`.

> Nothing here changes app behavior until `FF_SSO_SUPABASE=true` is set. With the flag off, the SSO routes are not mounted.

## 1. Enable providers (Auth → Sign In / Providers)

| Provider | What to enter | Notes |
|---|---|---|
| **Google** | OAuth client ID + secret from Google Cloud Console | Authorized redirect URI in Google = `https://<project-ref>.supabase.co/auth/v1/callback` |
| **GitHub** | OAuth app client ID + secret from GitHub Developer settings | GitHub callback URL = `https://<project-ref>.supabase.co/auth/v1/callback` |
| **Email** | Enable "Email" provider; this powers the magic link | See SMTP below |

The provider→Supabase callback (`/auth/v1/callback`) is internal to Supabase. Our app's callback (`/auth/callback`) is configured separately in step 2.

## 2. Redirect URLs (Auth → URL Configuration)

Add our callback to the **Redirect URLs** allow-list (one per environment):

```
http://localhost:3001/auth/callback        # local dev (server:dev on PORT 3001)
https://mcp.couchloop.com/auth/callback     # production
```

The `?n=<nonce>` query param is appended at runtime — Supabase matches the path prefix, so the bare path above is sufficient. If you use a wildcard pattern, ensure it permits the `?n=` query.

## 3. SMTP for magic link (Auth → Emails / SMTP Settings)

The built-in Supabase email sender is **rate-limited and not production-grade**. Configure a real SMTP provider (Resend or SendGrid) before relying on magic link:

- Set the SMTP host/port/user/pass.
- Set a verified sender domain.

### Magic-link email template (Auth → Email Templates → Magic Link)

The app verifies via the **`token_hash` flow** (`verifyOtp`), not the legacy `?token=` link. Ensure the Magic Link template uses a `token_hash` confirmation URL pointing at our callback:

```
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email
```

(Supabase appends nothing else; our callback reads `token_hash` + `type` and resolves the pending record by the `n` nonce that was already in the `redirectTo`.)

## 4. Account linking — verified emails ONLY (Auth → settings)

Enable automatic account linking **only for verified emails**. Never enable linking on unverified emails — that is an account-takeover vector (an attacker could register a victim's email on a provider that doesn't verify it and get linked to the victim's identity).

Consequence to expect: a GitHub user with a **private/unverified** email may resolve to a *separate* Supabase user (and therefore a separate internal `user_id`). This fails safe — no incorrect linking — and is acceptable for Phase 1.

## 5. Set the trusted callback origin (required in prod)

Set `OAUTH_PUBLIC_BASE_URL` to this server's canonical public origin in each deployed environment:

```bash
OAUTH_PUBLIC_BASE_URL=https://mcp.couchloop.com
```

The SSO callback / magic-link `redirectTo` is built from this value, **not** from the request's `Host`/`X-Forwarded-Host` headers. This prevents Host-header poisoning from redirecting the callback to an attacker domain or leaking magic-link token material. If unset, the code falls back to the request-derived host (acceptable for local dev only) and logs a warning. It must match an entry in the Supabase Redirect URLs allow-list (step 2).

## 6. Flip the flag

Once the above is in place per environment:

```bash
FF_SSO_SUPABASE=true
```

Staged rollout: staging verification → production canary → full rollout. Disabling the flag stops all SSO writes immediately; the `0010` tables are additive and inert while off.

## Reference

- Design spec: `docs/superpowers/specs/2026-06-27-sso-oauth-identity-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-27-sso-oauth-identity.md`
- Migration: `src/db/migrations/0010_add_sso_pending_and_orphan_tables.sql` (already applied to the CouchLoop MCP project)
