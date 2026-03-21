-- Migration: Add increment_usage_count RPC function
-- Used by ContextManager.retrieve() to atomically increment usage_count
-- for multiple rows without race conditions.

CREATE OR REPLACE FUNCTION increment_usage_count(row_ids uuid[])
RETURNS void AS $$
BEGIN
  UPDATE context_entries
  SET usage_count = usage_count + 1,
      last_accessed = now()
  WHERE id = ANY(row_ids);
END;
$$ LANGUAGE plpgsql;
