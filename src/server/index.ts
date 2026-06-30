// Load environment variables FIRST before any other imports
import { config } from "dotenv";
import fs from "fs";

import crypto from "crypto";
// Only load .env.local for local development — production & staging use platform env vars
if (!process.env.NODE_ENV || process.env.NODE_ENV === "development") {
  config({ path: ".env.local" });
}

import cookieParser from "cookie-parser";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import { initDatabase } from "../db/client.js";
import { sendMessage } from "../tools/sendMessage.js";
import { createSession } from "../tools/session.js";
import { logger } from "../utils/logger.js";
import { getServerCardMetadata } from "./http-mcp.js";
import { SERVER_VERSION } from "../server-identity.js";
import { optionalAuth, rateLimit, requireScope, validateToken } from "./middleware/auth.js";
import {
    enhancedCors,
    localNetworkAccessMiddleware,
} from "./middleware/localNetworkAccess.js";
import { oauthServer } from "./oauth/authServer.js";
import { cleanupSessions, handleSSE } from "./sse.js";
import { ssoRouter } from "./oauth/ssoRoutes.js";
import {
  buildPendingRow,
  createPending,
  deletePending,
  loadPending,
  newNonce,
  sweepExpiredPending,
} from "./oauth/pendingAuth.js";
import { resolveGrantedScope } from "./oauth/scopePolicy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Railway/edge proxies terminate TLS before forwarding to this app.
// Trust proxy headers so externally-visible URLs resolve to https.
app.set("trust proxy", true);

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        // OAuth consent form must redirect to client redirect URIs:
        // loopback (VS Code, Cursor, Claude Desktop) and any HTTPS host (ChatGPT, Claude.ai, vscode.dev).
        formAction: [
          "'self'",
          "http://127.0.0.1:*",
          "http://localhost:*",
          "https:",
        ],
        // Disabled because upgrade-insecure-requests would rewrite the
        // http://127.0.0.1 OAuth callback to https and break loopback delivery.
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false, // Allow embedding for MCP clients
    crossOriginResourcePolicy: { policy: "cross-origin" }, // MCP clients need cross-origin access
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());

// Use enhanced CORS with Local Network Access support
app.use(enhancedCors);
app.use(localNetworkAccessMiddleware);

// SSO (Supabase Auth) — optional upgrade, flag-gated. Off → no SSO routes, no sweep, no behavior change.
if (process.env.FF_SSO_SUPABASE === "true") {
  app.use(ssoRouter());
  const ssoSweep = setInterval(() => {
    sweepExpiredPending().catch((err) => {
      logger.error("[SSO] pending-auth sweep failed:", err);
    });
  }, 5 * 60 * 1000);
  ssoSweep.unref?.();
  logger.info("[SSO] FF_SSO_SUPABASE enabled — SSO routes mounted, pending-auth sweep scheduled");
}

/**
 * Allowed CORS origins for MCP endpoints.
 * Configurable via ALLOWED_ORIGINS env var (comma-separated).
 */
function getAllowedOrigins(): string[] {
  return process.env.ALLOWED_ORIGINS?.split(',') || [
    'https://chat.openai.com',
    'https://chatgpt.com',
    'https://claude.ai',
    'https://copilot.microsoft.com',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
  ];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderConsentFallback(params: {
  nonce: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}): string {
  const nonce = encodeURIComponent(params.nonce);
  const clientId = escapeHtml(params.clientId);
  const redirectUri = encodeURIComponent(params.redirectUri);
  const state = encodeURIComponent(params.state);
  const scope = encodeURIComponent(params.scope);
  const pkceParams = [
    params.codeChallenge
      ? `&code_challenge=${encodeURIComponent(params.codeChallenge)}`
      : "",
    params.codeChallengeMethod
      ? `&code_challenge_method=${encodeURIComponent(params.codeChallengeMethod)}`
      : "",
  ].join("");

  // Flag-gated SSO sign-in options. These carry the same authorize params to /oauth/sso/start.
  const ssoStart = (provider: string) =>
    `/oauth/sso/start?provider=${provider}&n=${nonce}&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=${scope}${pkceParams}`;
  const ssoBlock =
    process.env.FF_SSO_SUPABASE === "true"
      ? `<div class="sso">
        <p class="muted">Sign in to keep your work across devices:</p>
        <p class="muted">Signing in with a provider shares profile data according to that provider's policy.</p>
        <div class="actions">
          <a class="btn btn-secondary sso-link" href="${ssoStart("google")}">Sign in with Google</a>
          <a class="btn btn-secondary sso-link" href="${ssoStart("github")}">Sign in with GitHub</a>
        </div>
      </div>`
      : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CouchLoop Authorization</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; background: #f6f8fb; color: #0f172a; }
      .wrap { max-width: 640px; margin: 48px auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; }
      h1 { margin: 0 0 8px; font-size: 22px; }
      p { margin: 0 0 12px; line-height: 1.5; }
      code { background: #f1f5f9; padding: 2px 6px; border-radius: 6px; }
      .ack { margin-top: 16px; }
      .actions { margin-top: 20px; display: flex; gap: 12px; }
      .btn { appearance: none; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 14px; font-size: 14px; cursor: pointer; text-decoration: none; }
      .btn-primary { background: #0f172a; color: #fff; border-color: #0f172a; }
      .btn-secondary { background: #fff; color: #0f172a; }
      .muted { color: #64748b; font-size: 13px; }
    </style>
  </head>
  <body>
    <main class="wrap">
      <h1>Authorize CouchLoop Access</h1>
      <p>The client <code>${clientId}</code> is requesting access with scope <code>${escapeHtml(params.scope)}</code>.</p>
      <p class="muted">This fallback consent page is shown because the template asset was unavailable at runtime.</p>
      <form id="consent-form" method="POST" action="/oauth/authorize/consent">
        <input type="hidden" name="n" value="${escapeHtml(params.nonce)}" />
        <div class="ack">
          <label>
            <input id="agree-terms" type="checkbox" name="agreed" value="yes" />
            I agree to the Terms and Privacy Policy.
          </label>
        </div>
        <div class="actions">
          <button class="btn btn-secondary" type="submit" name="decision" value="deny">Cancel</button>
          <button class="btn btn-primary" id="approve-btn" type="submit" name="decision" value="approve" disabled>Authorize</button>
        </div>
      </form>
      ${ssoBlock}
    </main>
    <script>
      (function () {
        var checkbox = document.getElementById("agree-terms");
        var approveBtn = document.getElementById("approve-btn");
        var form = document.getElementById("consent-form");
        var ssoLinks = document.querySelectorAll(".sso-link");

        if (checkbox && approveBtn) {
          checkbox.addEventListener("change", function () {
            approveBtn.disabled = !checkbox.checked;
          });
        }

        if (form && checkbox) {
          form.addEventListener("submit", function (event) {
            var submitter = event.submitter;
            if (submitter && submitter.value === "approve" && !checkbox.checked) {
              event.preventDefault();
              window.alert("Please acknowledge the terms and privacy policy to continue.");
            }
          });
        }

        if (ssoLinks && checkbox) {
          ssoLinks.forEach(function (link) {
            link.addEventListener("click", function (event) {
              if (!checkbox.checked) {
                event.preventDefault();
                window.alert("Please acknowledge the terms and privacy policy to continue.");
                return;
              }
              var url = new URL(link.getAttribute("href"), window.location.origin);
              url.searchParams.set("agreed", "yes");
              link.setAttribute("href", url.pathname + url.search + url.hash);
            });
          });
        }
      })();
    </script>
  </body>
</html>`;
}

function buildOAuthMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    revocation_endpoint: `${baseUrl}/oauth/revoke`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    scopes_supported: ["read", "write", "crisis", "memory"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    code_challenge_methods_supported: ["S256", "plain"],
  };
}

function getExternalBaseUrl(req: Request): string {
  const forwardedProtoRaw = req.headers["x-forwarded-proto"];
  const forwardedHostRaw = req.headers["x-forwarded-host"];

  const forwardedProto =
    typeof forwardedProtoRaw === "string"
      ? forwardedProtoRaw.split(",")[0]?.trim().toLowerCase()
      : undefined;
  const forwardedHost =
    typeof forwardedHostRaw === "string"
      ? forwardedHostRaw.split(",")[0]?.trim()
      : undefined;

  const protocol =

    forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : req.protocol;
  const host = forwardedHost || req.get("host");

  return `${protocol}://${host}`;
}

const OAUTH_IDENTITY_COOKIE = "couchloop_eq_identity";

function getOrCreateBrowserSubject(req: Request, res: Response): string {
  const existing = req.cookies?.[OAUTH_IDENTITY_COOKIE];
  if (typeof existing === "string" && existing.length >= 24) {
    return existing;
  }

  const created = crypto.randomBytes(24).toString("hex");
  res.cookie(OAUTH_IDENTITY_COOKIE, created, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 365,
  });
  return created;
}

function buildRedirectErrorUrl(params: {
  redirectUri: string;
  state?: string;
  error: string;
  errorDescription: string;
}): string {
  const deniedUrl = new URL(params.redirectUri);
  deniedUrl.searchParams.set("error", params.error);
  deniedUrl.searchParams.set("error_description", params.errorDescription);
  if (params.state) {
    deniedUrl.searchParams.set("state", params.state);
  }
  return deniedUrl.toString();
}

function isAllowedDynamicRedirectUri(value: string): boolean {
  try {
    const parsed = new URL(value);

    if (parsed.protocol === "https:") {
      return true;
    }

    if (parsed.protocol === "http:") {
      return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    }

    return false;
  } catch {
    return false;
  }
}

function getAllowedCallbackReturnOrigins(baseUrl: string): string[] {
  const configured = process.env.OAUTH_CALLBACK_ALLOWED_ORIGINS?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return configured && configured.length > 0
    ? configured
    : [
        baseUrl,
        "https://chat.openai.com",
        "https://chatgpt.com",
        "https://copilot.microsoft.com",
        "https://claude.ai",
        "http://localhost:3000",
      ];
}

function buildCallbackReturnUrl(params: {
  returnTo: string;
  baseUrl: string;
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}): string | null {
  try {
    const returnUrl = new URL(params.returnTo);
    const allowedOrigins = getAllowedCallbackReturnOrigins(params.baseUrl);

    if (!allowedOrigins.includes(returnUrl.origin)) {
      logger.warn(`Blocked callback return redirect to origin: ${returnUrl.origin}`);
      return null;
    }

    if (params.code) {
      returnUrl.searchParams.set("code", params.code);
    }
    if (params.state) {
      returnUrl.searchParams.set("state", params.state);
    }
    if (params.error) {
      returnUrl.searchParams.set("error", params.error);
    }
    if (params.errorDescription) {
      returnUrl.searchParams.set("error_description", params.errorDescription);
    }

    return returnUrl.toString();
  } catch {
    logger.warn(`Invalid callback return redirect URL: ${params.returnTo}`);
    return null;
  }
}

function renderHostedCallbackPage(params: {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
  returnUrl?: string | null;
}): string {
  const hasError = Boolean(params.error);
  const title = hasError ? "Authorization Failed" : "Authorization Complete";
  const summary = hasError
    ? "The authorization request returned an error."
    : "Authorization succeeded. You can return to your app.";

  const codeValue = params.code ? escapeHtml(params.code) : "";
  const stateValue = params.state ? escapeHtml(params.state) : "";
  const errorValue = params.error ? escapeHtml(params.error) : "";
  const errorDescriptionValue = params.errorDescription
    ? escapeHtml(params.errorDescription)
    : "";
  const returnUrl = params.returnUrl ? escapeHtml(params.returnUrl) : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} | CouchLoop OAuth</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <style>
      :root {
        --primary: #6366f1;
        --primary-dark: #4f46e5;
        --secondary: #10b981;
        --background: #0f172a;
        --surface: #1e293b;
        --surface-light: #334155;
        --text: #f8fafc;
        --text-muted: #94a3b8;
        --border: #475569;
        --gradient: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--background);
        color: var(--text);
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        min-height: 100vh;
      }
      main {
        max-width: 760px;
        margin: 48px auto;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 28px;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 18px;
      }
      .brand-icon {
        width: 40px;
        height: 40px;
        border-radius: 10px;
        overflow: hidden;
      }
      .brand-icon img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      .brand-text {
        font-size: 22px;
        font-weight: 700;
      }
      .brand-text span {
        color: var(--primary);
      }
      h1 {
        margin: 0 0 10px;
        font-size: 28px;
        line-height: 1.2;
      }
      p { margin: 0 0 12px; line-height: 1.5; }
      .muted { color: var(--text-muted); }
      .meta {
        margin-top: 16px;
        padding: 14px;
        background: var(--surface-light);
        border-radius: 10px;
        border: 1px solid var(--border);
      }
      .meta dt { font-weight: 600; }
      .meta dd {
        margin: 0 0 8px;
        word-break: break-all;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
        font-size: 13px;
      }
      .actions { display: flex; gap: 10px; margin-top: 16px; }
      .btn {
        border: 1px solid var(--primary);
        border-radius: 8px;
        padding: 10px 14px;
        cursor: pointer;
        background: var(--gradient);
        color: #ffffff;
        text-decoration: none;
        font-size: 14px;
        font-weight: 600;
      }
      .btn-secondary {
        background: var(--surface-light);
        color: var(--text);
        border-color: var(--border);
      }
    </style>
  </head>
  <body>
    <main>
      <div class="brand">
        <div class="brand-icon"><img src="/logo.png" alt="CouchLoop EQ" /></div>
        <div class="brand-text">CouchLoop <span>EQ</span></div>
      </div>
      <h1>${title}</h1>
      <p>${summary}</p>
      <p class="muted" id="redirect-note"></p>
      <dl class="meta">
        ${codeValue ? `<dt>Code</dt><dd id="code-value">${codeValue}</dd>` : ""}
        ${stateValue ? `<dt>State</dt><dd>${stateValue}</dd>` : ""}
        ${errorValue ? `<dt>Error</dt><dd>${errorValue}</dd>` : ""}
        ${errorDescriptionValue ? `<dt>Error Description</dt><dd>${errorDescriptionValue}</dd>` : ""}
      </dl>
      <div class="actions">
        ${codeValue ? '<button class="btn" id="copy-code" type="button">Copy Code</button>' : ""}
        ${returnUrl ? `<a class="btn btn-secondary" href="${returnUrl}">Continue</a>` : ""}
      </div>
    </main>
    <script>
      (function () {
        var copyButton = document.getElementById("copy-code");
        var codeEl = document.getElementById("code-value");
        if (copyButton && codeEl) {
          copyButton.addEventListener("click", async function () {
            try {
              await navigator.clipboard.writeText(codeEl.textContent || "");
              copyButton.textContent = "Copied";
            } catch {
              copyButton.textContent = "Copy failed";
            }
          });
        }

        var returnUrl = ${JSON.stringify(params.returnUrl || "")};
        var note = document.getElementById("redirect-note");
        if (returnUrl && note) {
          note.textContent = "Redirecting back in 3 seconds...";
          window.setTimeout(function () {
            window.location.href = returnUrl;
          }, 3000);
        }
      })();
    </script>
  </body>
</html>`;
}

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "../../public")));

// ====================
// Landing Page & Legal
// ====================
app.get("/", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "../../public/index.html"));
});

app.get("/privacy", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "../../public/privacy.html"));
});

app.get("/terms", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "../../public/terms.html"));
});

app.get("/use-cases/dev", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "../../public/use-cases/dev.html"));
});

app.get("/use-cases/wellness", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "../../public/use-cases/wellness.html"));
});

// ====================
// OAuth Endpoints
// ====================

/**
 * GET /oauth/authorize
 * OAuth authorization endpoint - initiates the flow
 */
app.get(
  "/oauth/authorize",
  rateLimit(10, 60000),
  async (req: Request, res: Response) => {
    try {
      const {
        client_id,
        redirect_uri,
        response_type,
        scope,
        state,
        code_challenge,
        code_challenge_method,
      } =
        req.query;

      // Validate required parameters
      if (!client_id || !redirect_uri) {
        res.status(400).json({
          error: "invalid_request",
          error_description: "Missing required parameters",
        });
        return;
      }

      if (response_type !== "code") {
        res.status(400).json({
          error: "unsupported_response_type",
          error_description: "Only authorization code flow is supported",
        });
        return;
      }

      const normalizedChallengeMethod: "S256" | "plain" | undefined =
        code_challenge_method === "S256" || code_challenge_method === "plain"
          ? code_challenge_method
          : undefined;

      if (code_challenge && !normalizedChallengeMethod) {
        res.status(400).json({
          error: "invalid_request",
          error_description: "code_challenge_method must be S256 or plain when code_challenge is provided",
        });
        return;
      }

      if (normalizedChallengeMethod && !code_challenge) {
        res.status(400).json({
          error: "invalid_request",
          error_description: "code_challenge is required when code_challenge_method is provided",
        });
        return;
      }

      // Validate client and get registered redirect URIs
      const client = await oauthServer.validateClient(client_id as string);
      if (!client) {
        res.status(400).json({
          error: "invalid_client",
          error_description: "Unknown client",
        });
        return;
      }

      // Validate redirect URI against registered URIs (prevents open redirect attacks)
      if (!client.redirectUris.includes(redirect_uri as string)) {
        logger.warn(
          `Invalid redirect_uri attempted: ${redirect_uri} for client: ${client_id}`,
        );
        res.status(400).json({
          error: "invalid_request",
          error_description: "Invalid redirect_uri",
        });
        return;
      }

      const requestedScope =
        typeof scope === "string" ? scope : undefined;
      const scopeResolution = resolveGrantedScope(requestedScope, client.scopes);
      if (
        // Clamp to the client's allowed scopes (RFC 6749 §3.3) instead of rejecting
        // noisy/excess requests — MCP clients send varied scope strings. granted is
        // always ⊆ allowed, so this still prevents scope inflation. Only fail if
        // nothing at all is grantable.
        scopeResolution.granted.length === 0
      ) {
        res.status(400).json({
          error: "invalid_scope",
          error_description: "Requested scope is not allowed for this client",
        });
        return;
      }

      const pendingNonce = newNonce();
      const authorizeParams = {
        client_id: String(client_id),
        redirect_uri: String(redirect_uri),
        state: typeof state === "string" ? state : undefined,
        scope: scopeResolution.grantedScope,
        code_challenge:
          typeof code_challenge === "string" ? code_challenge : undefined,
        code_challenge_method: normalizedChallengeMethod,
      };

      await createPending(
        buildPendingRow(
          pendingNonce,
          authorizeParams,
          null,
          false,
          new Date(),
        ),
      );

      const consentUrl = new URL(`${getExternalBaseUrl(req)}/oauth/authorize/consent`);
      consentUrl.searchParams.set("n", pendingNonce);
      consentUrl.searchParams.set("client_id", String(client_id));
      res.redirect(consentUrl.toString());
      return;
    } catch (error) {
        logger.error("Authorization error:", error);
        res.status(500).json({
          error: "server_error",
          error_description: "Internal server error",
        });
    }
  },
);

  /**
   * GET /oauth/authorize/consent
   * Renders the consent page from a server-issued pending authorization nonce.
   */
  app.get(
    "/oauth/authorize/consent",
    rateLimit(20, 60000),
    async (req: Request, res: Response) => {
      try {
        const nonce = typeof req.query.n === "string" ? req.query.n : "";
        if (!nonce) {
          res.status(400).send("Missing consent nonce.");
          return;
        }

        const pending = await loadPending(nonce);
        if (!pending) {
          res.status(400).send("Authorization request expired, please try again.");
          return;
        }

        const consentParams = {
          nonce,
          clientId: pending.authorize_params.client_id,
          redirectUri: pending.authorize_params.redirect_uri,
          state: pending.authorize_params.state || "",
          scope: pending.authorize_params.scope || "read write",
          codeChallenge: pending.authorize_params.code_challenge,
          codeChallengeMethod: pending.authorize_params.code_challenge_method,
        };

        // When SSO is enabled, serve a dynamic, flag-aware page with social sign-in options.
        if (process.env.FF_SSO_SUPABASE === "true") {
          res.status(200).type("html").send(renderConsentFallback(consentParams));
          return;
        }

        // Default: serve the static consent page, fall back to inline HTML if the asset is missing.
        const consentPath = path.join(__dirname, "views", "consent.html");
        res.sendFile(consentPath, (err) => {
          if (!err || res.headersSent) {
            return;
          }

          logger.error("Failed to serve consent template, using fallback HTML", {
            consentPath,
            error: err.message,
          });

          res.status(200).type("html").send(renderConsentFallback(consentParams));
        });
        return;
      } catch (error) {
        logger.error("Consent page render error:", error);
        res.status(500).send("Failed to load consent page.");
      }
    },
  );

  /**
   * POST /oauth/authorize/consent
   * Handles approve/deny decisions from consent page with server-side validation.
   */
  app.post(
    "/oauth/authorize/consent",
    rateLimit(20, 60000),
    async (req: Request, res: Response) => {
      try {
        const {
          n,
          decision,
          agreed,
        } =
          req.body as Record<string, string | undefined>;

        if (!n) {
          res.status(400).json({
            error: "invalid_request",
            error_description: "Missing consent nonce",
          });
          return;
        }

        if (decision !== "approve" && decision !== "deny") {
          res.status(400).json({
            error: "invalid_request",
            error_description: "Invalid consent decision",
          });
          return;
        }

        const pending = await loadPending(n);
        if (!pending) {
          res.status(400).json({
            error: "invalid_request",
            error_description: "Authorization request expired",
          });
          return;
        }

        const authorizeParams = pending.authorize_params;
        const client = await oauthServer.validateClient(authorizeParams.client_id);
        if (!client) {
          await deletePending(n);
          res.status(400).json({
            error: "invalid_client",
            error_description: "Unknown client",
          });
          return;
        }

        if (!client.redirectUris.includes(authorizeParams.redirect_uri)) {
          await deletePending(n);
          logger.warn(
            `Invalid redirect_uri attempted in consent POST: ${authorizeParams.redirect_uri} for client: ${authorizeParams.client_id}`,
          );
          res.status(400).json({
            error: "invalid_request",
            error_description: "Invalid redirect_uri",
          });
          return;
        }

        const scopeResolution = resolveGrantedScope(authorizeParams.scope, client.scopes);
        if (
          // Clamp to allowed scopes (RFC 6749 §3.3); fail only if nothing is grantable.
          scopeResolution.granted.length === 0
        ) {
          await deletePending(n);
          res.status(400).json({
            error: "invalid_scope",
            error_description: "Requested scope is not allowed for this client",
          });
          return;
        }

        if (decision === "deny") {
          await deletePending(n);
          res.redirect(
            buildRedirectErrorUrl({
              redirectUri: authorizeParams.redirect_uri,
              state: authorizeParams.state,
              error: "access_denied",
              errorDescription: "User denied access",
            }),
          );
          return;
        }

        if (agreed !== "yes") {
          res.status(400).json({
            error: "invalid_request",
            error_description: "Terms acknowledgement is required",
          });
          return;
        }

        // Resolve a stable pseudonymous subject per browser to preserve continuity.
        const subject = getOrCreateBrowserSubject(req, res);
        const userId = await oauthServer.resolveOrCreateUserForSubject(
          authorizeParams.client_id,
          "browser-local",
          subject,
        );
        const code = await oauthServer.generateAuthCode(
          authorizeParams.client_id,
          userId,
          authorizeParams.redirect_uri,
          scopeResolution.grantedScope,
          authorizeParams.code_challenge,
          authorizeParams.code_challenge_method,
        );

        await deletePending(n);

        const redirectUrl = new URL(authorizeParams.redirect_uri);
        redirectUrl.searchParams.set("code", code);
        if (authorizeParams.state) {
          redirectUrl.searchParams.set("state", authorizeParams.state);
        }

        res.redirect(redirectUrl.toString());
        return;
    } catch (error) {
      logger.error("Consent submission error:", error);
      res.status(500).json({
        error: "server_error",
        error_description: "Internal server error",
      });
    }
  },
);

/**
 * POST /oauth/register
 * RFC 7591 Dynamic Client Registration.
 * MCP hosts (e.g. VS Code) call this automatically when the server
 * advertises registration_endpoint in OAuth server metadata.
 */
app.post(
  "/oauth/register",
  rateLimit(20, 60000),
  async (req: Request, res: Response) => {
    try {
      const body = req.body as {
        redirect_uris?: unknown;
        client_name?: unknown;
        grant_types?: unknown;
        scope?: unknown;
        token_endpoint_auth_method?: unknown;
      };

      // redirect_uris is required per RFC 7591
      if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
        res.status(400).json({
          error: "invalid_redirect_uri",
          error_description: "redirect_uris is required and must be a non-empty array",
        });
        return;
      }

      const redirectUris = body.redirect_uris.filter(
        (u): u is string => typeof u === "string",
      );

      if (redirectUris.length === 0) {
        res.status(400).json({
          error: "invalid_redirect_uri",
          error_description: "All provided redirect_uris must be strings",
        });
        return;
      }

      // Validate each URI
      for (const uri of redirectUris) {
        if (!isAllowedDynamicRedirectUri(uri)) {
          res.status(400).json({
            error: "invalid_redirect_uri",
            error_description: `Redirect URI not permitted: ${uri}. Only HTTPS URIs and localhost HTTP are allowed.`,
          });
          return;
        }
      }

      const grantTypes = Array.isArray(body.grant_types)
        ? body.grant_types.filter((g): g is string => typeof g === "string")
        : undefined;

      const rawScope = typeof body.scope === "string" ? body.scope : undefined;
      const scopes = rawScope ? rawScope.split(" ").filter(Boolean) : undefined;

      const result = await oauthServer.registerDynamicClient({
        clientName: typeof body.client_name === "string" ? body.client_name : undefined,
        redirectUris,
        grantTypes,
        scopes,
        tokenEndpointAuthMethod:
          body.token_endpoint_auth_method === "client_secret_post"
            ? "client_secret_post"
            : "none",
      });

      res.status(201).json(result);
    } catch (error) {
      logger.error("Dynamic client registration error:", error);
      res.status(500).json({
        error: "server_error",
        error_description: "Failed to register client",
      });
    }
  },
);

/**
 * GET /oauth/callback
 * Hosted callback endpoint for manual OAuth testing and user-friendly completion UI.
 */
app.get("/oauth/callback", (req: Request, res: Response) => {
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  const error = typeof req.query.error === "string" ? req.query.error : undefined;
  const errorDescription =
    typeof req.query.error_description === "string"
      ? req.query.error_description
      : undefined;
  const returnTo =
    typeof req.query.return_to === "string" ? req.query.return_to : undefined;

  const baseUrl = getExternalBaseUrl(req);
  const returnUrl = returnTo
    ? buildCallbackReturnUrl({
        returnTo,
        baseUrl,
        code,
        state,
        error,
        errorDescription,
      })
    : null;

  res
    .status(200)
    .type("html")
    .send(
      renderHostedCallbackPage({
        code,
        state,
        error,
        errorDescription,
        returnUrl,
      }),
    );
});

/**
 * POST /oauth/token
 * Exchange authorization code for access token
 */
app.post(
  "/oauth/token",
  rateLimit(5, 60000),
  async (req: Request, res: Response) => {
    try {
      const {
        grant_type,
        code,
        client_id,
        client_secret,
        code_verifier,
        redirect_uri,
        refresh_token,
      } = req.body;

      if (grant_type === "authorization_code") {
        if (!code || !client_id || !redirect_uri) {
          res.status(400).json({
            error: "invalid_request",
            error_description:
              "Missing required parameters. Provide code, client_id, redirect_uri, and either client_secret or code_verifier.",
          });
          return;
        }

        if (!client_secret && !code_verifier) {
          res.status(400).json({
            error: "invalid_request",
            error_description: "Either client_secret or code_verifier is required",
          });
          return;
        }

        const tokens = await oauthServer.exchangeCodeForToken(
          code,
          client_id,
          typeof client_secret === "string" ? client_secret : undefined,
          redirect_uri,
          typeof code_verifier === "string" ? code_verifier : undefined,
        );

        res.json(tokens);
      } else if (grant_type === "refresh_token") {
        if (!refresh_token) {
          res.status(400).json({
            error: "invalid_request",
            error_description: "Missing refresh token",
          });
          return;
        }

        const tokens = await oauthServer.refreshAccessToken(refresh_token);
        res.json(tokens);
      } else {
        res.status(400).json({
          error: "unsupported_grant_type",
          error_description:
            "Only authorization_code and refresh_token grants are supported",
        });
      }
    } catch (error: unknown) {
      logger.error("Token exchange error:", error);
      res.status(400).json({
        error: "invalid_grant",
        error_description:
          error instanceof Error ? error.message : "Failed to exchange token",
      });
    }
  },
);

/**
 * POST /oauth/revoke
 * Revoke an access token
 */
app.post(
  "/oauth/revoke",
  validateToken,
  rateLimit(10, 60000),
  async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.substring(7);

      if (token) {
        await oauthServer.revokeToken(token);
      }

      res.status(204).end();
    } catch (error) {
      logger.error("Token revocation error:", error);
      res.status(500).json({
        error: "server_error",
        error_description: "Failed to revoke token",
      });
    }
  },
);

// ====================
// Domain Verification (ChatGPT MCP Marketplace)
// ====================

/**
 * GET /.well-known/openai-apps-challenge
 * Domain verification for ChatGPT MCP marketplace
 */
app.get(
  "/.well-known/openai-apps-challenge",
  (_req: Request, res: Response) => {
    res.type("text/plain");
    res.send("xaHoU7I7S_z48vkwp_X6qzlpwyCLeE3nevmjAcRDfnY");
  },
);

// ====================
// SSE/MCP Endpoints for ChatGPT
// ====================

/**
 * OPTIONS /sse
 * CORS preflight for SSE endpoint
 */
app.options("/sse", (_req: Request, res: Response) => {
  const origin = _req.headers.origin;
  const allowed = getAllowedOrigins();
  if (origin && allowed.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Session-Id, X-Thread-Id",
  );
  res.sendStatus(200);
});

/**
 * GET/POST /sse
 * Streamable HTTP endpoint for ChatGPT MCP connection
 * Handles both SSE (GET) and HTTP messages (POST)
 */
app.get("/sse", optionalAuth, startupOAuthGate, rateLimit(100, 60000), handleSSE);
app.post(
  "/sse",
  optionalAuth,
  startupOAuthGate,
  rateLimit(100, 60000),
  express.json(),
  handleSSE,
);

/**
 * OPTIONS /mcp
 * CORS preflight for lenient MCP endpoint
 */
app.options("/mcp", (_req: Request, res: Response) => {
  const origin = _req.headers.origin;
  const allowed = getAllowedOrigins();
  if (origin && allowed.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Session-Id, X-Thread-Id, Accept",
  );
  res.sendStatus(200);
});

/**
 * Middleware to show MCP info page for browser requests
 */
function showMCPInfo(req: Request, res: Response, next: NextFunction) {
  const originalAccept = req.headers.accept || "";

  // For browser GET requests, return info page
  if (req.method === "GET" && originalAccept.includes("text/html")) {
    res.send(`
      <html>
        <head><title>CouchLoop MCP Server</title></head>
        <body style="font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
          <h1>✅ CouchLoop MCP Server is Running!</h1>
          <p>This endpoint is designed for ChatGPT Developer Mode.</p>
          <h2>Configuration for ChatGPT:</h2>
          <ul>
            <li><strong>MCP Server URL:</strong> <code>${getExternalBaseUrl(req)}/mcp</code></li>
            <li><strong>Identity:</strong> Bearer token or <code>X-Thread-Id</code> recommended for persistent isolated memory</li>
          </ul>
          <p style="color: #666; margin-top: 40px;">
            <small>Server Status: Active | Protocol: MCP 1.0 | Transport: Streamable HTTP</small>
          </p>
        </body>
      </html>
    `);
    return;
  }

  next();
}

function buildRuntimeOAuthConnectUrl(req: Request): string | null {
  const baseUrl = getExternalBaseUrl(req);
  const clientId =
    process.env.OAUTH_CONNECT_CLIENT_ID || process.env.OAUTH_CLIENT_ID || null;
  const redirectUri =
    process.env.OAUTH_CONNECT_REDIRECT_URI ||
    process.env.OAUTH_HOSTED_CALLBACK_URI ||
    `${baseUrl}/oauth/callback`;

  if (!clientId) {
    return null;
  }

  const url = new URL(`${baseUrl}/oauth/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "read write");
  url.searchParams.set("state", `mcp-startup-${Date.now()}`);
  return url.toString();
}

function startupOAuthGate(req: Request, res: Response, next: NextFunction): void {
  if (req.user) {
    next();
    return;
  }

  const isInitialize = req.body?.method === "initialize";

  // Only challenge initialize. Allow transport bootstrap requests through.
  if (!isInitialize) {
    next();
    return;
  }

  const oauthConnectUrl = buildRuntimeOAuthConnectUrl(req);
  if (!oauthConnectUrl) {
    next();
    return;
  }

  const baseUrl = getExternalBaseUrl(req);
  res.setHeader(
    "WWW-Authenticate",
    `Bearer realm="couchloop", authorization_uri="${oauthConnectUrl}", scope="read write"`,
  );
  res.setHeader(
    "Link",
    `<${baseUrl}/.well-known/oauth-authorization-server>; rel="oauth-authorization-server"`,
  );
  res.setHeader("Location", oauthConnectUrl);
  res.setHeader("MCP-OAuth-Authorization-URL", oauthConnectUrl);

  const acceptHeader = String(req.headers.accept || "");
  if (req.method === "GET" && acceptHeader.includes("text/html")) {
    res.redirect(302, oauthConnectUrl);
    return;
  }

  res.status(401).json({
    error: "oauth_required",
    message:
      "OAuth consent is required at MCP startup before requests can proceed.",
    oauth_connect_url: oauthConnectUrl,
    oauth_open_in_new_tab: true,
  });
}

/**
 * GET/POST /mcp
 * MCP endpoint for ChatGPT Developer Mode
 * Uses custom handler that directly implements MCP protocol
 */
app.get(
  "/mcp",
  showMCPInfo,
  optionalAuth,
  startupOAuthGate,
  rateLimit(100, 60000),
  handleSSE,
);
app.post("/mcp", optionalAuth, startupOAuthGate, rateLimit(100, 60000), handleSSE);

/**
 * GET /.well-known/mcp/server-card.json
 * Static MCP metadata fallback for scanners (e.g., Smithery) when
 * dynamic introspection fails due to auth/config requirements.
 */
app.get(
  "/.well-known/mcp/server-card.json",
  async (_req: Request, res: Response) => {
    try {
      const metadata = await getServerCardMetadata();
      res.json(metadata);
    } catch (error) {
      logger.error("Failed to generate server card metadata:", error);
      res.status(500).json({
        error: "server_error",
        message: "Failed to generate server card metadata",
      });
    }
  },
);

// ====================
// Protected MCP API Endpoints
// ====================

/**
 * POST /api/mcp/session
 * Create a new session
 */
app.post(
  "/api/mcp/session",
  validateToken,
  rateLimit(30, 60000),
  async (req: Request, res: Response) => {
    try {
      const result = await createSession({
        ...req.body,
        user_id: req.user?.userId, // Use authenticated user ID
      });

      res.json(result);
    } catch (error: unknown) {
      logger.error("Session creation error:", error);
      res.status(500).json({
        error: "server_error",
        message:
          error instanceof Error ? error.message : "Failed to create session",
      });
    }
  },
);

/**
 * POST /api/mcp/message
 * Send a message
 */
app.post(
  "/api/mcp/message",
  validateToken,
  requireScope("write"),
  rateLimit(60, 60000),
  async (req: Request, res: Response) => {
    try {
      const result = await sendMessage({
        ...req.body,
        user_id: req.user?.userId, // Use authenticated user ID
      });

      res.json(result);
    } catch (error: unknown) {
      logger.error("Message sending error:", error);
      res.status(500).json({
        error: "server_error",
        message:
          error instanceof Error ? error.message : "Failed to send message",
      });
    }
  },
);

// ====================
// Health & Metadata
// ====================

/**
 * GET /health
 * Health check endpoint
 */
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /.well-known/oauth-authorization-server
 * OAuth server metadata
 */
app.get(
  "/.well-known/oauth-authorization-server",
  (req: Request, res: Response) => {
    const baseUrl = getExternalBaseUrl(req);
    res.json(buildOAuthMetadata(baseUrl));
  },
);

/**
 * GET /.well-known/openid-configuration
 * Compatibility alias for clients expecting OIDC discovery path.
 */
app.get("/.well-known/openid-configuration", (req: Request, res: Response) => {
  const baseUrl = getExternalBaseUrl(req);
  res.json(buildOAuthMetadata(baseUrl));
});

/**
 * GET /.well-known/ai-plugin.json
 * ChatGPT plugin manifest
 */
app.get("/.well-known/ai-plugin.json", (req: Request, res: Response) => {
  const baseUrl = getExternalBaseUrl(req);

  res.json({
    schema_version: "v1",
    name_for_human: "CouchLoop",
    name_for_model: "couchloop",
    description_for_human:
      "Developer safety tools and guided self-reflection journeys for AI-assisted workflows",
    description_for_model:
      "CouchLoop EQ provides two capabilities. (1) Developer safety: verify AI-generated code before delivery, audit npm/PyPI/Maven packages for hallucinated or vulnerable dependencies, review code for security issues and anti-patterns, protect files with backup and rollback, and preserve project context across conversations. Use these tools when helping with code tasks. (2) Guided journeys: structured self-reflection check-in sessions with optional crisis detection and safety resources. Use journeys when a user explicitly requests a guided session or check-in.",
    auth: {
      type: "oauth",
      client_url: `${baseUrl}/oauth/authorize`,
      scope: "read write",
      authorization_url: `${baseUrl}/oauth/authorize`,
      authorization_content_type: "application/x-www-form-urlencoded",
      verification_tokens: {
        openai:
          process.env.OPENAI_VERIFICATION_TOKEN ||
          "REPLACE_WITH_VERIFICATION_TOKEN",
      },
    },
    api: {
      type: "openapi",
      url: `${baseUrl}/openapi.yaml`,
    },
    logo_url: `${baseUrl}/logo.png`,
    contact_email: "support@couchloop.com",
    legal_info_url: "https://mcp.couchloop.com/privacy",
  });
});

/**
 * GET /openapi.yaml
 * OpenAPI specification for ChatGPT
 */
app.get("/openapi.yaml", (req: Request, res: Response) => {
  const baseUrl = getExternalBaseUrl(req);

  const openApiSpec = `
openapi: 3.0.1
info:
  title: CouchLoop EQ API
  description: Developer safety tools and guided self-reflection journeys via Model Context Protocol
  version: ${SERVER_VERSION}
servers:
  - url: ${baseUrl}
paths:
  /api/mcp/session:
    post:
      operationId: createSession
      summary: Create a new session
      security:
        - bearer: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                journey_slug:
                  type: string
                  description: Optional journey to start (e.g. daily-reflection). Omit for a freeform session.
                context:
                  type: string
                  description: Optional initial context for the session
      responses:
        '200':
          description: Session created successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  session_id:
                    type: string
                  journey:
                    type: object
                    nullable: true
                  current_step:
                    type: object
                    nullable: true
                  message:
                    type: string
  /api/mcp/message:
    post:
      operationId: sendMessage
      summary: Send a message
      security:
        - bearer: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                session_id:
                  type: string
                  description: Session ID from createSession
                message:
                  type: string
                  description: User's message
                include_memory:
                  type: boolean
                  description: Include conversation memory context
              required:
                - session_id
                - message
      responses:
        '200':
          description: Message processed successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  success:
                    type: boolean
                  content:
                    type: string
                    description: AI response text
                  crisis_resources:
                    type: string
                    description: Publicly available crisis hotline information, included only when a safety concern is detected
                    nullable: true
                  timestamp:
                    type: string
                    format: date-time
components:
  securitySchemes:
    bearer:
      type: http
      scheme: bearer
      bearerFormat: JWT
`;

  res.type("text/yaml").send(openApiSpec);
});

// ====================
// Error Handling
// ====================

/**
 * Global error handler for request-level errors
 * Handles client disconnects, oversized payloads, malformed JSON
 */
app.use(
  (
    err: Error & { type?: string; status?: number },
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    // Client disconnected before request completed (Smithery proxy timeout, etc.)
    if (err.type === "request.aborted") {
      logger.debug("Client disconnected before request completed");
      return;
    }

    // Request body exceeds size limit
    if (err.type === "entity.too.large") {
      res.status(413).json({ error: "Request body too large" });
      return;
    }

    // Malformed JSON in request body
    if (err.type === "entity.parse.failed") {
      res.status(400).json({ error: "Malformed JSON in request body" });
      return;
    }

    next(err);
  },
);

// Start server
async function startServer() {
  try {
    // Initialize database
    await initDatabase();
    logger.info("Database initialized");

    // Initialize V2 orchestration (tool registry, feature flags, telemetry)
    const { initializeV2Orchestration } = await import("../core/init.js");
    await initializeV2Orchestration();
    logger.info("V2 orchestration initialized");

    app.listen(PORT, () => {
      const consentPath = path.join(__dirname, "views", "consent.html");
      const hasConsentTemplate = fs.existsSync(consentPath);

      logger.info(`OAuth server running on port ${PORT}`);
      logger.info(
        `Authorization endpoint: http://localhost:${PORT}/oauth/authorize`,
      );
      logger.info(`Token endpoint: http://localhost:${PORT}/oauth/token`);
      logger.info(
        `OAuth metadata endpoint: http://localhost:${PORT}/.well-known/oauth-authorization-server`,
      );
      logger.info(
        `OIDC metadata alias: http://localhost:${PORT}/.well-known/openid-configuration`,
      );
      logger.info(`API endpoints: http://localhost:${PORT}/api/mcp/*`);

      if (!hasConsentTemplate) {
        logger.warn(
          `Consent template missing at ${consentPath}; inline fallback renderer is active.`,
        );
      }
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Start the server
startServer();

// Graceful shutdown
process.on("SIGINT", async () => {
  logger.info("Received SIGINT, shutting down gracefully...");
  await cleanupSessions();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down gracefully...");
  await cleanupSessions();
  process.exit(0);
});

export default app;
