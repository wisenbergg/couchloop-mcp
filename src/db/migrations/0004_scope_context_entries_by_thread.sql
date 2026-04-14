-- Scope preserved context to a thread boundary so entries cannot be shared
-- across unrelated MCP callers.

ALTER TABLE "context_entries"
  ADD COLUMN IF NOT EXISTS "thread_id" text;

CREATE INDEX IF NOT EXISTS "idx_context_entries_thread_id"
  ON "context_entries" ("thread_id");

CREATE INDEX IF NOT EXISTS "idx_context_entries_thread_category"
  ON "context_entries" ("thread_id", "category");