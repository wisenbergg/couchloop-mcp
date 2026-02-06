import { getDb } from '../db/client.js';
import { sessions, journeys, checkpoints } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { JourneyStep } from '../types/journey.js';
import { logger } from '../utils/logger.js';

export class WorkflowEngine {
  private db = getDb();

  async initializeSession(userId: string, journeyId: string): Promise<string> {
    const sessionResult = await this.db
      .insert(sessions)
      .values({
        userId,
        journeyId,
        status: 'active',
        currentStep: 0,
        metadata: {},
      })
      .returning();

    const session = sessionResult[0]!;
    logger.info(`Initialized session ${session.id} for journey ${journeyId}`);
    return session.id;
  }

  async getCurrentStep(sessionId: string): Promise<JourneyStep | null> {
    const [session] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!session || !session.journeyId) {
      return null;
    }

    const [journey] = await this.db
      .select()
      .from(journeys)
      .where(eq(journeys.id, session.journeyId))
      .limit(1);

    if (!journey || !journey.steps) {
      return null;
    }

    return journey.steps[session.currentStep] ?? null;
  }

  async advanceStep(sessionId: string): Promise<{
    nextStep: JourneyStep | null;
    isComplete: boolean;
  }> {
    const [session] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!session || !session.journeyId) {
      return { nextStep: null, isComplete: false };
    }

    const [journey] = await this.db
      .select()
      .from(journeys)
      .where(eq(journeys.id, session.journeyId))
      .limit(1);

    if (!journey || !journey.steps) {
      return { nextStep: null, isComplete: false };
    }

    const nextStepIndex = session.currentStep + 1;

    if (nextStepIndex >= journey.steps.length) {
      // Journey is complete
      await this.db
        .update(sessions)
        .set({
          status: 'completed',
          completedAt: new Date(),
          lastActiveAt: new Date(),
        })
        .where(eq(sessions.id, sessionId));

      logger.info(`Session ${sessionId} completed`);
      return { nextStep: null, isComplete: true };
    }

    // Advance to next step
    await this.db
      .update(sessions)
      .set({
        currentStep: nextStepIndex,
        lastActiveAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));

    const nextStep = journey.steps[nextStepIndex] ?? null;
    logger.info(`Session ${sessionId} advanced to step ${nextStepIndex}`);

    return { nextStep, isComplete: false };
  }

  async pauseSession(sessionId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({
        status: 'paused',
        lastActiveAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));

    logger.info(`Session ${sessionId} paused`);
  }

  async abandonSession(sessionId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({
        status: 'abandoned',
        lastActiveAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));

    logger.info(`Session ${sessionId} abandoned`);
  }

  async getSessionProgress(sessionId: string): Promise<{
    currentStep: number;
    totalSteps: number;
    percentComplete: number;
    checkpointCount: number;
  }> {
    const [session] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!session) {
      return {
        currentStep: 0,
        totalSteps: 0,
        percentComplete: 0,
        checkpointCount: 0,
      };
    }

    let totalSteps = 0;
    if (session.journeyId) {
      const [journey] = await this.db
        .select()
        .from(journeys)
        .where(eq(journeys.id, session.journeyId))
        .limit(1);

      if (journey && journey.steps) {
        totalSteps = journey.steps.length;
      }
    }

    const sessionCheckpoints = await this.db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.sessionId, sessionId));

    const percentComplete = totalSteps > 0
      ? Math.round((session.currentStep / totalSteps) * 100)
      : 0;

    return {
      currentStep: session.currentStep,
      totalSteps,
      percentComplete,
      checkpointCount: sessionCheckpoints.length,
    };
  }

  async canSkipCurrentStep(sessionId: string): Promise<boolean> {
    const currentStep = await this.getCurrentStep(sessionId);
    return currentStep?.optional ?? false;
  }
}

export const workflowEngine = new WorkflowEngine();