import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { getShrinkChatClient } from '../clients/shrinkChatClient.js';
import { sessions, checkpoints, journeys, crisisEvents, governanceEvaluations } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { sanitizeResponse } from '../utils/sanitize.js';
import { sanitizeText } from '../utils/inputSanitize.js';
import { NotFoundError } from '../utils/errors.js';
import { v4 as uuidv4 } from 'uuid';
import type { ShrinkResponse } from '../clients/shrinkChatClient.js';
import { EvaluationEngine, type SessionContext } from '../governance/evaluationEngine.js';
import { getOrCreateSession } from './session-manager.js';

// Type definitions for metadata fields
interface SessionMetadata {
  emotionalState?: string;
  progressIndicators?: string[];
}

interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

// Overall timeout for sendMessage - increased to 60s for slow AI responses
const SEND_MESSAGE_TIMEOUT: number = parseInt(process.env.SEND_MESSAGE_TIMEOUT || '60000');

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result: T = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

// Initialize governance engine (singleton)
let governanceEngine: EvaluationEngine | null = null;

function getGovernanceEngine(): EvaluationEngine {
  if (!governanceEngine) {
    governanceEngine = new EvaluationEngine();
    logger.info('[Governance] Evaluation engine initialized');
  }
  return governanceEngine;
}

// Input validation schema
const SendMessageSchema = z.object({
  session_id: z.string().uuid().optional(),
  message: z.string().min(1).max(10000),
  conversation_type: z.string().optional(),
  system_prompt: z.string().optional(),
  save_checkpoint: z.boolean().optional(),
  checkpoint_key: z.string().optional(),
  advance_step: z.boolean().optional(),
  journey_id: z.string().uuid().optional(),
});

/**
 * sendMessage - wrapped with overall timeout to prevent Smithery proxy aborts.
 * Uses shrink-chat's existing crisis detection to trigger self-correction.
 */
export async function sendMessage(args: unknown) {
  return withTimeout(sendMessageInternal(args), SEND_MESSAGE_TIMEOUT, 'sendMessage');
}

async function sendMessageInternal(args: unknown) {

  try {
    const input = SendMessageSchema.parse(args);
    // Defense-in-depth: sanitize text input beyond Zod validation
    const message = sanitizeText(input.message);
    const db = getDb();

    // Get or create session implicitly if not provided
    const { sessionId, isNew } = await getOrCreateSession(
      input.session_id,
      undefined,
      'Message session'
    );

    logger.info(`Sending message for session ${sessionId}${isNew ? ' (newly created)' : ''}`);

    // Query session only - message history is owned by shrink-chat
    const [session] = await db.select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw new NotFoundError(`Session ${sessionId} not found`);
    }

    // Get or create thread ID
    let threadId = session.threadId;
    if (!threadId) {
      threadId = uuidv4();
      await db.update(sessions)
        .set({ threadId })
        .where(eq(sessions.id, sessionId));
    }

    // Build context (keeping existing context building)
    // Journey fetch still needs to be sequential since it depends on session.journeyId
    const journey = session.journeyId
      ? await db.select().from(journeys).where(eq(journeys.id, session.journeyId)).limit(1).then(res => res[0])
      : null;

    const memoryContext = JSON.stringify({
      userId: session.userId || 'anonymous',
      conversationType: input.conversation_type || 'supportive',
      sessionGoals: [],
      emotionalState: (session.metadata as SessionMetadata | undefined)?.emotionalState || 'neutral',
    });

    const enhancedContext = {
      journeyStep: journey && session.currentStep < journey.steps.length
        ? journey.steps[session.currentStep]
        : null,
      progressIndicators: (session.metadata as SessionMetadata | undefined)?.progressIndicators || [],
    };

    // Message history is owned by shrink-chat (via threadId) - no need to build from checkpoints
    const history: HistoryEntry[] = [];

    // Get shrink-chat client
    const client = getShrinkChatClient();

    // Send message
    let response = await client.sendMessage(
      threadId,
      message,
      {
        userId: session.userId,
        memoryContext,
        enhancedContext,
        history,
        systemPrompt: input.system_prompt,
        conversationType: input.conversation_type,
        idempotencyKey: uuidv4(),
      }
    );

    // === ULTRA SIMPLE SELF-CORRECTION ===
    // Just use shrink-chat's own crisis detection!

    let selfCorrected = false;

    // Log crisis fields at debug level (avoids JSON.stringify overhead in production)
    logger.debug('[Shrink-chat] Crisis fields:', {
      crisis_requires_intervention: response.crisis_requires_intervention,
      crisis_level: response.crisis_level,
      crisis_confidence: response.crisis_confidence,
    });

    // Check if we need intervention (check both field names and crisis level)
    const needsIntervention = response.crisis_requires_intervention === true ||
                             (response.crisis_level !== undefined && response.crisis_level !== 'none' &&
                              (typeof response.crisis_level === 'number' ? response.crisis_level >= 8 : false));

    // If shrink-chat says intervention is required, ask for revision
    if (needsIntervention) {
      logger.info(`[Self-Correction] Shrink-chat detected crisis requiring intervention`);

      // Ask LLM to revise based on shrink-chat's own assessment
      const revisionPrompt = `The previous response may escalate the user's distress (crisis level: ${response.crisis_level}).
Please provide a safer, more supportive response to: "${message}"

Suggested approach: ${response.crisis_suggested_actions?.join(', ') || 'De-escalate, validate, provide resources'}`;

      // Get revised response
      const revisedResponse = await client.sendMessage(
        threadId,
        revisionPrompt,
        {
          userId: session.userId,
          memoryContext,
          enhancedContext,
          history: [...history,
            { role: 'user', content: message },
            { role: 'assistant', content: response.content || response.reply || '' }
          ],
          systemPrompt: 'Provide a supportive, safe response that de-escalates distress.',
          conversationType: 'revision',
          idempotencyKey: uuidv4(),
        }
      );

      response = revisedResponse;
      selfCorrected = true;
      logger.info(`[Self-Correction] Applied revised response`);
    }

    // Extract response content
    const responseContent = response.content || response.reply || response.response_text || '';

    // Handle high crisis even after revision (for resources/escalation)
    if (response.crisis_level && (typeof response.crisis_level === 'string' ? response.crisis_level !== 'none' : response.crisis_level > 7)) {
      await handleCrisisDetection(session.id, threadId, response);
    }

    // Additional checkpoint if requested
    if (input.save_checkpoint) {
      await db.insert(checkpoints).values({
        sessionId: session.id,
        stepId: session.currentStep.toString(),
        key: input.checkpoint_key || 'message_response',
        value: {
          message: message,
          response: responseContent,
          selfCorrected,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Advance step if requested
    if (input.advance_step && session.journeyId) {
      await db.update(sessions)
        .set({ currentStep: session.currentStep + 1, updatedAt: new Date() })
        .where(eq(sessions.id, session.id));
    }

    // === ASYNC GOVERNANCE EVALUATION ===
    // Run full governance evaluation in the background (non-blocking)
    // This analyzes for hallucination, inconsistency, tone drift, and unsafe reasoning
    runAsyncGovernanceEvaluation(
      session.id,
      session.userId || undefined,
      responseContent,
      history.map(h => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
        timestamp: new Date()
      }))
    ).catch(err => {
      logger.error('[Governance] Async evaluation failed:', err);
    });

    // Build full response (for internal logging)
    const fullResponse = {
      success: true,
      content: responseContent,
      messageId: response.messageId,
      metadata: {
        crisisDetected: response.crisis_requires_intervention || (response.crisis_level && response.crisis_level !== 'none' && (typeof response.crisis_level === 'number' ? response.crisis_level >= 8 : false)),
        crisisLevel: response.crisis_level || response.crisisLevel,
        crisisConfidence: response.crisis_confidence,
        crisisIndicators: response.crisis_indicators,
        sessionId: session.id,
        threadId,
        selfCorrected,
        currentStep: input.advance_step ? session.currentStep + 1 : session.currentStep,
      },
      timestamp: new Date().toISOString(),
    };

    // Return sanitized response (strips sensitive metadata)
    return sanitizeResponse(fullResponse);

  } catch (error) {
    logger.error('Error in sendMessage:', error);

    // Check if it's a network/timeout error that requires fallback
    if (error instanceof Error &&
        (error.message.includes('timeout') ||
         error.message.includes('ECONNREFUSED') ||
         error.message.includes('Shrink-Chat API'))) {
      return await handleLocalFallback(args);
    }

    throw error;
  }
}

/**
 * Run async governance evaluation in the background
 * This evaluates the response for hallucination, inconsistency, tone drift, and unsafe reasoning
 * without blocking the response to the user
 */
async function runAsyncGovernanceEvaluation(
  sessionId: string,
  userId: string | undefined,
  responseContent: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string; timestamp: Date }>
): Promise<void> {
  try {
    const engine = getGovernanceEngine();
    
    const context: SessionContext = {
      sessionId,
      userId,
      conversationHistory
    };

    const startTime = Date.now();
    const result = await engine.evaluate(responseContent, context);
    const evaluationTime = Date.now() - startTime;

    // Log the evaluation with real results - normalize patterns to always be arrays
    const db = getDb();
    await db.insert(governanceEvaluations).values({
      sessionId,
      draftResponse: responseContent.substring(0, 1000),
      evaluationResults: {
        hallucination: {
          detected: result.hallucination.detected,
          confidence: result.hallucination.confidence,
          patterns: result.hallucination.patterns || []
        },
        inconsistency: {
          detected: result.inconsistency.detected,
          confidence: result.inconsistency.confidence,
          patterns: result.inconsistency.patterns || []
        },
        toneDrift: {
          detected: result.toneDrift.detected,
          confidence: result.toneDrift.confidence,
          patterns: result.toneDrift.patterns || []
        },
        unsafeReasoning: {
          detected: result.unsafeReasoning.detected,
          confidence: result.unsafeReasoning.confidence,
          patterns: result.unsafeReasoning.patterns || []
        },
        overallRisk: result.overallRisk,
        recommendedAction: result.recommendedAction,
        confidence: result.confidence
      },
      interventionApplied: null, // Async evaluation doesn't intervene, just logs
      finalResponse: null,
    });

    // Log summary
    const issuesDetected = [
      result.hallucination.detected && 'hallucination',
      result.inconsistency.detected && 'inconsistency', 
      result.toneDrift.detected && 'toneDrift',
      result.unsafeReasoning.detected && 'unsafeReasoning'
    ].filter(Boolean);

    if (issuesDetected.length > 0) {
      logger.warn(`[Governance] Issues detected in session ${sessionId}: ${issuesDetected.join(', ')} (risk: ${result.overallRisk})`);
    } else {
      logger.debug(`[Governance] Response approved for session ${sessionId} (${evaluationTime}ms)`);
    }

  } catch (error) {
    logger.error('[Governance] Async evaluation error:', error);
  }
}

/**
 * Handle crisis detection - keep existing
 */
async function handleCrisisDetection(
  sessionId: string,
  threadId: string,
  response: ShrinkResponse
): Promise<void> {
  const db = getDb();

  await db.insert(crisisEvents).values({
    id: uuidv4(),
    sessionId,
    threadId,
    crisisLevel: typeof response.crisis_level === 'number' ? response.crisis_level : 10,
    response: response.content || response.reply,
    resources: response.resources || [],
    escalationPath: response.escalationPath,
    handled: true,
  });

  logger.info(`Crisis event logged for session ${sessionId}`);
}

/**
 * Fallback handler - keep existing
 */
async function handleLocalFallback(args: unknown): Promise<unknown> {
  const input = SendMessageSchema.parse(args);
  const db = getDb();

  // Get or create session implicitly
  const { sessionId } = await getOrCreateSession(input.session_id);

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  const fallbackContent = "I understand you're trying to communicate. The therapeutic service is temporarily unavailable, but your message has been noted. Please try again shortly.";

  return {
    success: true,
    content: fallbackContent,
    messageId: uuidv4(),
    metadata: {
      fallbackMode: true,
      sessionId: session.id,
      currentStep: session.currentStep,
    },
  };
}