import nodeCrypto from "crypto";

/** Reserved client_id for client-independent SSO links. Never minted as a real client. */
export const SSO_SENTINEL_CLIENT_ID = "__sso__";

function subjectHashKey(): Buffer {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is required to derive SUBJECT_HASH_KEY");
  }
  // HKDF(JWT_SECRET) with a fixed info label — no new env var, no hardcoded secret.
  return Buffer.from(
    nodeCrypto.hkdfSync(
      "sha256",
      Buffer.from(jwtSecret),
      Buffer.alloc(0),
      Buffer.from("oauth-subject-hash"),
      32,
    ),
  );
}

/** HMAC-SHA256 of 'supabase:<id>' with the derived key, lowercase hex. Hides the raw Supabase id. */
export function subjectHashFor(supabaseUserId: string): string {
  return nodeCrypto
    .createHmac("sha256", subjectHashKey())
    .update(`supabase:${supabaseUserId}`)
    .digest("hex");
}
