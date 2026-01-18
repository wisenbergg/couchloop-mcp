import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { getShrinkChatClient } from '../clients/shrinkChatClient.js';
import { sessions, checkpoints, journeys, threadMappings, crisisEvents, governanceEvaluations } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js';
import { errorHandler, ErrorType } from '../utils/errorHandler.js';
import { v4 as uuidv4 } from 'uuid';
import type { ShrinkResponse } from '../clients/shrinkChatClient.js';

// Import governance layer
import { GovernancePipeline, InterventionAction, type SessionContext } from '../governance/evaluationEngine.js';
import { InterventionEngine } from '../governance/intervention.js';
import { loadConfig } from '../governance/config.js';

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

      // Create thread mapping for MCP-Shrink-chat integration
      await db.insert(threadMappings).values({
        sessionId: input.session_id,
        threadId: threadId,
        source: 'mcp',
        metadata: {
          createdFrom: 'sendMessage',
          timestamp: new Date().toISOString(),
        },
      });
      logger.info(`Created thread mapping for session ${input.session_id} -> thread ${threadId}`);
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

    // 5. Save user message as checkpoint BEFORE sending
    const userMessageId = uuidv4();
    await db.insert(checkpoints).values({
      sessionId: session.id,
      stepId: session.currentStep.toString(),
      key: 'user-message',
      value: {
        message: input.message,
        messageId: userMessageId,
        role: 'user',
        timestamp: new Date().toISOString(),
      },
    });
    logger.debug(`Saved user message checkpoint for session ${session.id}`);

    // 6. Send message through shrink-chat
    const response = await client.sendMessage(
      threadId,
      input.message, // This is 'prompt' in the API
      {
        memoryContext,
        enhancedContext,
        history,
        systemPrompt: input.system_prompt,
        conversationType: input.conversation_type,
        idempotencyKey: uuidv4(),
      }
    );

    // 6.5 GOVERNANCE LAYER - Evaluate and potentially intervene on response
    const governanceConfig = loadConfig();
    let finalResponse = response;
    let governanceApplied = false;
    let governanceMetadata: any = {};

    if (governanceConfig.enabled) {
      try {
        logger.info(`[Governance] Evaluating response for session ${session.id}`);

        // Build governance context
        const governanceContext: SessionContext = {
          sessionId: session.id,
          userId: session.userId || undefined,
          journeyId: session.journeyId || undefined,
          conversationHistory: history.map(msg => ({
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
            timestamp: new Date()
          })),
          currentStep: session.currentStep,
          metadata: {
            crisisHistory: response.crisisLevel && Number(response.crisisLevel) > 7,
            ...(session.metadata as Record<string, any> || {})
          }
        };

        // Initialize governance pipeline
        const governancePipeline = new GovernancePipeline(governanceConfig);
        const interventionEngine = new InterventionEngine(governanceConfig);

        // Evaluate draft response
        const evaluation = await governancePipeline.evaluate(response.content || '', governanceContext);

        // Log evaluation results
        logger.debug(`[Governance] Evaluation results:`, {
          hallucination: evaluation.hallucination.detected,
          inconsistency: evaluation.inconsistency.detected,
          toneDrift: evaluation.toneDrift.detected,
          unsafeReasoning: evaluation.unsafeReasoning.detected,
          overallRisk: evaluation.overallRisk,
          recommendedAction: evaluation.recommendedAction,
          confidence: evaluation.confidence
        });

        // Apply intervention if needed
        if (evaluation.recommendedAction !== InterventionAction.APPROVE) {
          logger.warn(`[Governance] Intervention required: ${evaluation.recommendedAction}`);

          const interventionResult = await interventionEngine.intervene(
            evaluation.recommendedAction,
            response.content || '',
            evaluation
          );

          // Update response with governed content
          finalResponse = {
            ...response,
            content: interventionResult.finalResponse
          };

          governanceApplied = true;
          governanceMetadata = {
            evaluationId: evaluation.evaluationId,
            action: interventionResult.action,
            modified: interventionResult.modified,
            reason: interventionResult.reason,
            confidence: interventionResult.confidence,
            originalContentHash: Buffer.from(response.content || '').toString('base64').substring(0, 20) // Short hash for audit
          };

          logger.info(`[Governance] Intervention applied: ${interventionResult.action}`);

          // Save governance evaluation to database (async, non-blocking)
          saveGovernanceEvaluation(session.id, evaluation, interventionResult, response.content || '')
            .catch(err => logger.error('[Governance] Failed to save evaluation:', err));
        } else {
          logger.debug(`[Governance] Response approved without intervention`);

          // Save approved evaluation for audit trail
          const approvalResult = {
            modified: false,
            action: 'approve',
            reason: 'Response meets safety criteria',
            finalResponse: response.content || '',
            confidence: evaluation.confidence
          };

          saveGovernanceEvaluation(session.id, evaluation, approvalResult, response.content || '')
            .catch(err => logger.error('[Governance] Failed to save approved evaluation:', err));
        }

      } catch (governanceError) {
        // Governance failure should not break the response
        logger.error('[Governance] Evaluation failed, using original response:', governanceError);

        // In production, optionally use fallback mode
        if (governanceConfig.mode === 'enforce' && process.env.NODE_ENV === 'production') {
          // Use safe fallback if governance fails in production
          finalResponse = {
            ...response,
            content: governanceConfig.fallbackResponses.error
          };
          governanceApplied = true;
          governanceMetadata = {
            error: true,
            reason: 'Governance evaluation failed'
          };
        }
      }
    }

    // 7. Save assistant response as checkpoint AFTER receiving (use governed response)
    await db.insert(checkpoints).values({
      sessionId: session.id,
      stepId: session.currentStep.toString(),
      key: 'assistant-message',
      value: {
        message: finalResponse.content,
        messageId: finalResponse.messageId,
        role: 'assistant',
        crisisLevel: finalResponse.crisisLevel,
        emotions: finalResponse.emotions,
        therapeuticTechnique: finalResponse.therapeuticTechnique,
        governanceApplied,
        governanceMetadata: governanceApplied ? governanceMetadata : undefined,
        timestamp: new Date().toISOString(),
      },
    });
    logger.debug(`Saved assistant message checkpoint for session ${session.id}`);

    // 8. Handle crisis detection if present
    let crisisHandled = false;
    if (finalResponse.crisisLevel && Number(finalResponse.crisisLevel) > 7) {
      logger.warn(`Crisis detected: Level ${finalResponse.crisisLevel} for session ${session.id}`);
      crisisHandled = await handleCrisisDetection(session.id, threadId, finalResponse);
    }

    // 9. Save additional checkpoint if requested (for backward compatibility)
    if (input.save_checkpoint) {
      const checkpointKey = input.checkpoint_key || 'message_response';

      await db.insert(checkpoints).values({
        sessionId: session.id,
        stepId: session.currentStep.toString(),
        key: checkpointKey,
        value: {
          message: input.message,
          response: finalResponse.content,
          messageId: finalResponse.messageId,
          crisisLevel: finalResponse.crisisLevel,
          emotions: finalResponse.emotions,
          therapeuticTechnique: finalResponse.therapeuticTechnique,
          governanceApplied,
          governanceMetadata: governanceApplied ? governanceMetadata : undefined,
          timestamp: new Date().toISOString(),
        },
      });

      logger.debug(`Saved checkpoint '${checkpointKey}' for session ${session.id}`);
    }

    // 10. Advance step if requested (for journey progression)
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

    // 11. Return formatted response
    return {
      success: true,
      content: finalResponse.content || '',
      messageId: finalResponse.messageId,
      metadata: {
        crisisDetected: finalResponse.crisisDetected || (finalResponse.crisisLevel && Number(finalResponse.crisisLevel) > 7),
        crisisLevel: finalResponse.crisisLevel,
        crisisHandled,
        crisisConfidence: finalResponse.crisis_confidence, // Add crisis confidence
        ragConfidence: finalResponse.meta?.rag_confidence, // Add RAG confidence if available
        emotions: finalResponse.emotions,
        therapeuticTechnique: finalResponse.therapeuticTechnique,
        resources: finalResponse.resources,
        sessionId: session.id,
        threadId,
        currentStep: input.advance_step ? session.currentStep + 1 : session.currentStep,
        // Governance metadata
        governanceApplied,
        governanceAction: governanceApplied ? governanceMetadata.action : undefined,
        governanceReason: governanceApplied ? governanceMetadata.reason : undefined,
        governanceConfidence: governanceApplied ? governanceMetadata.confidence : undefined,
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

    // 3. Save crisis event for tracking
    await db.insert(crisisEvents).values({
      sessionId,
      threadId,
      crisisLevel: Number(response.crisisLevel),
      response: response.content,
      resources: response.resources || [],
      escalationPath: response.escalationPath,
      handled: true,
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
  const db = getDb();

  // Get the session to have proper currentStep
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, input.session_id))
    .limit(1);

  if (!session) {
    logger.error(`Session ${input.session_id} not found for fallback`);
    return {
      success: false,
      error: 'Session not found',
    };
  }

  const fallbackContent = "I understand you're trying to communicate. The therapeutic service is temporarily unavailable, but your message has been noted. Please try again shortly or contact support if this persists.";
  const fallbackMessageId = uuidv4();
  const timestamp = new Date().toISOString();

  // Save the fallback response as an assistant checkpoint
  try {
    await db.insert(checkpoints).values({
      sessionId: session.id,
      stepId: session.currentStep.toString(),
      key: 'assistant-message',
      value: {
        message: fallbackContent,
        messageId: fallbackMessageId,
        role: 'assistant',
        fallbackMode: true,
        timestamp: timestamp,
      },
    });
    logger.debug(`Saved fallback assistant message checkpoint for session ${session.id}`);
  } catch (error) {
    logger.error('Failed to save fallback checkpoint:', error);
  }

  // Basic local response - this would be expanded with actual logic
  return {
    success: true,
    content: fallbackContent,
    messageId: fallbackMessageId,
    metadata: {
      fallbackMode: true,
      sessionId: session.id,
      threadId: session.threadId || undefined,
      currentStep: session.currentStep,
      timestamp: timestamp,
    },
  };
}

/**
 * Save governance evaluation results to database for audit trail
 */
async function saveGovernanceEvaluation(
  sessionId: string,
  evaluation: any,
  interventionResult: any,
  originalContent: string
): Promise<void> {
  const db = getDb();

  try {
    // Save to dedicated governance_evaluations table
    const evaluationId = uuidv4();
    await db.insert(governanceEvaluations).values({
      id: evaluationId,
      sessionId,
      draftResponse: originalContent,
      evaluationResults: {
        hallucination: {
          detected: evaluation.hallucination.detected,
          confidence: evaluation.hallucination.confidence,
          patterns: evaluation.hallucination.patterns || []
        },
        inconsistency: {
          detected: evaluation.inconsistency.detected,
          confidence: evaluation.inconsistency.confidence,
          patterns: evaluation.inconsistency.patterns || []
        },
        toneDrift: {
          detected: evaluation.toneDrift.detected,
          confidence: evaluation.toneDrift.confidence,
          patterns: evaluation.toneDrift.patterns || []
        },
        unsafeReasoning: {
          detected: evaluation.unsafeReasoning.detected,
          confidence: evaluation.unsafeReasoning.confidence,
          patterns: evaluation.unsafeReasoning.patterns || []
        },
        overallRisk: evaluation.overallRisk,
        recommendedAction: evaluation.recommendedAction,
        confidence: evaluation.confidence
      },
      interventionApplied: interventionResult.modified ? interventionResult.action : null,
      finalResponse: interventionResult.finalResponse || originalContent,
    });

    logger.debug(`Saved governance evaluation ${evaluationId} for session ${sessionId}`);

    // Also save as checkpoint for backward compatibility
    await db.insert(checkpoints).values({
      sessionId,
      stepId: 'governance',
      key: 'governance_evaluation',
      value: {
        evaluationId: evaluationId,
        timestamp: new Date().toISOString(),
        overallRisk: evaluation.overallRisk,
        recommendedAction: evaluation.recommendedAction,
        confidence: evaluation.confidence,
        detections: {
          hallucination: evaluation.hallucination.detected,
          inconsistency: evaluation.inconsistency.detected,
          toneDrift: evaluation.toneDrift.detected,
          unsafeReasoning: evaluation.unsafeReasoning.detected,
        },
        intervention: {
          applied: interventionResult.modified,
          action: interventionResult.action,
          reason: interventionResult.reason,
        },
      },
    });

  } catch (error) {
    logger.error('Failed to save governance evaluation:', error);
    // Non-critical, don't throw
  }
}