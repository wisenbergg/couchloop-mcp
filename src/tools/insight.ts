import { getDb } from '../db/client.js';
import { insights, users, sessions } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { SaveInsightSchema, GetUserContextSchema } from '../types/insight.js';
import { extractUserFromContext } from '../types/auth.js';
import { handleError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export async function saveInsight(args: any) {
  try {
    const input = SaveInsightSchema.parse(args);
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

    // Verify session if provided
    if (input.session_id) {
      const [session] = await db
        .select()
        .from(sessions)
        .where(and(
          eq(sessions.id, input.session_id),
          eq(sessions.userId, user.id)
        ))
        .limit(1);

      if (!session) {
        throw new NotFoundError('Session', input.session_id);
      }
    }

    // Save insight
    const insightResult = await db
      .insert(insights)
      .values({
        userId: user.id,
        sessionId: input.session_id || null,
        content: input.content,
        tags: input.tags || [],
      })
      .returning();

    const insight = insightResult[0]!;

    logger.info(`Saved insight: ${insight.id}`);

    return {
      insight_id: insight.id,
      message: 'Insight captured successfully.',
    };
  } catch (error) {
    logger.error('Error saving insight:', error);
    return handleError(error);
  }
}

export async function getInsights(args: any) {
  try {
    const { session_id, limit = 10, auth } = args;
    const db = getDb();

    // Extract user ID from auth context or generate anonymous user
    const externalUserId = await extractUserFromContext(auth);
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
        insights: [],
        count: 0,
      };
    }

    let userInsights;

    if (session_id) {
      userInsights = await db
        .select()
        .from(insights)
        .where(and(
          eq(insights.userId, user.id),
          eq(insights.sessionId, session_id)
        ))
        .orderBy(desc(insights.createdAt))
        .limit(limit);
    } else {
      userInsights = await db
        .select()
        .from(insights)
        .where(eq(insights.userId, user.id))
        .orderBy(desc(insights.createdAt))
        .limit(limit);
    }

    return {
      insights: userInsights,
      count: userInsights.length,
    };
  } catch (error) {
    logger.error('Error getting insights:', error);
    return handleError(error);
  }
}

export async function getUserContext(args: any) {
  try {
    const input = GetUserContextSchema.parse(args);
    const db = getDb();

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

      return {
        user: newUser,
        recent_insights: [],
        recent_sessions: [],
        active_session: null,
      };
    }

    // Get recent insights if requested
    let recentInsights: any[] = [];
    if (input.include_recent_insights) {
      recentInsights = await db
        .select()
        .from(insights)
        .where(eq(insights.userId, user.id))
        .orderBy(desc(insights.createdAt))
        .limit(5);
    }

    // Get recent sessions if requested
    let recentSessions: any[] = [];
    if (input.include_session_history) {
      recentSessions = await db
        .select({
          id: sessions.id,
          status: sessions.status,
          started_at: sessions.startedAt,
          completed_at: sessions.completedAt,
          journey_id: sessions.journeyId,
        })
        .from(sessions)
        .where(eq(sessions.userId, user.id))
        .orderBy(desc(sessions.startedAt))
        .limit(5);
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

    return {
      user: {
        id: user.id,
        preferences: user.preferences,
        created_at: user.createdAt,
      },
      recent_insights: recentInsights,
      recent_sessions: recentSessions,
      active_session: activeSession,
    };
  } catch (error) {
    logger.error('Error getting user context:', error);
    return handleError(error);
  }
}