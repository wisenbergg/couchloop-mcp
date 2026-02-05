import { z } from 'zod';
import { AuthContextSchema } from './auth.js';

export const SaveCheckpointSchema = z.object({
  session_id: z.string().uuid().optional().describe('Active session ID (auto-created if not provided)'),
  key: z.string().describe('What is being captured (e.g., "mood", "reflection", "gratitude")'),
  value: z.any().describe('The captured content'),
  advance_step: z.boolean().default(true).describe('Whether to advance to next journey step'),
  auth: AuthContextSchema.optional().describe('Authentication context for user identification'),
});

export type SaveCheckpointInput = z.infer<typeof SaveCheckpointSchema>;

export interface CheckpointResponse {
  checkpoint_id: string;
  session_id: string;
  session_created: boolean;
  next_step: any | null;
  journey_complete: boolean;
  message: string;
}