-- Migration: Add shrink-chat thread mapping to sessions
-- Date: 2026-01-08

-- Add threadId column to sessions table
ALTER TABLE sessions
ADD COLUMN thread_id TEXT,
ADD COLUMN last_synced_at TIMESTAMP;

-- Create index for efficient lookups
CREATE INDEX idx_sessions_thread_id ON sessions(thread_id);

-- Create thread_mappings table for redundancy and audit trail
CREATE TABLE IF NOT EXISTS thread_mappings (
  id TEXT PRIMARY KEY DEFAULT ('tm_' || nanoid()),
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('mcp', 'shrink-chat')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB
);

-- Create indexes for thread_mappings
CREATE INDEX idx_thread_mappings_session_id ON thread_mappings(session_id);
CREATE INDEX idx_thread_mappings_thread_id ON thread_mappings(thread_id);
CREATE INDEX idx_thread_mappings_created_at ON thread_mappings(created_at);

-- Create crisis_events table for tracking crisis detections
CREATE TABLE IF NOT EXISTS crisis_events (
  id TEXT PRIMARY KEY DEFAULT ('ce_' || nanoid()),
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  thread_id TEXT,
  crisis_level NUMERIC NOT NULL CHECK (crisis_level >= 0 AND crisis_level <= 10),
  response TEXT,
  resources JSONB,
  escalation_path TEXT,
  handled BOOLEAN DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for crisis_events
CREATE INDEX idx_crisis_events_session_id ON crisis_events(session_id);
CREATE INDEX idx_crisis_events_crisis_level ON crisis_events(crisis_level);
CREATE INDEX idx_crisis_events_created_at ON crisis_events(created_at);

-- Add comment for documentation
COMMENT ON COLUMN sessions.thread_id IS 'Shrink-chat thread ID for therapeutic conversation management';
COMMENT ON COLUMN sessions.last_synced_at IS 'Last time session was synchronized with shrink-chat';
COMMENT ON TABLE thread_mappings IS 'Audit trail for MCP session to shrink-chat thread mappings';
COMMENT ON TABLE crisis_events IS 'Log of crisis detection events from shrink-chat integration';