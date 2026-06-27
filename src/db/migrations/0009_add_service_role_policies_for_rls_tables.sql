-- Security hardening: add explicit service_role-only policies on RLS-enabled tables
-- so access intent is explicit and Supabase security lints stay clean.
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'authorization_codes',
    'checkpoints',
    'crisis_events',
    'governance_audit_log',
    'governance_evaluations',
    'governance_rules',
    'insights',
    'journeys',
    'oauth_clients',
    'oauth_subject_links',
    'oauth_tokens',
    'sessions',
    'thread_mappings',
    'users'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      'Service role full access on ' || t,
      t
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      'Service role full access on ' || t,
      t
    );
  END LOOP;
END
$$;
