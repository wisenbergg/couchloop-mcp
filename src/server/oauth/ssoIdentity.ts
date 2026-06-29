import nodeCrypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Reserved client_id for client-independent SSO links. Never minted as a real client. */
export const SSO_SENTINEL_CLIENT_ID = "__sso__";

/** True if a client_id collides with the reserved SSO sentinel. */
export function isReservedClientId(clientId: string): boolean {
  return clientId === SSO_SENTINEL_CLIENT_ID;
}

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

export interface IdentityStore {
  /** Returns the user_id for an existing SSO link, or null. */
  findSsoLink(subjectHash: string): Promise<string | null>;
  /** Idempotent get-or-create of a user keyed by external_id. */
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

/**
 * Map a verified Supabase subject (already hashed) to a durable internal user_id.
 * Governing rule: adopt only on a MISS; never sweep anonymous data without consent;
 * an existing SSO identity always wins; a conflicting anon is persisted, never destroyed.
 */
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
    // HIT: identity seen before (other device/client).
    if (hasAnon && candidateAnonUserId !== existing && opts.anonHasData) {
      await store.insertOrphanIfAbsent(candidateAnonUserId, existing, clientId);
      return { status: "conflict", anonUserId: candidateAnonUserId, ssoUserId: existing };
    }
    return { status: "resolved", userId: existing };
  }

  // MISS: first time this SSO identity is seen.
  if (hasAnon && opts.anonHasData && opts.consent === undefined) {
    return { status: "needs_merge_confirmation" };
  }

  let target: string;
  if (hasAnon && opts.anonHasData && opts.consent === "adopt") {
    target = candidateAnonUserId;
  } else if (hasAnon && !opts.anonHasData) {
    target = candidateAnonUserId;
  } else {
    // No anon, or consent === 'decline' → the deterministic canonical SSO user.
    target = await store.getOrCreateUser(`sso:${subjectHash}`);
  }

  // Atomic claim: a concurrent HIT created between findSsoLink and here collapses to the
  // existing row; if our consented adopt lost that race, record the orphan.
  const winner = await store.insertSsoLinkIfAbsent(subjectHash, target);
  if (winner !== target && hasAnon && opts.anonHasData) {
    await store.insertOrphanIfAbsent(candidateAnonUserId, winner, clientId);
  }
  return { status: "resolved", userId: winner };
}
