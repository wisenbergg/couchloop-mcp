-- Add execution_mode to journeys.
--
-- Developer journeys (daily-standup, sprint-retro, debug-postmortem) run
-- locally on the client against the real codebase and must NOT be routed
-- through the therapeutic shrink-chat backend. Wellness journeys keep the
-- default 'backend' routing. Defaults to 'backend' so existing rows are
-- unaffected.

ALTER TABLE journeys
  ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'backend'
  CHECK (execution_mode IN ('local', 'backend'));
