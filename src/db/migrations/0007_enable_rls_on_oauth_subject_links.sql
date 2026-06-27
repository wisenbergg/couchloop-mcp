-- Security hardening: prevent public API roles from unrestricted access
-- to OAuth subject link mappings.
ALTER TABLE IF EXISTS public.oauth_subject_links
  ENABLE ROW LEVEL SECURITY;
