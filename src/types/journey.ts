import { z } from 'zod';
import type { Session, Checkpoint } from '../db/schema.js';
import { AuthContextSchema } from './auth.js';

export const JourneyStepTypeSchema = z.enum(['prompt', 'checkpoint', 'summary', 'data']);
export type JourneyStepType = z.infer<typeof JourneyStepTypeSchema>;

/**
 * Vetted, named signals a `data` step can ask the client to gather from the
 * real-time codebase. These are declarative intents — NOT shell commands. The
 * client (the local agent) maps each source to its own audited command, so an
 * untrusted journey row can never inject a command to execute.
 */
export const JourneyDataSourceSchema = z.enum([
  'git_commits',     // commits in a window (default: since last session)
  'git_status',      // working tree: staged / unstaged / untracked
  'git_diff_stat',   // diffstat vs a base ref
  'changed_files',   // files touched in the window / on the branch
  'recent_reverts',  // revert commits in the window
  'open_prs',        // open PRs (optionally authored by / assigned to the user)
  'pr_review_state', // PRs blocked on review / changes requested
  'ci_status',       // latest CI run conclusions
  'failing_tests',   // failing test names / output
  'todo_comments',   // TODO / FIXME added in the diff
]);
export type JourneyDataSource = z.infer<typeof JourneyDataSourceSchema>;

export const JourneyStepContentSchema = z.object({
  prompt: z.string().optional(),
  checkpoint_key: z.string().optional(),
  instructions: z.string().optional(),
  // `data` step fields — the client gathers these locally from the codebase.
  source: JourneyDataSourceSchema.optional(),
  params: z.record(z.unknown()).optional(),
});

export const JourneyStepSchema = z.object({
  id: z.string(),
  order: z.number(),
  type: JourneyStepTypeSchema,
  content: JourneyStepContentSchema,
  optional: z.boolean(),
}).refine(
  (step) => step.type !== 'data' || !!step.content.source,
  { message: 'a "data" step must declare content.source', path: ['content', 'source'] },
);

export type JourneyStep = z.infer<typeof JourneyStepSchema>;

/**
 * Where a journey is driven:
 * - 'backend': routed through the shrink-chat therapeutic engine (crisis
 *   detection, tone governance). Used by wellness journeys.
 * - 'local': driven entirely by the local agent against the real codebase.
 *   Never routed through the therapeutic pipeline. Used by developer journeys.
 */
export const JourneyExecutionModeSchema = z.enum(['local', 'backend']);
export type JourneyExecutionMode = z.infer<typeof JourneyExecutionModeSchema>;

export const JourneySchema = z.object({
  id: z.string().optional(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  steps: z.array(JourneyStepSchema),
  estimatedMinutes: z.number(),
  tags: z.array(z.string()),
  executionMode: JourneyExecutionModeSchema.default('backend'),
});

export type Journey = z.infer<typeof JourneySchema>;

export const ListJourneysSchema = z.object({
  tag: z.string().optional().describe('Filter by tag (e.g., "reflection", "gratitude")'),
});

export type ListJourneysInput = z.infer<typeof ListJourneysSchema>;

export const GetJourneyStatusSchema = z.object({
  session_id: z.string().uuid().describe('Session ID to check'),
  auth: AuthContextSchema.optional().describe('Authentication context'),
});

export type GetJourneyStatusInput = z.infer<typeof GetJourneyStatusSchema>;

export interface JourneyStatusResponse {
  session: Session;
  journey: Journey | null;
  progress: {
    current_step: number;
    total_steps: number;
    percent_complete: number;
  };
  checkpoints: Checkpoint[];
  time_elapsed_minutes: number;
}