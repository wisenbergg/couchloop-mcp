import express, { Router, type Request, type Response } from "express";
import { logger } from "../../utils/logger.js";
import { escapeHtml } from "../../utils/inputSanitize.js";
import { rateLimit } from "../middleware/auth.js";
import { oauthServer } from "./authServer.js";
import { getSupabaseClient } from "../../db/supabase-helpers.js";
import {
  subjectHashFor,
  anonHasData,
  resolveSupabaseIdentity,
  type ResolveResult,
} from "./ssoIdentity.js";
import { supabaseIdentityStore } from "./identityStore.js";
import {
  providerSignInUrl,
  sendMagicLink,
  exchangeCode,
  verifyMagicLink,
} from "./supabaseAuth.js";
import {
  newNonce,
  buildPendingRow,
  createPending,
  loadPending,
  markVerified,
  deletePending,
  type AuthorizeParams,
} from "./pendingAuth.js";

const OAUTH_IDENTITY_COOKIE = "couchloop_eq_identity";

type GenerateAuthCode = (
  clientId: string,
  userId: string,
  redirectUri: string,
  scope: string,
  codeChallenge?: string,
  codeChallengeMethod?: "S256" | "plain",
) => Promise<string>;

const generateAuthCode: GenerateAuthCode = (c, u, r, s, cc, ccm) =>
  oauthServer.generateAuthCode(c, u, r, s, cc, ccm);

/** Proxy-aware external base URL (mirrors index.ts getExternalBaseUrl). */
function externalBaseUrl(req: Request): string {
  const xfProto = req.headers["x-forwarded-proto"];
  const forwardedProto = typeof xfProto === "string" ? xfProto.split(",")[0]?.trim() : undefined;
  const xfHost = req.headers["x-forwarded-host"];
  const forwardedHost = typeof xfHost === "string" ? xfHost.split(",")[0]?.trim() : undefined;
  const protocol = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : req.protocol;
  const host = forwardedHost || req.get("host");
  return `${protocol}://${host}`;
}

/**
 * Trusted base URL for the SSO callback / magic-link redirect.
 * Prefers the configured `OAUTH_PUBLIC_BASE_URL` so attacker-controlled forwarded
 * Host headers can never redirect the callback or leak magic-link tokens to another
 * origin (the request-derived host is a dev-only fallback). MUST be set in production.
 */
export function ssoCallbackBaseUrl(req: Request): string {
  const configured = process.env.OAUTH_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  logger.warn(
    "[SSO] OAUTH_PUBLIC_BASE_URL is not set — falling back to request-derived host (unsafe behind untrusted proxies). Set it in production.",
  );
  return externalBaseUrl(req);
}

// Endpoint limiter: /oauth/sso/start is unauthenticated. Uses the shared app limiter
// (IP-keyed), matching /oauth/authorize's 10/min.
const startLimiter = rateLimit(10, 60_000);

// Dedicated, namespaced limiter for outbound magic-link emails. The shared rateLimit
// map is keyed only by IP, so a second rateLimit() instance would collide with
// startLimiter (corrupting the 1-hour window and double-counting). This keeps its own
// state so the email throttle is actually enforced.
const emailRateState = new Map<string, { count: number; resetAt: number }>();
const EMAIL_MAX = 5;
const EMAIL_WINDOW_MS = 60 * 60_000; // 1 hour

export function emailSendLimited(
  ip: string,
  now: number = Date.now(),
): { limited: boolean; retryAfter: number } {
  const entry = emailRateState.get(ip);
  if (!entry || now > entry.resetAt) {
    emailRateState.set(ip, { count: 1, resetAt: now + EMAIL_WINDOW_MS });
    return { limited: false, retryAfter: 0 };
  }
  if (entry.count >= EMAIL_MAX) {
    return { limited: true, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count++;
  return { limited: false, retryAfter: 0 };
}

/** Mint the auth code for a resolved user and build the client redirect URL. */
export async function handleResolved(
  p: AuthorizeParams,
  userId: string,
  gen: GenerateAuthCode,
): Promise<string> {
  const code = await gen(p.client_id, userId, p.redirect_uri, p.scope || "read write", p.code_challenge, p.code_challenge_method);
  const url = new URL(p.redirect_uri);
  url.searchParams.set("code", code);
  if (p.state) url.searchParams.set("state", p.state);
  return url.toString();
}

export function renderConsentPage(nonce: string): string {
  return `<!doctype html><html lang="en"><body>
    <h1>We found work saved in this browser — is it yours?</h1>
    <form method="POST" action="/auth/consent">
      <input type="hidden" name="n" value="${escapeHtml(nonce)}"/>
      <button name="choice" value="adopt">Yes, add it to my account</button>
      <button name="choice" value="decline">No, keep it separate</button>
    </form></body></html>`;
}

export function renderConflictPage(nonce: string): string {
  return `<!doctype html><html lang="en"><body>
    <h1>You have separate work on this device</h1>
    <p>It stays separate until account merge ships. Continuing as your existing account.</p>
    <form method="POST" action="/auth/consent">
      <input type="hidden" name="n" value="${escapeHtml(nonce)}"/>
      <button name="choice" value="continue">Continue</button>
    </form></body></html>`;
}

/** OTP type from the callback query; default to magiclink only when unspecified. */
function otpType(q: unknown): "magiclink" | "signup" | "email" | "recovery" {
  return q === "signup" || q === "email" || q === "recovery" ? q : "magiclink";
}

async function resumeFromResolve(
  res: Response,
  result: ResolveResult,
  p: AuthorizeParams,
  nonce: string,
): Promise<void> {
  if (result.status === "resolved") {
    const url = await handleResolved(p, result.userId, generateAuthCode);
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
  router.get("/oauth/sso/start", startLimiter, async (req: Request, res: Response) => {
    try {
      const q = req.query;
      const provider = String(q.provider || "");
      const params: AuthorizeParams = {
        client_id: String(q.client_id),
        redirect_uri: String(q.redirect_uri),
        state: q.state ? String(q.state) : undefined,
        scope: q.scope ? String(q.scope) : "read write",
        code_challenge: q.code_challenge ? String(q.code_challenge) : undefined,
        code_challenge_method:
          q.code_challenge_method === "S256" || q.code_challenge_method === "plain"
            ? q.code_challenge_method
            : undefined,
      };

      // Re-validate client + redirect_uri (same checks as /oauth/authorize).
      const client = await oauthServer.validateClient(params.client_id);
      if (!client || !client.redirectUris.includes(params.redirect_uri)) {
        res.status(400).json({ error: "invalid_request", error_description: "Invalid client or redirect_uri" });
        return;
      }

      // Capture the current browser's anonymous identity + data flag.
      const cookie = req.cookies?.[OAUTH_IDENTITY_COOKIE] as string | undefined;
      let anonUserId: string | null = null;
      let hasData = false;
      if (cookie) {
        anonUserId = await oauthServer.resolveOrCreateUserForSubject(params.client_id, "browser-local", cookie);
        hasData = await anonHasData(getSupabaseClient(), anonUserId);
      }

      const nonce = newNonce();
      await createPending(buildPendingRow(nonce, params, anonUserId, hasData, new Date()));
      const redirectTo = `${ssoCallbackBaseUrl(req)}/auth/callback?n=${nonce}`;

      if (provider === "google" || provider === "github") {
        res.redirect(await providerSignInUrl(req, res, provider, redirectTo));
      } else if (provider === "email") {
        const email = String(q.email || "").trim();
        if (!email || !email.includes("@")) {
          res.status(400).json({ error: "invalid_request", error_description: "A valid email is required" });
          return;
        }
        // Dedicated per-IP throttle on outbound email (spam / cost amplification).
        const limit = emailSendLimited(req.ip ?? "unknown");
        if (limit.limited) {
          res.status(429).json({
            error: "rate_limit_exceeded",
            message: "Too many sign-in emails, please try again later",
            retryAfter: limit.retryAfter,
          });
          return;
        }
        await sendMagicLink(req, res, email, redirectTo);
        res.type("html").send("<p>Check your email for a sign-in link.</p>");
      } else {
        res.status(400).json({ error: "invalid_request", error_description: "Unknown provider" });
      }
    } catch (err) {
      logger.error("SSO start error:", err);
      res.status(500).json({ error: "server_error" });
    }
  });

  // Callback: /auth/callback?n=…&code=…  (OAuth)  or  …&token_hash=…&type=…  (magic link)
  router.get("/auth/callback", async (req: Request, res: Response) => {
    try {
      const nonce = String(req.query.n || "");
      const pending = await loadPending(nonce);
      if (!pending) {
        res.status(400).send("Sign-in expired, please try again.");
        return;
      }

      let supabaseUserId: string;
      if (req.query.code) {
        supabaseUserId = await exchangeCode(req, res, String(req.query.code));
      } else if (req.query.token_hash) {
        supabaseUserId = await verifyMagicLink(req, res, String(req.query.token_hash), otpType(req.query.type));
      } else {
        res.status(400).send("Missing auth parameters.");
        return;
      }

      const subjectHash = subjectHashFor(supabaseUserId);
      await markVerified(nonce, subjectHash);

      const result = await resolveSupabaseIdentity(
        supabaseIdentityStore,
        subjectHash,
        pending.anon_user_id,
        pending.authorize_params.client_id,
        { anonHasData: pending.anon_has_data },
      );
      await resumeFromResolve(res, result, pending.authorize_params, nonce);
    } catch (err) {
      logger.error("SSO callback error:", err);
      res.status(500).json({ error: "server_error" });
    }
  });

  // Consent / interstitial POST: re-enter the resolver with the user's choice.
  router.post("/auth/consent", express.urlencoded({ extended: false }), async (req: Request, res: Response) => {
    try {
      const nonce = String(req.body.n || "");
      const choice = String(req.body.choice || "");
      const pending = await loadPending(nonce);
      if (!pending || !pending.verified_subject_hash) {
        res.status(400).send("Sign-in expired, please try again.");
        return;
      }

      const consent = choice === "adopt" ? "adopt" : choice === "decline" ? "decline" : undefined;
      const result = await resolveSupabaseIdentity(
        supabaseIdentityStore,
        pending.verified_subject_hash,
        pending.anon_user_id,
        pending.authorize_params.client_id,
        { anonHasData: pending.anon_has_data, consent },
      );

      // 'continue' (conflict ack) and 'decline'/'adopt' all funnel through the resolver.
      // A conflict re-resolves deterministically to the existing SSO user → mint + redirect.
      if (result.status === "conflict") {
        const url = await handleResolved(pending.authorize_params, result.ssoUserId, generateAuthCode);
        await deletePending(nonce);
        res.redirect(url);
        return;
      }
      await resumeFromResolve(res, result, pending.authorize_params, nonce);
    } catch (err) {
      logger.error("SSO consent error:", err);
      res.status(500).json({ error: "server_error" });
    }
  });

  return router;
}
