import { getDb } from '../db/client.js';
import { sessions, journeys, checkpoints } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { ListJourneysSchema, GetJourneyStatusSchema } from '../types/journey.js';
import { handleError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export async function listJourneys(args: unknown) {
  try {
    const input = ListJourneysSchema.parse(args);
    const db = getDb();

    // Query journeys
    let availableJourneys;

    // Filter by tag if provided
    if (input.tag) {
      // Use SQL array contains operator for PostgreSQL
      availableJourneys = await db
        .select()
        .from(journeys)
        .where(sql`${input.tag} = ANY(${journeys.tags})`);
    } else {
      availableJourneys = await db
        .select()
        .from(journeys);
    }

    return {
      journeys: availableJourneys.map(j => ({
        id: j.id,
        slug: j.slug,
        name: j.name,
        description: j.description,
        estimated_minutes: j.estimatedMinutes,
        tags: j.tags,
        step_count: j.steps?.length || 0,
      })),
      count: availableJourneys.length,
    };
  } catch (error) {
    logger.error('Error listing journeys:', error);
    return handleError(error);
  }
}

export async function getJourneyStatus(args: unknown) {
  try {
    const input = GetJourneyStatusSchema.parse(args);
    const db = getDb();

    // Get session
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, input.session_id))
      .limit(1);

    if (!session) {
      throw new NotFoundError('Session', input.session_id);
    }

    // Get journey if linked
    let journey = null;
    const progress = {
      current_step: session.currentStep,
      total_steps: 0,
      percent_complete: 0,
    };

    if (session.journeyId) {
      [journey] = await db
        .select()
        .from(journeys)
        .where(eq(journeys.id, session.journeyId))
        .limit(1);

      if (journey && journey.steps) {
        progress.total_steps = journey.steps.length;
        progress.percent_complete = journey.steps.length > 0
          ? Math.round((session.currentStep / journey.steps.length) * 100)
          : 0;
      }
    }

    // Get checkpoints
    const sessionCheckpoints = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.sessionId, session.id))
      .orderBy(checkpoints.createdAt);

    // Calculate time elapsed
    const startTime = new Date(session.startedAt).getTime();
    const currentTime = Date.now();
    const timeElapsedMinutes = Math.round((currentTime - startTime) / (1000 * 60));

    return {
      session: {
        id: session.id,
        status: session.status,
        started_at: session.startedAt,
        last_active_at: session.lastActiveAt,
        completed_at: session.completedAt,
      },
      journey: journey ? {
        id: journey.id,
        name: journey.name,
        slug: journey.slug,
        estimated_minutes: journey.estimatedMinutes,
      } : null,
      progress: progress,
      checkpoints: sessionCheckpoints.map(c => ({
        id: c.id,
        key: c.key,
        created_at: c.createdAt,
      })),
      time_elapsed_minutes: timeElapsedMinutes,
    };
  } catch (error) {
    logger.error('Error getting journey status:', error);
    return handleError(error);
  }
}