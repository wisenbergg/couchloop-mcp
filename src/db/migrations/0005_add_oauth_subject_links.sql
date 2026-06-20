-- Phase 2: Stable OAuth subject mapping for cross-session continuity

CREATE TABLE IF NOT EXISTS public.oauth_subject_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS oauth_subject_links_subject_unique
  ON public.oauth_subject_links (client_id, issuer, subject_hash);

CREATE INDEX IF NOT EXISTS oauth_subject_links_user_id_idx
  ON public.oauth_subject_links (user_id);
