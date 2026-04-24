import { getSupabaseClientAsync, throwOnError } from '../db/supabase-helpers.js';
import { SaveCheckpointSchema, CheckpointResponse } from '../types/checkpoint.js';
import { handleError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getOrCreateSession } from './session-manager.js';
import { storeContext } from './preserve-context.js';
import { governancePostCheck } from '../governance/middleware.js';

export async function saveCheckpoint(args: unknown): Promise<CheckpointResponse | { error: string }> {
  try {
    const input = SaveCheckpointSchema.parse(args);
    const supabase = await getSupabaseClientAsync();

    // Get or create session implicitly if not provided
    // FIX 1: Session object returned directly — no redundant re-fetch
    const { sessionId, session, isNew } = await getOrCreateSession(
      input.session_id,
      input.auth,
      'Checkpoint session'
    );

    if (session.status !== 'active') {
      throw new Error(`Session is ${session.status}, not active`);
    }

    // Get current step ID
    let stepId = 'freeform';
    let nextStep = null;
    let journeyComplete = false;

    if (session.journey_id) {
      const journey = throwOnError(
        await supabase
          .from('journeys')
          .select('*')
          .eq('id', session.journey_id)
          .maybeSingle()
      );

      if (journey && journey.steps) {
        const currentStepData = journey.steps[session.current_step];
        if (currentStepData) {
          stepId = currentStepData.id;
        }

        // Advance to next step if requested
        if (input.advance_step) {
          const nextStepIndex = session.current_step + 1;
          if (nextStepIndex < journey.steps.length) {
            nextStep = journey.steps[nextStepIndex];
            // Update session's current step
            throwOnError(
              await supabase
                .from('sessions')
                .update({
                  current_step: nextStepIndex,
                  last_active_at: new Date().toISOString(),
                })
                .eq('id', session.id)
            );
          } else {
            // Journey complete
            journeyComplete = true;
            throwOnError(
              await supabase
                .from('sessions')
                .update({
                  status: 'completed',
                  completed_at: new Date().toISOString(),
                  last_active_at: new Date().toISOString(),
                })
                .eq('id', session.id)
            );
          }
        }
      }
    }

    // Save checkpoint
    const checkpointResult = throwOnError(
      await supabase
        .from('checkpoints')
        .insert({
          session_id: sessionId,
          step_id: stepId,
          key: input.key,
          value: input.value,
        })
        .select()
    );

    const checkpoint = (checkpointResult ?? [])[0]!;

    logger.info(`Saved checkpoint: ${checkpoint.id} for session: ${session.id}`);

    // Extended response
    const response: CheckpointResponse = {
      checkpoint_id: checkpoint.id,
      session_id: sessionId,
      session_created: isNew,
      next_step: nextStep,
      journey_complete: journeyComplete,
      message: journeyComplete
        ? 'Journey completed! Well done.'
        : nextStep
        ? `Checkpoint saved. ${nextStep.content?.prompt || 'Continue to next step.'}`
        : 'Checkpoint saved.',
    };

    // === Governance check on value ===
    if (input.governance_check) {
      const valueStr = typeof input.value === 'string' ? input.value : JSON.stringify(input.value);
      const govResult = await governancePostCheck('save_checkpoint', valueStr);
      response.governance_result = {
        allowed: govResult.allowed,
        issues: govResult.issues,
        confidence: govResult.confidence,
      };

      // Log to governance audit
      if (govResult.issues.length > 0) {
        try {
          throwOnError(
            await supabase.from('governance_audit_log').insert({
              action_type: 'checkpoint_review',
              reason: govResult.issues.join('; '),
              confidence_score: Math.round(govResult.confidence * 100),
              metadata: {
                checkpoint_id: checkpoint.id,
                session_id: sessionId,
                key: input.key,
                issues: govResult.issues,
              },
            })
          );
        } catch (auditError) {
          logger.warn('Failed to log governance audit:', auditError);
        }
      }
    }

    // === Save as insight (consolidated from save_insight) ===
    if (input.save_as_insight) {
      try {
        // We already have the session with userId, no need to extract user again
        const contentStr = typeof input.value === 'string' ? input.value : JSON.stringify(input.value);
        const insightResult = throwOnError(
          await supabase.from('insights').insert({
            user_id: session.user_id,
            session_id: sessionId,
            content: `[${input.key}] ${contentStr}`,
            tags: input.insight_tags || [input.key],
          }).select()
        );

        if ((insightResult ?? [])[0]) {
          response.insight_id = (insightResult ?? [])[0].id;
          logger.info(`Also saved as insight: ${response.insight_id}`);
        }
      } catch (insightError) {
        logger.warn('Failed to save as insight:', insightError);
      }
    }

    // === Preserve context (consolidated from preserve_context) ===
    if (input.preserve_context && input.context_category) {
      try {
        const contentStr = typeof input.value === 'string' ? input.value : JSON.stringify(input.value);
        await storeContext(input.context_category, `[${input.key}] ${contentStr}`, {
          auth: input.auth,
          sessionId: sessionId,
        });
        response.context_stored = true;
        logger.info(`Also stored as ${input.context_category} context`);
      } catch (contextError) {
        logger.warn('Failed to store context:', contextError);
        response.context_stored = false;
      }
    }

    return response;
  } catch (error) {
    logger.error('Error saving checkpoint:', error);
    return handleError(error);
  }
}

export async function getCheckpoints(args: { session_id?: string; auth?: { user_id?: string; client_id?: string; token?: string } }) {
  try {
    const { session_id, auth } = args;
    const supabase = await getSupabaseClientAsync();

    // Get or create session implicitly if not provided
    // FIX 1: Session object returned directly — no redundant re-fetch
    const { sessionId, isNew } = await getOrCreateSession(session_id, auth);

    // Get all checkpoints
    const sessionCheckpoints = throwOnError(
      await supabase
        .from('checkpoints')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
    );

    return {
      session_id: sessionId,
      session_created: isNew,
      checkpoints: sessionCheckpoints ?? [],
      count: (sessionCheckpoints ?? []).length,
    };
  } catch (error) {
    logger.error('Error getting checkpoints:', error);
    return handleError(error);
  }
}
