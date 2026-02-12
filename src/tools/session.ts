import { getDb } from '../db/client.js';
import { sessions, journeys, users, checkpoints } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { CreateSessionSchema, ResumeSessionSchema } from '../types/session.js';
import { extractUserFromContext } from '../types/auth.js';
import { handleError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export async function createSession(args: unknown) {
  try {
    const input = CreateSessionSchema.parse(args);
    const db = getDb();

    // Extract user ID from auth context or generate anonymous user
    const externalUserId = await extractUserFromContext(input.auth);

    const userResult = await db
      .insert(users)
      .values({
        externalId: externalUserId,
        preferences: {},
      })
      .onConflictDoUpdate({
        target: users.externalId,
        set: { updatedAt: new Date() },
      })
      .returning();

    const user = userResult[0]!;

    // Look up journey if specified
    let journey = null;
    let currentStep = null;
    if (input.journey_slug) {
      const [foundJourney] = await db
        .select()
        .from(journeys)
        .where(eq(journeys.slug, input.journey_slug))
        .limit(1);

      if (!foundJourney) {
        throw new NotFoundError('Journey with slug', input.journey_slug);
      }

      journey = foundJourney;
      // Get first step
      if (journey.steps && journey.steps.length > 0) {
        currentStep = journey.steps[0];
      }
    }

    // Create new session
    const sessionResult = await db
      .insert(sessions)
      .values({
        userId: user.id,
        journeyId: journey?.id || null,
        status: 'active',
        currentStep: 0,
        metadata: { context: input.context },
      })
      .returning();

    const session = sessionResult[0]!;

    logger.info(`Created new session: ${session.id}`);

    return {
      session_id: session.id,
      journey: journey,
      current_step: currentStep,
      message: journey
        ? `Started ${journey.name}. ${currentStep?.content?.prompt || ''}`
        : 'Started freeform session.',
    };
  } catch (error) {
    logger.error('Error creating session:', error);
    return handleError(error);
  }
}

export async function resumeSession(args: unknown) {
  try {
    const input = ResumeSessionSchema.parse(args);
    const db = getDb();

    // Find session to resume
    let session;

    if (input.session_id) {
      // Direct session lookup - skip user validation
      // This allows resuming sessions when MCP clients don't maintain consistent user context
      [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.session_id))
        .limit(1);

      if (!session) {
        throw new NotFoundError('Session with ID', input.session_id);
      }
    } else {
      // Resume most recent session - requires user context
      // Extract user ID from auth context or generate anonymous user
      const externalUserId = await extractUserFromContext(input.auth);
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.externalId, externalUserId))
        .limit(1);

      if (!user) {
        // Create user if doesn't exist
        const [newUser] = await db
          .insert(users)
          .values({
            externalId: externalUserId,
            preferences: {},
          })
          .returning();

        if (!newUser) {
          throw new NotFoundError('User');
        }
        return {
          message: 'No previous sessions found for this user. Please create a new session.',
          session: null,
        };
      }

      // Get most recent pausable session for this user
      [session] = await db
        .select()
        .from(sessions)
        .where(and(
          eq(sessions.userId, user.id),
          eq(sessions.status, 'paused')
        ))
        .orderBy(desc(sessions.lastActiveAt))
        .limit(1);

      if (!session) {
        throw new NotFoundError('Session to resume for user');
      }
    }

    // Get journey if linked
    let journey = null;
    let currentStep = null;
    if (session.journeyId) {
      [journey] = await db
        .select()
        .from(journeys)
        .where(eq(journeys.id, session.journeyId))
        .limit(1);

      if (journey && journey.steps && journey.steps[session.currentStep]) {
        currentStep = journey.steps[session.currentStep];
      }
    }

    // Get existing checkpoints
    const existingCheckpoints = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.sessionId, session.id))
      .orderBy(checkpoints.createdAt);

    // Update session status to active
    await db
      .update(sessions)
      .set({
        status: 'active',
        lastActiveAt: new Date(),
      })
      .where(eq(sessions.id, session.id));

    logger.info(`Resumed session: ${session.id}`);

    return {
      session: session,
      journey: journey,
      current_step: currentStep,
      checkpoints: existingCheckpoints,
      message: `Resumed session. ${currentStep?.content?.prompt || 'Continue where you left off.'}`,
    };
  } catch (error) {
    logger.error('Error resuming session:', error);
    return handleError(error);
  }
}