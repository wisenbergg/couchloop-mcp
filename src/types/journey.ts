import { z } from 'zod';
import type { Session, Checkpoint } from '../db/schema.js';

export const JourneyStepTypeSchema = z.enum(['prompt', 'checkpoint', 'summary']);
export type JourneyStepType = z.infer<typeof JourneyStepTypeSchema>;

export const JourneyStepSchema = z.object({
  id: z.string(),
  order: z.number(),
  type: JourneyStepTypeSchema,
  content: z.object({
    prompt: z.string().optional(),
    checkpoint_key: z.string().optional(),
    instructions: z.string().optional(),
  }),
  optional: z.boolean(),
});

export type JourneyStep = z.infer<typeof JourneyStepSchema>;

export const JourneySchema = z.object({
  id: z.string().optional(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  steps: z.array(JourneyStepSchema),
  estimatedMinutes: z.number(),
  tags: z.array(z.string()),
});

export type Journey = z.infer<typeof JourneySchema>;

export const ListJourneysSchema = z.object({
  tag: z.string().optional().describe('Filter by tag (e.g., "reflection", "gratitude")'),
});

export type ListJourneysInput = z.infer<typeof ListJourneysSchema>;

export const GetJourneyStatusSchema = z.object({
  session_id: z.string().uuid().describe('Session ID to check'),
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