import { z } from 'zod';

export const SaveCheckpointSchema = z.object({
  session_id: z.string().uuid().describe('Active session ID'),
  key: z.string().describe('What is being captured (e.g., "mood", "reflection", "gratitude")'),
  value: z.any().describe('The captured content'),
  advance_step: z.boolean().default(true).describe('Whether to advance to next journey step'),
});

export type SaveCheckpointInput = z.infer<typeof SaveCheckpointSchema>;

export interface CheckpointResponse {
  checkpoint_id: string;
  next_step: any | null;
  journey_complete: boolean;
  message: string;
}