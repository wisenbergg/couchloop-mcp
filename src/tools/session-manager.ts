/**
 * Session Manager - Handles implicit session creation and lifecycle
 * 
 * Sessions are created implicitly on first stateful tool use and remain
 * open until explicitly ended by the user.
 */
import { getDb } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { extractUserFromContext } from '../types/auth.js';
import { logger } from '../utils/logger.js';

// In-memory cache of current active session per user
// This provides instant lookups without DB queries for subsequent calls
const activeSessionCache = new Map<string, string>();

/**
 * Get existing active session or create one implicitly
 * 
 * @param sessionId - Optional explicit session ID
 * @param authContext - Optional auth context for user identification
 * @param context - Optional context for new session creation
 * @returns Session ID (existing or newly created)
 */
export async function getOrCreateSession(
  sessionId?: string,
  authContext?: { user_id?: string; client_id?: string; token?: string },
  context?: string
): Promise<{ sessionId: string; isNew: boolean }> {
  const db = getDb();
  
  // If explicit session ID provided, verify it exists and is active
  if (sessionId) {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    
    if (session) {
      // Update last active timestamp
      await db
        .update(sessions)
        .set({ lastActiveAt: new Date() })
        .where(eq(sessions.id, sessionId));
      
      return { sessionId: session.id, isNew: false };
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
    const [cachedSession] = await db
      .select()
      .from(sessions)
      .where(and(
        eq(sessions.id, cachedSessionId),
        eq(sessions.status, 'active')
      ))
      .limit(1);
    
    if (cachedSession) {
      await db
        .update(sessions)
        .set({ lastActiveAt: new Date() })
        .where(eq(sessions.id, cachedSessionId));
      
      return { sessionId: cachedSession.id, isNew: false };
    }
    // Cached session no longer valid, remove from cache
    activeSessionCache.delete(externalUserId);
  }
  
  // Look for existing active session in DB
  const userResult = await db
    .select()
    .from(users)
    .where(eq(users.externalId, externalUserId))
    .limit(1);
  
  let user = userResult[0];
  
  if (user) {
    // Check for active session
    const [existingSession] = await db
      .select()
      .from(sessions)
      .where(and(
        eq(sessions.userId, user.id),
        eq(sessions.status, 'active')
      ))
      .orderBy(desc(sessions.lastActiveAt))
      .limit(1);
    
    if (existingSession) {
      // Update last active and cache
      await db
        .update(sessions)
        .set({ lastActiveAt: new Date() })
        .where(eq(sessions.id, existingSession.id));
      
      activeSessionCache.set(externalUserId, existingSession.id);
      return { sessionId: existingSession.id, isNew: false };
    }
  }
  
  // No active session found - create new one implicitly
  if (!user) {
    const [newUser] = await db
      .insert(users)
      .values({
        externalId: externalUserId,
        preferences: {},
      })
      .returning();
    user = newUser;
  }
  
  // Create new session
  const [newSession] = await db
    .insert(sessions)
    .values({
      userId: user!.id,
      journeyId: null,
      status: 'active',
      currentStep: 0,
      metadata: { 
        context: context || 'Implicit session',
        createdImplicitly: true,
      },
    })
    .returning();
  
  if (!newSession) {
    throw new Error('Failed to create session');
  }
  
  logger.info(`Implicitly created new session: ${newSession.id}`);
  
  // Cache the new session
  activeSessionCache.set(externalUserId, newSession.id);
  
  return { sessionId: newSession.id, isNew: true };
}

/**
 * End the current session explicitly
 */
export async function endSession(
  sessionId?: string,
  authContext?: { user_id?: string; client_id?: string; token?: string }
): Promise<{ success: boolean; message: string }> {
  const db = getDb();
  
  let sessionToEnd: string | undefined = sessionId;
  
  if (!sessionToEnd) {
    // Find active session for user
    const externalUserId = await extractUserFromContext(authContext);
    
    // Check cache
    sessionToEnd = activeSessionCache.get(externalUserId);
    
    if (!sessionToEnd) {
      // Check DB
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.externalId, externalUserId))
        .limit(1);
      
      if (user) {
        const [activeSession] = await db
          .select()
          .from(sessions)
          .where(and(
            eq(sessions.userId, user.id),
            eq(sessions.status, 'active')
          ))
          .limit(1);
        
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
  
  // End the session
  await db
    .update(sessions)
    .set({
      status: 'completed',
      completedAt: new Date(),
      lastActiveAt: new Date(),
    })
    .where(eq(sessions.id, sessionToEnd));
  
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
