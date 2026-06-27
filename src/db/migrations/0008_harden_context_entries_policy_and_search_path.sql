-- Security hardening: scope context_entries access policy to service_role only.
DROP POLICY IF EXISTS "Service role full access on context_entries"
  ON public.context_entries;

CREATE POLICY "Service role full access on context_entries"
  ON public.context_entries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Security hardening: pin search_path for stable function execution.
ALTER FUNCTION IF EXISTS public.increment_usage_count(uuid[])
  SET search_path = public;
