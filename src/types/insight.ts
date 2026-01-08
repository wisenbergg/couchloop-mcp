import { z } from 'zod';

export const SaveInsightSchema = z.object({
  content: z.string().describe('The insight to save'),
  session_id: z.string().uuid().optional().describe('Optional session to link this insight to'),
  tags: z.array(z.string()).optional().default([]).describe('Optional tags for categorization'),
});

export type SaveInsightInput = z.infer<typeof SaveInsightSchema>;

export const GetUserContextSchema = z.object({
  include_recent_insights: z.boolean().default(true).describe('Include recent insights'),
  include_session_history: z.boolean().default(true).describe('Include recent session summaries'),
});

export type GetUserContextInput = z.infer<typeof GetUserContextSchema>;

export interface InsightResponse {
  insight_id: string;
  message: string;
}

export interface UserContextResponse {
  user: any;
  recent_insights: any[];
  recent_sessions: any[];
  active_session: any | null;
}