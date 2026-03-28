import { getSupabaseClient, throwOnError } from '../db/supabase-helpers.js';
import { logger } from '../utils/logger.js';
import { nanoid } from 'nanoid';

export async function getUserContextResource() {
  try {
    const supabase = getSupabaseClient();

    // NOTE: Resources in MCP don't receive parameters, so we can't pass auth context.
    // Using a mock user ID for now. This will be addressed when we implement
    // a proper session store or modify the MCP server to maintain user context.
    const mockUserId = 'usr_' + nanoid();
    const user = throwOnError(
      await supabase
        .from('users')
        .select('*')
        .eq('external_id', mockUserId)
        .maybeSingle()
    );

    if (!user) {
      return JSON.stringify({
        exists: false,
        message: 'User not found',
      }, null, 2);
    }

    // Get recent insights
    const recentInsights = throwOnError(
      await supabase
        .from('insights')
        .select('id, content, tags, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5)
    );

    // Get recent sessions
    const recentSessions = throwOnError(
      await supabase
        .from('sessions')
        .select('id, status, started_at, completed_at, journey_id')
        .eq('user_id', user.id)
        .order('started_at', { ascending: false })
        .limit(5)
    );

    // Count total sessions
    const sessionStats = throwOnError(
      await supabase
        .from('sessions')
        .select('id')
        .eq('user_id', user.id)
    );

    return JSON.stringify({
      exists: true,
      user: {
        id: user.id,
        created_at: user.created_at,
        preferences: user.preferences || {},
      },
      stats: {
        total_sessions: (sessionStats ?? []).length,
        total_insights: (recentInsights ?? []).length,
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
