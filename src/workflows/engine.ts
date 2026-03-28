import { getSupabaseClient, throwOnError } from '../db/supabase-helpers.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { JourneyStep } from '../types/journey.js';
import { logger } from '../utils/logger.js';

export class WorkflowEngine {
  private _supabase: SupabaseClient | null = null;

  private get supabase() {
    if (!this._supabase) {
      this._supabase = getSupabaseClient();
    }
    return this._supabase;
  }

  async initializeSession(userId: string, journeyId: string): Promise<string> {
    const sessionResult = throwOnError(
      await this.supabase
        .from('sessions')
        .insert({
          user_id: userId,
          journey_id: journeyId,
          status: 'active',
          current_step: 0,
          metadata: {},
        })
        .select()
    );

    const session = (sessionResult ?? [])[0]!;
    logger.info(`Initialized session ${session.id} for journey ${journeyId}`);
    return session.id;
  }

  async getCurrentStep(sessionId: string): Promise<JourneyStep | null> {
    const session = throwOnError(
      await this.supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle()
    );

    if (!session || !session.journey_id) {
      return null;
    }

    const journey = throwOnError(
      await this.supabase
        .from('journeys')
        .select('*')
        .eq('id', session.journey_id)
        .maybeSingle()
    );

    if (!journey || !journey.steps) {
      return null;
    }

    return (journey.steps as JourneyStep[])[session.current_step] ?? null;
  }

  async advanceStep(sessionId: string): Promise<{
    nextStep: JourneyStep | null;
    isComplete: boolean;
  }> {
    const session = throwOnError(
      await this.supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle()
    );

    if (!session || !session.journey_id) {
      return { nextStep: null, isComplete: false };
    }

    const journey = throwOnError(
      await this.supabase
        .from('journeys')
        .select('*')
        .eq('id', session.journey_id)
        .maybeSingle()
    );

    if (!journey || !journey.steps) {
      return { nextStep: null, isComplete: false };
    }

    const steps = journey.steps as JourneyStep[];
    const nextStepIndex = session.current_step + 1;

    if (nextStepIndex >= steps.length) {
      // Journey is complete
      throwOnError(
        await this.supabase
          .from('sessions')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            last_active_at: new Date().toISOString(),
          })
          .eq('id', sessionId)
      );

      logger.info(`Session ${sessionId} completed`);
      return { nextStep: null, isComplete: true };
    }

    // Advance to next step
    throwOnError(
      await this.supabase
        .from('sessions')
        .update({
          current_step: nextStepIndex,
          last_active_at: new Date().toISOString(),
        })
        .eq('id', sessionId)
    );

    const nextStep = steps[nextStepIndex] ?? null;
    logger.info(`Session ${sessionId} advanced to step ${nextStepIndex}`);

    return { nextStep, isComplete: false };
  }

  async pauseSession(sessionId: string): Promise<void> {
    throwOnError(
      await this.supabase
        .from('sessions')
        .update({
          status: 'paused',
          last_active_at: new Date().toISOString(),
        })
        .eq('id', sessionId)
    );

    logger.info(`Session ${sessionId} paused`);
  }

  async abandonSession(sessionId: string): Promise<void> {
    throwOnError(
      await this.supabase
        .from('sessions')
        .update({
          status: 'abandoned',
          last_active_at: new Date().toISOString(),
        })
        .eq('id', sessionId)
    );

    logger.info(`Session ${sessionId} abandoned`);
  }

  async getSessionProgress(sessionId: string): Promise<{
    currentStep: number;
    totalSteps: number;
    percentComplete: number;
    checkpointCount: number;
  }> {
    const session = throwOnError(
      await this.supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle()
    );

    if (!session) {
      return {
        currentStep: 0,
        totalSteps: 0,
        percentComplete: 0,
        checkpointCount: 0,
      };
    }

    let totalSteps = 0;
    if (session.journey_id) {
      const journey = throwOnError(
        await this.supabase
          .from('journeys')
          .select('*')
          .eq('id', session.journey_id)
          .maybeSingle()
      );

      if (journey && journey.steps) {
        totalSteps = (journey.steps as unknown[]).length;
      }
    }

    const sessionCheckpoints = throwOnError(
      await this.supabase
        .from('checkpoints')
        .select('id')
        .eq('session_id', sessionId)
    );

    const percentComplete = totalSteps > 0
      ? Math.round((session.current_step / totalSteps) * 100)
      : 0;

    return {
      currentStep: session.current_step,
      totalSteps,
      percentComplete,
      checkpointCount: (sessionCheckpoints ?? []).length,
    };
  }

  async canSkipCurrentStep(sessionId: string): Promise<boolean> {
    const currentStep = await this.getCurrentStep(sessionId);
    return currentStep?.optional ?? false;
  }
}

export const workflowEngine = new WorkflowEngine();
