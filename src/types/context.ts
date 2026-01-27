import { z } from 'zod';

export const ContextCategory = z.enum([
  'architecture',
  'requirements',
  'constraints',
  'decisions',
  'technical-patterns',
  'project-metadata',
]);

export type ContextCategoryType = z.infer<typeof ContextCategory>;

export const PreserveContextSchema = z.object({
  action: z.enum(['store', 'retrieve', 'check']).describe('Action to perform'),
  category: ContextCategory.optional().describe('Context category (e.g., "architecture", "requirements")'),
  content: z.string().optional().describe('Content to store'),
  search_term: z.string().optional().describe('Search term for retrieving context'),
  include_metadata: z.boolean().default(false).describe('Include usage metadata in response'),
});

export type PreserveContextInput = z.infer<typeof PreserveContextSchema>;

export interface ContextEntry {
  id: string;
  category: ContextCategoryType;
  content: string;
  timestamp: Date;
  usage_count: number;
  last_retrieved: Date | null;
}

export interface ContextMetadata {
  total_entries: number;
  entries_by_category: Record<ContextCategoryType, number>;
  total_stored_bytes: number;
  last_updated: Date;
  context_window_usage_percent: number;
}

export interface PreserveContextResponse {
  success: boolean;
  action: 'store' | 'retrieve' | 'check';
  message: string;
  data?: ContextEntry[] | ContextMetadata | null;
  warning?: string;
}
