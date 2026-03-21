-- Migration: Add context_entries table
-- Replaces filesystem-based ContextManager (context-store.json) with DB-backed storage.
-- Enables persistent context in containerized deployments (Railway, Docker) where
-- the application filesystem is read-only at runtime.

CREATE TABLE IF NOT EXISTS "context_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "category" varchar(50) NOT NULL,
  "content" text NOT NULL,
  "tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "usage_count" integer DEFAULT 0 NOT NULL,
  "last_accessed" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_context_entries_category" ON "context_entries" ("category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_context_entries_created_at" ON "context_entries" ("created_at");
