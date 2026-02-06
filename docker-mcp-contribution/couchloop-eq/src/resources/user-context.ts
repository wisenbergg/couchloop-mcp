import { getDb } from '../db/client.js';
import { users, insights, sessions } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { nanoid } from 'nanoid';

export async function getUserContextResource() {
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
        exists: false,
        message: 'User not found',
      }, null, 2);
    }

    // Get recent insights
    const recentInsights = await db
      .select({
        id: insights.id,
        content: insights.content,
        tags: insights.tags,
        created_at: insights.createdAt,
      })
      .from(insights)
      .where(eq(insights.userId, user.id))
      .orderBy(desc(insights.createdAt))
      .limit(5);

    // Get recent sessions
    const recentSessions = await db
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

    // Count total sessions
    const sessionStats = await db
      .select({
        total: eq(sessions.userId, user.id),
      })
      .from(sessions)
      .where(eq(sessions.userId, user.id));

    return JSON.stringify({
      exists: true,
      user: {
        id: user.id,
        created_at: user.createdAt,
        preferences: user.preferences || {},
      },
      stats: {
        total_sessions: sessionStats.length,
        total_insights: recentInsights.length,
      },
      recent_insights: recentInsights,
      recent_sessions: recentSessions,
    }, null, 2);
  } catch (error) {
    logger.error('Error getting user context:', error);
    return JSON.stringify({
      error: 'Failed to get user context',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, null, 2);
  }
}