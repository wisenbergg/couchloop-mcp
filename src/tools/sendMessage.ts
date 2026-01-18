import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { getShrinkChatClient } from '../clients/shrinkChatClient.js';
import { sessions, checkpoints, journeys, crisisEvents, governanceEvaluations } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js';
import { v4 as uuidv4 } from 'uuid';
import type { ShrinkResponse } from '../clients/shrinkChatClient.js';

// Input validation schema
const SendMessageSchema = z.object({
  session_id: z.string().uuid(),
  message: z.string().min(1).max(10000),
  conversation_type: z.string().optional(),
  system_prompt: z.string().optional(),
  save_checkpoint: z.boolean().optional(),
  checkpoint_key: z.string().optional(),
  advance_step: z.boolean().optional(),
  journey_id: z.string().uuid().optional(),
});

/**
 * TRULY SIMPLE sendMessage
 *
 * Just use shrink-chat's existing crisis detection to trigger self-correction.
 * No additional patterns. No complex logic.
 */
export async function sendMessage(args: unknown) {

  try {
    const input = SendMessageSchema.parse(args);
    const db = getDb();

    logger.info(`Sending message for session ${input.session_id}`);

    // Get session
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, input.session_id))
      .limit(1);

    if (!session) {
      throw new NotFoundError(`Session ${input.session_id} not found`);
    }

    // Get or create thread ID
    let threadId = session.threadId;
    if (!threadId) {
      threadId = uuidv4();
      await db.update(sessions)
        .set({ threadId })
        .where(eq(sessions.id, input.session_id));
    }

    // Build context (keeping existing context building)
    const journey = session.journeyId
      ? await db.select().from(journeys).where(eq(journeys.id, session.journeyId)).limit(1).then(res => res[0])
      : null;

    const memoryContext = JSON.stringify({
      userId: session.userId || 'anonymous',
      conversationType: input.conversation_type || 'supportive',
      sessionGoals: (journey as any)?.metadata?.goals || [],
      emotionalState: (session.metadata as any)?.emotionalState || 'neutral',
    });

    const enhancedContext = {
      journeyStep: journey && session.currentStep < (journey.steps as any[]).length
        ? (journey.steps as any[])[session.currentStep]
        : null,
      progressIndicators: (session.metadata as any)?.progressIndicators || [],
    };

    // Get conversation history
    const previousCheckpoints = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.sessionId, session.id))
      .orderBy(desc(checkpoints.createdAt));

    const history = previousCheckpoints
      .filter(cp => cp.value && typeof cp.value === 'object' && 'message' in cp.value && 'response' in cp.value)
      .flatMap(cp => {
        const val = cp.value as any;
        return [
          { role: 'user', content: val.message },
          { role: 'assistant', content: val.response },
        ];
      })
      .slice(-10);

    // Save user message
    await db.insert(checkpoints).values({
      sessionId: session.id,
      stepId: session.currentStep.toString(),
      key: 'user-message',
      value: {
        message: input.message,
        messageId: uuidv4(),
        role: 'user',
        timestamp: new Date().toISOString(),
      },
    });

    // Get shrink-chat client
    const client = getShrinkChatClient();

    // Send message
    let response = await client.sendMessage(
      threadId,
      input.message,
      {
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

    // Debug log the full response to see what we're getting
    logger.info('[DEBUG] Full shrink-chat response:', JSON.stringify({
      crisis_requires_intervention: response.crisis_requires_intervention,
      crisis_level: response.crisis_level,
      crisisLevel: response.crisisLevel,
      crisis_confidence: response.crisis_confidence,
      crisis_indicators: response.crisis_indicators,
      crisis_suggested_actions: response.crisis_suggested_actions
    }, null, 2));

    // Check if we need intervention (check both field names and crisis level)
    const needsIntervention = response.crisis_requires_intervention === true ||
                             (response.crisis_level !== undefined && response.crisis_level !== 'none' &&
                              (typeof response.crisis_level === 'number' ? response.crisis_level >= 8 : false));

    // If shrink-chat says intervention is required, ask for revision
    if (needsIntervention) {
      logger.info(`[Self-Correction] Shrink-chat detected crisis requiring intervention`);

      // Log the initial response
      await logGovernanceEvaluation(
        session.id,
        response.content || response.reply || '',
        'revision_requested',
        `Crisis level ${response.crisis_level}: ${response.crisis_indicators?.join(', ') || 'intervention required'}`,
        response.crisis_confidence || 0
      );

      // Ask LLM to revise based on shrink-chat's own assessment
      const revisionPrompt = `The previous response may escalate the user's distress (crisis level: ${response.crisis_level}).
Please provide a safer, more supportive response to: "${input.message}"

Suggested approach: ${response.crisis_suggested_actions?.join(', ') || 'De-escalate, validate, provide resources'}`;

      // Get revised response
      const revisedResponse = await client.sendMessage(
        threadId,
        revisionPrompt,
        {
          memoryContext,
          enhancedContext,
          history: [...history,
            { role: 'user', content: input.message },
            { role: 'assistant', content: response.content || response.reply || '' }
          ],
          systemPrompt: 'Provide a supportive, safe response that de-escalates distress.',
          conversationType: 'revision',
          idempotencyKey: uuidv4(),
        }
      );

      // Log revised response
      await logGovernanceEvaluation(
        session.id,
        revisedResponse.content || revisedResponse.reply || '',
        'revision_applied',
        'Self-corrected based on crisis detection',
        revisedResponse.crisis_confidence || 0
      );

      response = revisedResponse;
      selfCorrected = true;
      logger.info(`[Self-Correction] Applied revised response`);
    } else {
      // Log approved response
      await logGovernanceEvaluation(
        session.id,
        response.content || response.reply || '',
        'approved',
        'No intervention required',
        response.crisis_confidence || 0
      );
    }

    // Save assistant response
    const responseContent = response.content || response.reply || response.response_text || '';
    await db.insert(checkpoints).values({
      sessionId: session.id,
      stepId: session.currentStep.toString(),
      key: 'assistant-message',
      value: {
        message: responseContent,
        messageId: response.messageId || uuidv4(),
        role: 'assistant',
        crisisLevel: response.crisis_level || response.crisisLevel,
        selfCorrected,
        timestamp: new Date().toISOString(),
      },
    });

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
          message: input.message,
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

    // Return response
    return {
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
 * Log governance evaluation - SIMPLIFIED
 */
async function logGovernanceEvaluation(
  sessionId: string,
  content: string,
  action: string,
  reason: string,
  confidence: number
): Promise<void> {
  const db = getDb();

  try {
    await db.insert(governanceEvaluations).values({
      sessionId,
      draftResponse: content.substring(0, 1000),
      evaluationResults: {
        hallucination: { detected: false, confidence: 0, patterns: [] },
        inconsistency: { detected: false, confidence: 0, patterns: [] },
        toneDrift: { detected: false, confidence: 0, patterns: [] },
        unsafeReasoning: {
          detected: action === 'revision_requested',
          confidence,
          patterns: [reason]
        },
        overallRisk: action === 'revision_requested' ? 'high' : 'low',
        recommendedAction: action === 'revision_requested' ? 'modify' : 'allow',
        confidence: confidence
      },
      interventionApplied: action === 'revision_requested' ? 'revision' : null,
      finalResponse: action === 'revision_applied' ? content.substring(0, 1000) : null,
    });
  } catch (error) {
    logger.error('Failed to log governance evaluation:', error);
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
async function handleLocalFallback(args: unknown): Promise<any> {
  const input = SendMessageSchema.parse(args);
  const db = getDb();

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, input.session_id))
    .limit(1);

  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  const fallbackContent = "I understand you're trying to communicate. The therapeutic service is temporarily unavailable, but your message has been noted. Please try again shortly.";

  await db.insert(checkpoints).values({
    sessionId: session.id,
    stepId: session.currentStep.toString(),
    key: 'assistant-message',
    value: {
      message: fallbackContent,
      messageId: uuidv4(),
      role: 'assistant',
      fallbackMode: true,
      timestamp: new Date().toISOString(),
    },
  });

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