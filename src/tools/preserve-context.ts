import { PreserveContextSchema, PreserveContextResponse, type ContextCategoryType } from '../types/context.js';
import { getContextManager } from '../developer/managers/context-manager.js';
import { getSupabaseClient, throwOnError } from '../db/supabase-helpers.js';
import type { AuthContext } from '../types/auth.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

async function resolveThreadScope(auth?: AuthContext, sessionId?: string): Promise<string | null> {
  if (auth?.thread_id) {
    return auth.thread_id;
  }

  if (auth?.conversation_id) {
    return auth.conversation_id;
  }

  if (!sessionId) {
    return null;
  }

  const supabase = getSupabaseClient();
  const session = throwOnError(
    await supabase
      .from('sessions')
      .select('id, thread_id')
      .eq('id', sessionId)
      .maybeSingle()
  );

  if (!session) {
    return null;
  }

  if (session.thread_id) {
    return session.thread_id;
  }

  const generatedThreadId = uuidv4();
  throwOnError(
    await supabase
      .from('sessions')
      .update({ thread_id: generatedThreadId })
      .eq('id', sessionId)
  );

  return generatedThreadId;
}

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
export async function preserveContext(args: unknown): Promise<PreserveContextResponse> {
  try {
    // Validate input
    const input = PreserveContextSchema.parse(args);
    const contextManager = await getContextManager();
    const threadId = await resolveThreadScope(input.auth as AuthContext | undefined, input.session_id);

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

        if (!threadId) {
          return {
            success: false,
            action: 'store',
            message: 'Thread scope is required for store action',
          };
        }

        return await contextManager.storeEntry(input.category, input.content, threadId);
      }

      case 'retrieve': {
        if (!threadId) {
          return {
            success: false,
            action: 'retrieve',
            message: 'Thread scope is required for retrieve action',
          };
        }

        return await contextManager.retrieve(input.category, input.search_term, threadId);
      }

      case 'check': {
        if (!threadId) {
          return {
            success: false,
            action: 'check',
            message: 'Thread scope is required for check action',
          };
        }

        return await contextManager.check(input.include_metadata, threadId);
      }

      default: {
        return {
          success: false,
          action: input.action as PreserveContextResponse['action'],
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
export async function storeContext(
  category: string,
  content: string,
  options?: { auth?: AuthContext; sessionId?: string }
): Promise<void> {
  const contextManager = await getContextManager();
  const threadId = await resolveThreadScope(options?.auth, options?.sessionId);
  if (!threadId) {
    throw new Error('Thread scope is required to store context');
  }
  await contextManager.storeEntry(category as ContextCategoryType, content, threadId);
}

/**
 * Convenience function to retrieve context
 */
export async function retrieveContext(
  category?: string,
  searchTerm?: string,
  options?: { auth?: AuthContext; sessionId?: string }
): Promise<PreserveContextResponse['data']> {
  const contextManager = await getContextManager();
  const threadId = await resolveThreadScope(options?.auth, options?.sessionId);
  if (!threadId) {
    throw new Error('Thread scope is required to retrieve context');
  }
  const response = await contextManager.retrieve(category as ContextCategoryType | undefined, searchTerm, threadId);
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
export async function checkContextStatus(options?: { auth?: AuthContext; sessionId?: string }): Promise<PreserveContextResponse> {
  const contextManager = await getContextManager();
  const threadId = await resolveThreadScope(options?.auth, options?.sessionId);
  if (!threadId) {
    throw new Error('Thread scope is required to check context status');
  }
  return await contextManager.check(true, threadId);
}
