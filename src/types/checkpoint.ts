import { z } from 'zod';
import { AuthContextSchema } from './auth.js';

// Context categories for preserve_context integration
const ContextCategoryEnum = z.enum([
  'architecture',
  'requirements', 
  'constraints',
  'decisions',
  'technical-patterns',
  'project-metadata'
]);

export const SaveCheckpointSchema = z.object({
  session_id: z.string().uuid().optional().describe('Active session ID (auto-created if not provided)'),
  key: z.string().describe('What is being captured (e.g., "mood", "reflection", "gratitude")'),
  value: z.any().describe('The captured content'),
  advance_step: z.boolean().default(true).describe('Whether to advance to next journey step'),
  auth: AuthContextSchema.optional().describe('Authentication context for user identification'),
  
  // === Consolidated from save_insight ===
  save_as_insight: z.boolean().default(false).describe('Also save this as a user insight'),
  insight_tags: z.array(z.string()).optional().describe('Tags for the insight if saving as insight'),
  
  // === Consolidated from preserve_context ===
  preserve_context: z.boolean().default(false).describe('Also store as persistent project context'),
  context_category: ContextCategoryEnum.optional().describe('Category for context preservation'),
  
  // === Governance metadata ===
  governance_check: z.boolean().default(true).describe('Run governance validation on the value'),
});

export type SaveCheckpointInput = z.infer<typeof SaveCheckpointSchema>;
export type ContextCategory = z.infer<typeof ContextCategoryEnum>;

export interface CheckpointResponse {
  checkpoint_id: string;
  session_id: string;
  session_created: boolean;
  next_step: unknown | null;
  journey_complete: boolean;
  message: string;
  // Extended response fields
  insight_id?: string;
  context_stored?: boolean;
  governance_result?: {
    allowed: boolean;
    issues: string[];
    confidence: number;
  };
}