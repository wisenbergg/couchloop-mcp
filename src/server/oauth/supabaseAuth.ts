import { createServerClient } from "@supabase/ssr";
import type { Request, Response } from "express";

/** Per-request Supabase client wired to the Express cookie jar (for PKCE verifier storage). */
function client(req: Request, res: Response) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required for SSO");
  }
  return createServerClient(url, anon, {
    cookies: {
      getAll: () =>
        Object.entries(req.cookies ?? {}).map(([name, value]) => ({ name, value: String(value) })),
      setAll: (cookies) => {
        // @supabase/ssr may flush these cookies on a deferred microtask, after
        // the route has already redirected/responded. Writing a cookie then
        // throws ERR_HTTP_HEADERS_SENT from a promise, which escapes the route
        // try/catch and crashes the process (502 + restart). The one-shot code
        // exchange already returns the user id, so skipping a late cookie write
        // is safe.
        if (res.headersSent) return;
        cookies.forEach(({ name, value, options }) => res.cookie(name, value, options));
      },
    },
  });
}

/** Build the provider sign-in URL; the SDK stores the PKCE verifier in the cookie jar. */
export async function providerSignInUrl(
  req: Request,
  res: Response,
  provider: "google" | "github",
  redirectTo: string,
): Promise<string> {
  const { data, error } = await client(req, res).auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data?.url) throw error ?? new Error("Failed to build provider URL");
  return data.url;
}

/** Trigger a magic-link email (token_hash flow; no PKCE verifier needed). */
export async function sendMagicLink(
  req: Request,
  res: Response,
  email: string,
  redirectTo: string,
): Promise<void> {
  const { error } = await client(req, res).auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw error;
}

/** OAuth-provider callback: exchange ?code= for a session (same-browser; uses PKCE verifier cookie). */
export async function exchangeCode(req: Request, res: Response, code: string): Promise<string> {
  const { data, error } = await client(req, res).auth.exchangeCodeForSession(code);
  if (error || !data?.user) throw error ?? new Error("Code exchange failed");
  return data.user.id;
}

/** Magic-link callback: verify token_hash. `type` comes from the callback query (signup/email/magiclink). */
export async function verifyMagicLink(
  req: Request,
  res: Response,
  tokenHash: string,
  type: "magiclink" | "signup" | "email" | "recovery",
): Promise<string> {
  const { data, error } = await client(req, res).auth.verifyOtp({ token_hash: tokenHash, type });
  if (error || !data?.user) throw error ?? new Error("OTP verification failed");
  return data.user.id;
}
