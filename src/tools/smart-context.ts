/**
 * MCP Tool: smart_context
 * 
 * Intelligent context management that bundles:
 * - Save checkpoint (progress capture)
 * - Save insight (meaningful realizations)
 * - Preserve context (project knowledge)
 * - Build context detection (understand project setup)
 * 
 * One call to capture everything important from a conversation.
 */

import { z } from 'zod';
import { saveCheckpoint } from './checkpoint.js';
import { saveInsight } from './insight.js';
import { storeContext } from './preserve-context.js';
import { handleDetectBuildContext } from './detect-build-context.js';
import { logger } from '../utils/logger.js';

const SmartContextInputSchema = z.object({
  // What to capture
  content: z.string().describe('The content to capture'),
  key: z.string().optional().describe('Key/label for the content'),
  
  // Context type - determines what gets saved where
  type: z.enum([
    'checkpoint',      // Progress in a journey
    'insight',         // User realization/learning
    'decision',        // Architectural decision
    'requirement',     // Project requirement
    'constraint',      // Technical constraint
    'pattern',         // Code pattern to remember
    'conversation',    // General conversation context
  ]).describe('Type of context being saved'),
  
  // Optional enrichment
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
  session_id: z.string().uuid().optional().describe('Session to associate with'),
  detect_project: z.boolean().default(false).describe('Also detect and store build context'),
  
  // Auth
  auth: z.any().optional(),
});

export const smartContextTool = {
  name: 'smart_context',
  description: 'Intelligently capture and preserve context from conversations. Automatically routes to the right storage: checkpoints for progress, insights for realizations, context for technical decisions. One tool to remember everything important.',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The content to capture',
      },
      key: {
        type: 'string',
        description: 'Key/label for the content',
      },
      type: {
        type: 'string',
        enum: ['checkpoint', 'insight', 'decision', 'requirement', 'constraint', 'pattern', 'conversation'],
        description: 'Type of context being saved',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for categorization',
      },
      session_id: {
        type: 'string',
        description: 'Session to associate with',
      },
      detect_project: {
        type: 'boolean',
        description: 'Also detect and store build context (default: false)',
      },
    },
    required: ['content', 'type'],
  },
};

export async function handleSmartContext(args: unknown) {
  try {
    const input = SmartContextInputSchema.parse(args);
    const key = input.key || input.type;
    
    logger.info(`Smart context capture: ${input.type}`);
    
    const results: {
      checkpoint?: unknown;
      insight?: unknown;
      context?: unknown;
      build_context?: unknown;
    } = {};

    // Route based on type
    switch (input.type) {
      case 'checkpoint':
        // Save as checkpoint
        results.checkpoint = await saveCheckpoint({
          key,
          value: { content: input.content, tags: input.tags },
          session_id: input.session_id,
          save_as_insight: false,
          preserve_context: false,
          auth: input.auth,
        });
        break;

      case 'insight':
        // Save as insight
        results.insight = await saveInsight({
          content: input.content,
          session_id: input.session_id,
          tags: input.tags || ['insight'],
          auth: input.auth,
        });
        break;

      case 'decision':
      case 'requirement':
      case 'constraint':
      case 'pattern': {
        // Map to context categories
        const categoryMap: Record<string, string> = {
          decision: 'decisions',
          requirement: 'requirements',
          constraint: 'constraints',
          pattern: 'technical-patterns',
        };
        const category = categoryMap[input.type] || 'decisions';
        
        await storeContext(category, `[${key}] ${input.content}`);
        results.context = { category, stored: true };
        
        // Also save as insight for searchability
        results.insight = await saveInsight({
          content: input.content,
          session_id: input.session_id,
          tags: [input.type, ...(input.tags || [])],
          auth: input.auth,
        });
        break;
      }

      case 'conversation':
        // Save to both checkpoint and context
        if (input.session_id) {
          results.checkpoint = await saveCheckpoint({
            key: key || 'conversation',
            value: { content: input.content, tags: input.tags },
            session_id: input.session_id,
            auth: input.auth,
          });
        }
        
        // Also preserve as context
        await storeContext('project-metadata', `[conversation] ${input.content}`);
        results.context = { category: 'project-metadata', stored: true };
        break;
    }

    // Optionally detect build context
    if (input.detect_project) {
      results.build_context = await handleDetectBuildContext({});
    }

    return {
      success: true,
      type: input.type,
      key,
      saved_to: Object.keys(results),
      results,
      message: `Context captured as ${input.type}`,
    };
  } catch (error) {
    logger.error('Error in smart_context:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
