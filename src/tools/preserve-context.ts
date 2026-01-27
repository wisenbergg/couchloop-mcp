import { PreserveContextSchema, PreserveContextResponse } from '../types/context.js';
import { getContextManager } from '../developer/managers/context-manager.js';
import { logger } from '../utils/logger.js';

/**
 * MCP Tool: preserve_context
 *
 * Stores and retrieves important project context to prevent AI amnesia
 * when context windows fill up. Helps maintain architectural decisions,
 * requirements, constraints, and technical patterns across conversations.
 *
 * Actions:
 * - 'store': Save context to persistent storage
 * - 'retrieve': Get stored context by category or search term
 * - 'check': Check context window status and get usage metrics
 */
export async function preserveContext(args: any): Promise<PreserveContextResponse> {
  try {
    // Validate input
    const input = PreserveContextSchema.parse(args);
    const contextManager = await getContextManager();

    logger.info(`preserve_context action: ${input.action}`);

    switch (input.action) {
      case 'store': {
        if (!input.category) {
          return {
            success: false,
            action: 'store',
            message: 'Category is required for store action',
          };
        }

        if (!input.content) {
          return {
            success: false,
            action: 'store',
            message: 'Content is required for store action',
          };
        }

        return await contextManager.storeEntry(input.category, input.content);
      }

      case 'retrieve': {
        return await contextManager.retrieve(input.category, input.search_term);
      }

      case 'check': {
        return await contextManager.check(input.include_metadata);
      }

      default: {
        return {
          success: false,
          action: input.action as any,
          message: `Unknown action: ${input.action}`,
        };
      }
    }
  } catch (error) {
    logger.error('Error in preserve_context:', error);

    if (error instanceof Error && error.message.includes('validation')) {
      return {
        success: false,
        action: 'store',
        message: `Validation error: ${error.message}`,
      };
    }

    return {
      success: false,
      action: 'store',
      message: 'An error occurred while processing context',
    };
  }
}

/**
 * Convenience function to store context
 */
export async function storeContext(category: string, content: string): Promise<void> {
  const contextManager = await getContextManager();
  await contextManager.storeEntry(category as any, content);
}

/**
 * Convenience function to retrieve context
 */
export async function retrieveContext(category?: string, searchTerm?: string): Promise<any[]> {
  const contextManager = await getContextManager();
  const response = await contextManager.retrieve(category as any, searchTerm);
  // Ensure we always return an array
  const data = response.data;
  if (Array.isArray(data)) {
    return data;
  }
  return [];
}

/**
 * Convenience function to check context status
 */
export async function checkContextStatus(): Promise<any> {
  const contextManager = await getContextManager();
  return await contextManager.check(true);
}
