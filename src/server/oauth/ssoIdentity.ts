import nodeCrypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Reserved client_id for client-independent SSO links. Never minted as a real client. */
export const SSO_SENTINEL_CLIENT_ID = "__sso__";

/**
 * User-scoped "work" tables (both keyed by user_id). checkpoints/context_entries are
 * session-/thread-scoped and have no user_id, so a user with any of those also has a
 * session row — sessions + insights is sufficient and the only user_id-keyed evidence.
 */
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
