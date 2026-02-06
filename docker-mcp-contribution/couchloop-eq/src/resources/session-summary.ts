import { getDb } from '../db/client.js';
import { sessions, journeys, checkpoints, users } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { nanoid } from 'nanoid';

export async function getSessionSummary() {
  try {
    const db = getDb();

    // NOTE: Resources in MCP don't receive parameters, so we can't pass auth context.
    // Using a mock user ID for now. This will be addressed when we implement
    // a proper session store or modify the MCP server to maintain user context.
    const mockUserId = 'usr_' + nanoid();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.externalId, mockUserId))
      .limit(1);

    if (!user) {
      return JSON.stringify({
        active: false,
        message: 'No user found',
      }, null, 2);
    }

    // Get active session
    const [activeSession] = await db
      .select()
      .from(sessions)
      .where(and(
        eq(sessions.userId, user.id),
        eq(sessions.status, 'active')
      ))
      .orderBy(desc(sessions.lastActiveAt))
      .limit(1);

    if (!activeSession) {
      return JSON.stringify({
        active: false,
        message: 'No active session',
      }, null, 2);
    }

    // Get journey if linked
    let journey = null;
    let currentStep = null;
    if (activeSession.journeyId) {
      [journey] = await db
        .select()
        .from(journeys)
        .where(eq(journeys.id, activeSession.journeyId))
        .limit(1);

      if (journey && journey.steps && journey.steps[activeSession.currentStep]) {
        currentStep = journey.steps[activeSession.currentStep];
      }
    }

    // Get checkpoints
    const sessionCheckpoints = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.sessionId, activeSession.id))
      .orderBy(checkpoints.createdAt);

    return JSON.stringify({
      active: true,
      session: {
        id: activeSession.id,
        status: activeSession.status,
        started_at: activeSession.startedAt,
        last_active_at: activeSession.lastActiveAt,
        current_step_index: activeSession.currentStep,
      },
      journey: journey ? {
        name: journey.name,
        slug: journey.slug,
        total_steps: journey.steps?.length || 0,
      } : null,
      current_step: currentStep,
      checkpoints: sessionCheckpoints.map(c => ({
        key: c.key,
        created_at: c.createdAt,
      })),
    }, null, 2);
  } catch (error) {
    logger.error('Error getting session summary:', error);
    return JSON.stringify({
      error: 'Failed to get session summary',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, null, 2);
  }
}