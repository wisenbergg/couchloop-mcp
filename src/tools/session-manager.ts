/**
 * Session Manager - Handles implicit session creation and lifecycle
 *
 * Sessions are created implicitly on first stateful tool use and remain
 * open until explicitly ended by the user.
 */
import { getSupabaseClient, throwOnError } from '../db/supabase-helpers.js';
import type { Session, User } from '../db/schema.js';
import { extractUserFromContext } from '../types/auth.js';
import { logger } from '../utils/logger.js';

// In-memory cache of current active session per user
// This provides instant lookups without DB queries for subsequent calls
const activeSessionCache = new Map<string, string>();

/**
 * Get existing active session or create one implicitly
 *
 * Returns the full session object to avoid redundant re-fetches by callers.
 *
 * @param sessionId - Optional explicit session ID
 * @param authContext - Optional auth context for user identification
 * @param context - Optional context for new session creation
 * @returns Session object and metadata (existing or newly created)
 */
export async function getOrCreateSession(
  sessionId?: string,
  authContext?: { user_id?: string; client_id?: string; token?: string },
  context?: string
): Promise<{ sessionId: string; session: Session; isNew: boolean }> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();

  // If explicit session ID provided, verify it exists and is active
  if (sessionId) {
    const session = throwOnError(
      await supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle()
    ) as Session | null;

    if (session) {
      // Update last active timestamp (fire-and-forget, non-blocking)
      supabase
        .from('sessions')
        .update({ last_active_at: now })
        .eq('id', sessionId)
        .then(({ error }) => {
          if (error) logger.warn('Failed to update last_active_at:', error);
        });

      return { sessionId: session.id, session, isNew: false };
    }
    // Session ID provided but doesn't exist - fall through to create new
    logger.warn(`Session ${sessionId} not found, creating new session`);
  }

  // Get or create user
  const externalUserId = await extractUserFromContext(authContext);

  // Check cache first
  const cachedSessionId = activeSessionCache.get(externalUserId);
  if (cachedSessionId) {
    // Verify cached session is still valid
    const cachedSession = throwOnError(
      await supabase
        .from('sessions')
        .select('*')
        .eq('id', cachedSessionId)
        .eq('status', 'active')
        .maybeSingle()
    ) as Session | null;

    if (cachedSession) {
      // Fire-and-forget timestamp update
      supabase
        .from('sessions')
        .update({ last_active_at: now })
        .eq('id', cachedSessionId)
        .then(({ error }) => {
          if (error) logger.warn('Failed to update last_active_at:', error);
        });

      return { sessionId: cachedSession.id, session: cachedSession, isNew: false };
    }
    // Cached session no longer valid, remove from cache
    activeSessionCache.delete(externalUserId);
  }

  // Look for existing active session in DB
  const user = throwOnError(
    await supabase
      .from('users')
      .select('*')
      .eq('external_id', externalUserId)
      .maybeSingle()
  ) as User | null;

  if (user) {
    // Check for active session
    const existingSession = throwOnError(
      await supabase
        .from('sessions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('last_active_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ) as Session | null;

    if (existingSession) {
      // Fire-and-forget timestamp update
      supabase
        .from('sessions')
        .update({ last_active_at: now })
        .eq('id', existingSession.id)
        .then(({ error }) => {
          if (error) logger.warn('Failed to update last_active_at:', error);
        });

      activeSessionCache.set(externalUserId, existingSession.id);
      return { sessionId: existingSession.id, session: existingSession, isNew: false };
    }
  }

  // No active session found - create new one implicitly
  let resolvedUser = user;
  if (!resolvedUser) {
    const newUser = throwOnError(
      await supabase
        .from('users')
        .insert({
          external_id: externalUserId,
          preferences: {},
        })
        .select('*')
        .single()
    ) as User;
    resolvedUser = newUser;
  }

  // Create new session
  const newSession = throwOnError(
    await supabase
      .from('sessions')
      .insert({
        user_id: resolvedUser.id,
        journey_id: null,
        status: 'active',
        current_step: 0,
        metadata: {
          context: context || 'Implicit session',
          createdImplicitly: true,
        },
      })
      .select('*')
      .single()
  ) as Session;

  if (!newSession) {
    throw new Error('Failed to create session');
  }

  logger.info(`Implicitly created new session: ${newSession.id}`);

  // Cache the new session
  activeSessionCache.set(externalUserId, newSession.id);

  return { sessionId: newSession.id, session: newSession, isNew: true };
}

/**
 * End the current session explicitly
 */
export async function endSession(
  sessionId?: string,
  authContext?: { user_id?: string; client_id?: string; token?: string }
): Promise<{ success: boolean; message: string }> {
  const supabase = getSupabaseClient();

  let sessionToEnd: string | undefined = sessionId;

  if (!sessionToEnd) {
    // Find active session for user
    const externalUserId = await extractUserFromContext(authContext);

    // Check cache
    sessionToEnd = activeSessionCache.get(externalUserId);

    if (!sessionToEnd) {
      // Check DB
      const user = throwOnError(
        await supabase
          .from('users')
          .select('*')
          .eq('external_id', externalUserId)
          .maybeSingle()
      ) as User | null;

      if (user) {
        const activeSession = throwOnError(
          await supabase
            .from('sessions')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'active')
            .maybeSingle()
        ) as Session | null;

        sessionToEnd = activeSession?.id;
      }
    }
  }

  if (!sessionToEnd) {
    return {
      success: false,
      message: 'No active session to end.'
    };
  }

  const now = new Date().toISOString();

  // End the session
  throwOnError(
    await supabase
      .from('sessions')
      .update({
        status: 'completed',
        completed_at: now,
        last_active_at: now,
      })
      .eq('id', sessionToEnd)
      .select('*')
  );

  // Clear from cache
  for (const [userId, cachedId] of activeSessionCache.entries()) {
    if (cachedId === sessionToEnd) {
      activeSessionCache.delete(userId);
      break;
    }
  }

  logger.info(`Ended session: ${sessionToEnd}`);

  return {
    success: true,
    message: `Session ended successfully.`
  };
}

/**
 * Clear session cache (useful for testing)
 */
export function clearSessionCache(): void {
  activeSessionCache.clear();
}
