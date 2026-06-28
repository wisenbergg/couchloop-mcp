import { getSupabaseClient, throwOnError } from "../../db/supabase-helpers.js";
import { oauthServer } from "./authServer.js";
import { SSO_SENTINEL_CLIENT_ID, type IdentityStore } from "./ssoIdentity.js";

/** Supabase-backed IdentityStore. SSO links use the sentinel client_id so they are client-independent. */
export const supabaseIdentityStore: IdentityStore = {
  async findSsoLink(subjectHash) {
    const supabase = getSupabaseClient();
    const row = throwOnError(
      await supabase
        .from("oauth_subject_links")
        .select("user_id")
        .eq("client_id", SSO_SENTINEL_CLIENT_ID)
        .eq("issuer", "supabase")
        .eq("subject_hash", subjectHash)
        .maybeSingle(),
    ) as { user_id: string } | null;
    return row?.user_id ?? null;
  },

  getOrCreateUser(externalId) {
    return oauthServer.getOrCreateUser(externalId); // upserts users.external_id; idempotent
  },

  async insertSsoLinkIfAbsent(subjectHash, userId) {
    const supabase = getSupabaseClient();
    throwOnError(
      await supabase
        .from("oauth_subject_links")
        .upsert(
          {
            client_id: SSO_SENTINEL_CLIENT_ID,
            issuer: "supabase",
            subject_hash: subjectHash,
            user_id: userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "client_id,issuer,subject_hash", ignoreDuplicates: true },
        )
        .select("user_id"),
    );
    const winner = throwOnError(
      await supabase
        .from("oauth_subject_links")
        .select("user_id")
        .eq("client_id", SSO_SENTINEL_CLIENT_ID)
        .eq("issuer", "supabase")
        .eq("subject_hash", subjectHash)
        .single(),
    ) as { user_id: string };
    return winner.user_id;
  },

  async insertOrphanIfAbsent(anonUserId, ssoUserId, clientId) {
    const supabase = getSupabaseClient();
    throwOnError(
      await supabase
        .from("orphaned_identity_links")
        .upsert(
          { anon_user_id: anonUserId, sso_user_id: ssoUserId, client_id: clientId },
          { onConflict: "anon_user_id,sso_user_id", ignoreDuplicates: true },
        )
        .select("id"),
    );
  },
};
