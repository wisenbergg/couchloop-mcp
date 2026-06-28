-- 0010: SSO identity support — resume context + conflict persistence.

CREATE TABLE IF NOT EXISTS public.pending_authorizations (
  nonce                 TEXT PRIMARY KEY,
  authorize_params      JSONB NOT NULL,
  anon_user_id          UUID REFERENCES public.users(id) ON DELETE SET NULL,
  anon_has_data         BOOLEAN NOT NULL DEFAULT false,
  verified_subject_hash TEXT,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS pending_authorizations_expires_at_idx
  ON public.pending_authorizations (expires_at);

CREATE TABLE IF NOT EXISTS public.orphaned_identity_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sso_user_id  UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_id    TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMP,
  UNIQUE (anon_user_id, sso_user_id)
);

-- RLS: service-role only (mirror 0007/0009).
ALTER TABLE public.pending_authorizations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orphaned_identity_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY pending_authorizations_service_role ON public.pending_authorizations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY orphaned_identity_links_service_role ON public.orphaned_identity_links
  FOR ALL TO service_role USING (true) WITH CHECK (true);
