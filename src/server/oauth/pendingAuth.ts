import nodeCrypto from "crypto";
import { getSupabaseClient, throwOnError } from "../../db/supabase-helpers.js";

export interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  state?: string;
  scope?: string;
  code_challenge?: string;
  code_challenge_method?: "S256" | "plain";
}

export interface PendingRow {
  nonce: string;
  authorize_params: AuthorizeParams;
  anon_user_id: string | null;
  anon_has_data: boolean;
  expires_at: string;
}

export type LoadedPendingRow = PendingRow & { verified_subject_hash: string | null };

const TTL_MS = 10 * 60 * 1000;

export function newNonce(): string {
  return nodeCrypto.randomBytes(32).toString("hex");
}

export function buildPendingRow(
  nonce: string,
  params: AuthorizeParams,
  anonUserId: string | null,
  anonHasData: boolean,
  now: Date,
): PendingRow {
  return {
    nonce,
    authorize_params: params,
    anon_user_id: anonUserId,
    anon_has_data: anonHasData,
    expires_at: new Date(now.getTime() + TTL_MS).toISOString(),
  };
}

export async function createPending(row: PendingRow): Promise<void> {
  throwOnError(await getSupabaseClient().from("pending_authorizations").insert(row).select("nonce"));
}

/** Loads a non-expired pending record. Deletes + returns null if expired. */
export async function loadPending(nonce: string): Promise<LoadedPendingRow | null> {
  const supabase = getSupabaseClient();
  const row = throwOnError(
    await supabase.from("pending_authorizations").select("*").eq("nonce", nonce).maybeSingle(),
  ) as (LoadedPendingRow & { expires_at: string }) | null;
  if (!row) return null;
  if (new Date() > new Date(row.expires_at)) {
    await deletePending(nonce);
    return null;
  }
  return row;
}

export async function markVerified(nonce: string, subjectHash: string): Promise<void> {
  throwOnError(
    await getSupabaseClient()
      .from("pending_authorizations")
      .update({ verified_subject_hash: subjectHash })
      .eq("nonce", nonce),
  );
}

export async function deletePending(nonce: string): Promise<void> {
  throwOnError(await getSupabaseClient().from("pending_authorizations").delete().eq("nonce", nonce));
}

export async function sweepExpiredPending(): Promise<void> {
  throwOnError(
    await getSupabaseClient()
      .from("pending_authorizations")
      .delete()
      .lt("expires_at", new Date().toISOString()),
  );
}
