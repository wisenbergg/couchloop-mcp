import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { getShrinkChatClient } from '../clients/shrinkChatClient.js';
import { sessions, checkpoints, journeys } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js';
import { errorHandler, ErrorType } from '../utils/errorHandler.js';
import { v4 as uuidv4 } from 'uuid';
import type { ShrinkResponse } from '../clients/shrinkChatClient.js';

// Input validation schema
const SendMessageSchema = z.object({
  session_id: z.string().uuid({
    message: 'Invalid session ID format',
  }),
  message: z.string().min(1, 'Message cannot be empty'),
  save_checkpoint: z.boolean().default(false),
  checkpoint_key: z.string().optional(),
  advance_step: z.boolean().default(false),
  include_memory: z.boolean().default(true),
  system_prompt: z.string().optional(),
  conversation_type: z.string().optional(),
});

// type SendMessageInput = z.infer<typeof SendMessageSchema>; // Removed - unused type

/**
 * Send a message through the shrink-chat therapeutic stack
 * This is the primary integration point with the shrink-chat backend
 */
export async function sendMessage(args: unknown) {
  let threadId: string | undefined; // Declare at function level for error handler access

  try {
    // Validate input
    const input = SendMessageSchema.parse(args);
    logger.info(`Sending message for session ${input.session_id}`);

    const db = getDb();
    const client = getShrinkChatClient();

    // 1. Get session and verify it exists
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, input.session_id))
      .limit(1);

    if (!session) {
      throw new NotFoundError(`Session ${input.session_id} not found`);
    }

    // 2. Get or generate thread ID
    // Threads in shrink-chat are created lazily on first message
    threadId = session.threadId || undefined;

    if (!threadId) {
      // Generate a new thread ID for this session
      threadId = uuidv4();
      logger.info(`Generated new thread ID ${threadId} for session ${input.session_id}`);

      // Update session with thread ID
      await db.update(sessions)
        .set({ threadId })
        .where(eq(sessions.id, input.session_id));
    }

    // Get journey if exists
    let journey = null;
    if (session.journeyId) {
      const [journeyRecord] = await db
        .select()
        .from(journeys)
        .where(eq(journeys.id, session.journeyId))
        .limit(1);
      journey = journeyRecord;
    }

    // 3. Prepare context for shrink-chat
    const memoryContext = input.include_memory && session.metadata
      ? JSON.stringify(session.metadata)
      : '';

    const enhancedContext = {
      sessionId: session.id,
      journeyId: session.journeyId,
      journeySlug: journey?.slug,
      currentStep: session.currentStep,
      sessionStatus: session.status,
    };

    // 4. Get conversation history if available
    const recentCheckpoints = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.sessionId, session.id))
      .orderBy(desc(checkpoints.createdAt))
      .limit(5);

    const history = recentCheckpoints
      .reverse()
      .filter(cp => cp.value && typeof cp.value === 'object' && 'message' in cp.value && 'response' in cp.value)
      .flatMap(cp => {
        const val = cp.value as any;
        return [
          { role: 'user', content: val.message },
          { role: 'assistant', content: val.response },
        ];
      })
      .slice(-10); // Last 10 messages (5 exchanges)

    // 5. Send message through shrink-chat
    const response = await client.sendMessage(
      input.message, // This is 'prompt' in the API
      threadId,
      {
        memoryContext,
        enhancedContext,
        history,
        systemPrompt: input.system_prompt,
        conversationType: input.conversation_type,
        idempotencyKey: uuidv4(),
      }
    );

    // 6. Handle crisis detection if present
    let crisisHandled = false;
    if (response.crisisLevel && Number(response.crisisLevel) > 7) {
      logger.warn(`Crisis detected: Level ${response.crisisLevel} for session ${session.id}`);
      crisisHandled = await handleCrisisDetection(session.id, threadId, response);
    }

    // 7. Save checkpoint if requested
    if (input.save_checkpoint) {
      const checkpointKey = input.checkpoint_key || 'message_response';

      await db.insert(checkpoints).values({
        sessionId: session.id,
        stepId: session.currentStep.toString(),
        key: checkpointKey,
        value: {
          message: input.message,
          response: response.content,
          messageId: response.messageId,
          crisisLevel: response.crisisLevel,
          emotions: response.emotions,
          therapeuticTechnique: response.therapeuticTechnique,
          timestamp: new Date().toISOString(),
        },
      });

      logger.debug(`Saved checkpoint '${checkpointKey}' for session ${session.id}`);
    }

    // 8. Advance step if requested (for journey progression)
    if (input.advance_step && session.journeyId) {
      const newStep = session.currentStep + 1;

      await db.update(sessions)
        .set({
          currentStep: newStep,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, input.session_id));

      logger.info(`Advanced session ${session.id} to step ${newStep}`);
    }

    // 9. Return formatted response
    return {
      success: true,
      content: response.content || '',
      messageId: response.messageId,
      metadata: {
        crisisDetected: response.crisisDetected || (response.crisisLevel && Number(response.crisisLevel) > 7),
        crisisLevel: response.crisisLevel,
        crisisHandled,
        crisisConfidence: response.crisis_confidence, // Add crisis confidence
        ragConfidence: response.meta?.rag_confidence, // Add RAG confidence if available
        emotions: response.emotions,
        therapeuticTechnique: response.therapeuticTechnique,
        resources: response.resources,
        sessionId: session.id,
        threadId,
        currentStep: input.advance_step ? session.currentStep + 1 : session.currentStep,
      },
      timestamp: new Date().toISOString(),
    };

  } catch (error) {
    logger.error('Error in sendMessage:', error);

    // Parse input for error handling (may have failed validation)
    let sessionId: string | undefined;
    let messageLength: number | undefined;

    try {
      const parsedInput = SendMessageSchema.parse(args);
      sessionId = parsedInput.session_id;
      messageLength = parsedInput.message.length;
    } catch {
      // Input validation failed, use defaults
    }

    // Handle error with our error handler
    const errorContext = await errorHandler.handle(error as Error, {
      sessionId,
      threadId,
      messageLength,
    });

    // Check if we should fallback based on error type
    if (errorContext.recoverable && process.env.FALLBACK_TO_LOCAL_PROCESSING === 'true') {
      // Fallback for recoverable errors
      if (errorContext.type === ErrorType.NETWORK ||
          errorContext.type === ErrorType.TIMEOUT ||
          errorContext.type === ErrorType.SERVER) {
        logger.info('Falling back to local processing due to recoverable error');
        return handleLocalFallback(args);
      }
    }

    // Special handling for crisis errors
    if (errorContext.type === ErrorType.CRISIS) {
      return {
        success: false,
        error: errorContext.userMessage || errorContext.message,
        metadata: {
          emergencyResources: errorContext.metadata?.emergencyResources,
          crisisDetected: true,
        },
        timestamp: new Date().toISOString(),
      };
    }

    // Return error response with appropriate user message
    return {
      success: false,
      error: errorContext.userMessage || errorContext.message,
      errorType: errorContext.type,
      recoverable: errorContext.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Handle crisis detection and escalation
 */
async function handleCrisisDetection(
  sessionId: string,
  threadId: string,
  response: ShrinkResponse
): Promise<boolean> {
  const db = getDb();

  try {
    // 1. Update session metadata with crisis flag
    const [existingSession] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    const updatedMetadata = {
      ...(existingSession?.metadata as object || {}),
      crisisDetected: true,
      crisisLevel: response.crisisLevel,
      crisisTimestamp: new Date().toISOString(),
      lastCrisisThreadId: threadId,
    };

    await db.update(sessions)
      .set({
        metadata: updatedMetadata,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));

    // 2. Save crisis checkpoint
    await db.insert(checkpoints).values({
      sessionId,
      stepId: 'crisis',
      key: 'crisis_detection',
      value: {
        level: response.crisisLevel,
        resources: response.resources,
        escalationPath: response.escalationPath,
        threadId,
        timestamp: new Date().toISOString(),
      },
    });

    logger.info(`Crisis handled for session ${sessionId}, thread ${threadId}`);
    return true;

  } catch (error) {
    logger.error('Error handling crisis detection:', error);
    return false;
  }
}

/**
 * Fallback to local processing when shrink-chat is unavailable
 */
async function handleLocalFallback(args: unknown): Promise<any> {
  logger.warn('Falling back to local processing due to shrink-chat unavailability');

  const input = SendMessageSchema.parse(args);

  // Basic local response - this would be expanded with actual logic
  return {
    success: true,
    content: "I understand you're trying to communicate. The therapeutic service is temporarily unavailable, but your message has been noted. Please try again shortly or contact support if this persists.",
    messageId: uuidv4(),
    metadata: {
      fallbackMode: true,
      sessionId: input.session_id,
      timestamp: new Date().toISOString(),
    },
  };
}