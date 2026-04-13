import { getSupabaseClient, throwOnError } from '../db/supabase-helpers.js';
import type { Insight } from '../db/schema.js';
import { SaveInsightSchema, GetUserContextSchema, type SaveInsightInput, type GetUserContextInput } from '../types/insight.js';
import { extractUserFromContext } from '../types/auth.js';
import { handleError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

// Types for getUserContext response
export interface RecentSession {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  journey_id: string | null;
}

export async function saveInsight(args: SaveInsightInput) {
  try {
    const input = SaveInsightSchema.parse(args);
    const supabase = getSupabaseClient();

    // Extract user ID from auth context or generate anonymous user
    const externalUserId = await extractUserFromContext(input.auth);
    const user = throwOnError(
      await supabase
        .from('users')
        .upsert(
          {
            external_id: externalUserId,
            preferences: {},
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'external_id' }
        )
        .select()
        .single()
    );

    // Verify session if provided
    if (input.session_id) {
      const session = throwOnError(
        await supabase
          .from('sessions')
          .select('*')
          .eq('id', input.session_id)
          .eq('user_id', user.id)
          .maybeSingle()
      );

      if (!session) {
        throw new NotFoundError('Session', input.session_id);
      }
    }

    // Save insight
    const insight = throwOnError(
      await supabase
        .from('insights')
        .insert({
          user_id: user.id,
          session_id: input.session_id || null,
          content: input.content,
          tags: input.tags || [],
        })
        .select()
        .single()
    );

    logger.info(`Saved insight: ${insight.id}`);

    // Return sanitized response (no internal IDs)
    return {
      success: true,
      message: 'Insight captured successfully.',
    };
  } catch (error) {
    logger.error('Error saving insight:', error);
    return handleError(error);
  }
}

export async function getInsights(args: { session_id?: string; limit?: number; auth?: Record<string, unknown> }) {
  try {
    const { session_id, limit = 10, auth } = args;
    const supabase = getSupabaseClient();

    // Extract user ID from auth context or generate anonymous user
    const externalUserId = await extractUserFromContext(auth);
    const user = throwOnError(
      await supabase
        .from('users')
        .select('*')
        .eq('external_id', externalUserId)
        .maybeSingle()
    );

    if (!user) {
      // Create user if doesn't exist
      const newUser = throwOnError(
        await supabase
          .from('users')
          .insert({
            external_id: externalUserId,
            preferences: {},
          })
          .select()
          .single()
      );

      if (!newUser) {
        throw new NotFoundError('User');
      }
      return {
        insights: [],
        count: 0,
      };
    }

    let query = supabase
      .from('insights')
      .select('content, tags, category, created_at, session_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (session_id) {
      query = query.eq('session_id', session_id);
    }

    const userInsights = throwOnError(await query);

    return {
      insights: userInsights ?? [],
      count: (userInsights ?? []).length,
    };
  } catch (error) {
    logger.error('Error getting insights:', error);
    return handleError(error);
  }
}

export async function getUserContext(args: GetUserContextInput) {
  try {
    const input = GetUserContextSchema.parse(args);
    const supabase = getSupabaseClient();

    // Extract user ID from auth context or generate anonymous user
    const externalUserId = await extractUserFromContext(input.auth);
    const user = throwOnError(
      await supabase
        .from('users')
        .select('*')
        .eq('external_id', externalUserId)
        .maybeSingle()
    );

    if (!user) {
      // Create user if doesn't exist
      const newUser = throwOnError(
        await supabase
          .from('users')
          .insert({
            external_id: externalUserId,
            preferences: {},
          })
          .select()
          .single()
      );

      return {
        user: newUser,
        recent_insights: [],
        recent_sessions: [],
        active_session: null,
      };
    }

    // Get recent insights if requested
    let recentInsights: Insight[] = [];
    if (input.include_recent_insights) {
      recentInsights = throwOnError(
        await supabase
          .from('insights')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5)
      ) ?? [];
    }

    // Get recent sessions if requested
    let recentSessions: RecentSession[] = [];
    if (input.include_session_history) {
      recentSessions = throwOnError(
        await supabase
          .from('sessions')
          .select('id, status, started_at, completed_at, journey_id')
          .eq('user_id', user.id)
          .order('started_at', { ascending: false })
          .limit(5)
      ) ?? [];
    }

    // Get active session
    const activeSession = throwOnError(
      await supabase
        .from('sessions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('last_active_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    );

    return {
      user: {
        id: user.id,
        preferences: user.preferences,
        created_at: user.created_at,
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

/**
 * recallInsights — relevance-ranked recall for the memory tool.
 *
 * Priority order:
 *   1. High-signal tags: constraint, decision, ai-mistake (always surfaced first)
 *   2. Query match: ilike on content when a search term is provided
 *   3. Recent: everything else, newest first
 *
 * Returns at most `limit` items total, deduplicated by id.
 */
export async function recallInsights(args: {
  query?: string;
  session_id?: string;
  limit?: number;
  auth?: Record<string, unknown>;
}): Promise<{ insights: Pick<Insight, 'content' | 'tags' | 'created_at'>[]; count: number }> {
  const { query, session_id, limit = 5, auth } = args;

  try {
    const supabase = getSupabaseClient();
    const externalUserId = await extractUserFromContext(auth);
    const user = throwOnError(
      await supabase
        .from('users')
        .select('id')
        .eq('external_id', externalUserId)
        .maybeSingle()
    );

    if (!user) {
      return { insights: [], count: 0 };
    }

    // Tier 1: high-signal constraints and decisions
    let priorityQuery = supabase
      .from('insights')
      .select('content, tags, created_at')
      .eq('user_id', user.id)
      .overlaps('tags', ['constraint', 'decision', 'ai-mistake'])
      .order('created_at', { ascending: false })
      .limit(limit);
    if (session_id) {
      priorityQuery = priorityQuery.eq('session_id', session_id);
    }
    const priorityItems = (throwOnError(await priorityQuery) ?? []) as Pick<Insight, 'content' | 'tags' | 'created_at'>[];

    // Tier 2: query match (ilike on content) when a search term is provided
    let queryItems: Pick<Insight, 'content' | 'tags' | 'created_at'>[] = [];
    if (query) {
      let contentQuery = supabase
        .from('insights')
        .select('content, tags, created_at')
        .eq('user_id', user.id)
        .ilike('content', `%${query}%`)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (session_id) {
        contentQuery = contentQuery.eq('session_id', session_id);
      }
      queryItems = (throwOnError(await contentQuery) ?? []) as Pick<Insight, 'content' | 'tags' | 'created_at'>[];
    }

    // Tier 3: recent items
    let recentQuery = supabase
      .from('insights')
      .select('content, tags, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (session_id) {
      recentQuery = recentQuery.eq('session_id', session_id);
    }
    const recentItems = (throwOnError(await recentQuery) ?? []) as Pick<Insight, 'content' | 'tags' | 'created_at'>[];

    // Merge: priority first, then query matches, then recent — deduplicate by content+date
    const seen = new Set<string>();
    const merged: Pick<Insight, 'content' | 'tags' | 'created_at'>[] = [];

    for (const item of [...priorityItems, ...queryItems, ...recentItems]) {
      const key = `${item.content}|${item.created_at}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
      if (merged.length >= limit) break;
    }

    return { insights: merged, count: merged.length };
  } catch (error) {
    logger.error('Error recalling insights:', error);
    return { insights: [], count: 0 };
  }
}
