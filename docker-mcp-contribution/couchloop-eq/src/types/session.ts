import { z } from 'zod';
import { AuthContextSchema } from './auth.js';

export const SessionStatusSchema = z.enum(['active', 'paused', 'completed', 'abandoned']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const CreateSessionSchema = z.object({
  journey_slug: z.string().optional().describe('Optional journey to follow (e.g., "daily-reflection")'),
  context: z.string().optional().describe('Brief context for this session'),
  auth: AuthContextSchema.optional().describe('Authentication context for user identification'),
});

export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;

export const ResumeSessionSchema = z.object({
  session_id: z.string().uuid().optional().describe('Session ID to resume (omit to resume most recent)'),
  auth: AuthContextSchema.optional().describe('Authentication context for user identification'),
});

export type ResumeSessionInput = z.infer<typeof ResumeSessionSchema>;

export interface SessionResponse {
  session_id: string;
  journey: any | null;
  current_step: any | null;
  message: string;
}

export interface SessionWithDetails {
  session: any;
  journey: any | null;
  current_step: any | null;
  checkpoints: any[];
  message: string;
}