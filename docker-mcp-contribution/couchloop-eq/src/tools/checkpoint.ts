import { getDb } from '../db/client.js';
import { sessions, journeys, checkpoints } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { SaveCheckpointSchema } from '../types/checkpoint.js';
import { handleError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export async function saveCheckpoint(args: any) {
  try {
    const input = SaveCheckpointSchema.parse(args);
    const db = getDb();

    // Verify session exists and is active
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, input.session_id))
      .limit(1);

    if (!session) {
      throw new NotFoundError('Session', input.session_id);
    }

    if (session.status !== 'active') {
      throw new Error(`Session is ${session.status}, not active`);
    }

    // Get current step ID
    let stepId = 'freeform';
    let nextStep = null;
    let journeyComplete = false;

    if (session.journeyId) {
      const [journey] = await db
        .select()
        .from(journeys)
        .where(eq(journeys.id, session.journeyId))
        .limit(1);

      if (journey && journey.steps) {
        const currentStepData = journey.steps[session.currentStep];
        if (currentStepData) {
          stepId = currentStepData.id;
        }

        // Advance to next step if requested
        if (input.advance_step) {
          const nextStepIndex = session.currentStep + 1;
          if (nextStepIndex < journey.steps.length) {
            nextStep = journey.steps[nextStepIndex];
            // Update session's current step
            await db
              .update(sessions)
              .set({
                currentStep: nextStepIndex,
                lastActiveAt: new Date(),
              })
              .where(eq(sessions.id, session.id));
          } else {
            // Journey complete
            journeyComplete = true;
            await db
              .update(sessions)
              .set({
                status: 'completed',
                completedAt: new Date(),
                lastActiveAt: new Date(),
              })
              .where(eq(sessions.id, session.id));
          }
        }
      }
    }

    // Save checkpoint
    const checkpointResult = await db
      .insert(checkpoints)
      .values({
        sessionId: input.session_id,
        stepId: stepId,
        key: input.key,
        value: input.value,
      })
      .returning();

    const checkpoint = checkpointResult[0]!;

    logger.info(`Saved checkpoint: ${checkpoint.id} for session: ${session.id}`);

    return {
      checkpoint_id: checkpoint.id,
      next_step: nextStep,
      journey_complete: journeyComplete,
      message: journeyComplete
        ? 'Journey completed! Well done.'
        : nextStep
        ? `Checkpoint saved. ${nextStep.content?.prompt || 'Continue to next step.'}`
        : 'Checkpoint saved.',
    };
  } catch (error) {
    logger.error('Error saving checkpoint:', error);
    return handleError(error);
  }
}

export async function getCheckpoints(args: any) {
  try {
    const { session_id } = args;
    const db = getDb();

    // Verify session exists
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session_id))
      .limit(1);

    if (!session) {
      throw new NotFoundError('Session', session_id);
    }

    // Get all checkpoints
    const sessionCheckpoints = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.sessionId, session_id))
      .orderBy(checkpoints.createdAt);

    return {
      session_id: session_id,
      checkpoints: sessionCheckpoints,
      count: sessionCheckpoints.length,
    };
  } catch (error) {
    logger.error('Error getting checkpoints:', error);
    return handleError(error);
  }
}