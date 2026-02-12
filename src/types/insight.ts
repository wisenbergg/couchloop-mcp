import { z } from 'zod';
import { AuthContextSchema } from './auth.js';
import type { User, Insight, Session } from '../db/schema.js';

export const SaveInsightSchema = z.object({
  content: z.string().describe('The insight to save'),
  session_id: z.string().uuid().optional().describe('Optional session to link this insight to'),
  tags: z.array(z.string()).optional().default([]).describe('Optional tags for categorization'),
  auth: AuthContextSchema.optional().describe('Authentication context for user identification'),
});

export type SaveInsightInput = z.infer<typeof SaveInsightSchema>;

export const GetUserContextSchema = z.object({
  include_recent_insights: z.boolean().default(true).describe('Include recent insights'),
  include_session_history: z.boolean().default(true).describe('Include recent session summaries'),
  auth: AuthContextSchema.optional().describe('Authentication context for user identification'),
});

export type GetUserContextInput = z.infer<typeof GetUserContextSchema>;

export interface InsightResponse {
  insight_id: string;
  message: string;
}

export interface UserContextResponse {
  user: User;
  recent_insights: Insight[];
  recent_sessions: Session[];
  active_session: Session | null;
}