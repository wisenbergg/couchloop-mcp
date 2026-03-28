/**
 * MCP Tool: status
 *
 * Dashboard and quick status checks for session, history, context, protection, and preferences.
 * Provides personalized status with actionable next steps.
 *
 * SECURITY: All database queries (sessions, checkpoints, insights) are scoped
 * to the authenticated user. Context and protection checks use machine-local
 * storage and are not user-scoped.
 */

import { z } from 'zod';
import { getSupabaseClient, throwOnError } from '../db/supabase-helpers.js';
import { WorkflowEngine } from '../workflows/engine.js';
import { getContextManager } from '../developer/managers/context-manager.js';
import { ContextMetadata, ContextEntry } from '../types/context.js';
import { getProtectionStatus, listBackups } from './protect-files.js';
import { getUserContext } from './insight.js';
import { extractUserFromContext, type AuthContext } from '../types/auth.js';
import { logger } from '../utils/logger.js';

const StatusInputSchema = z.object({
  check: z.enum(['session', 'history', 'context', 'protection', 'preferences', 'all']).describe('What to check'),
  session_id: z.string().optional().describe('Session ID for session-specific status'),
  auth: z.record(z.unknown()).optional().describe('Authentication context'),
});

export type StatusInput = z.infer<typeof StatusInputSchema>;

export const statusTool = {
  definition: {
    name: 'status',
    description: `System dashboard — session progress, history summaries, context usage, protection status, and preferences. Use for high-level overviews and summaries, NOT for retrieving specific stored insights or decisions (use remember with action recall for that). Triggers: "how am I doing", "what's my progress", "show my history", "dashboard", "overview", "my settings", "context window", "backup status", "what do you know about me". Returns personalized status with actionable next steps.`,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        check: {
          type: 'string',
          enum: ['session', 'history', 'context', 'protection', 'preferences', 'all'],
          description: "'session': current progress, time elapsed, checkpoints. 'history': recent sessions, insights, patterns. 'context': stored decisions, constraints, window usage. 'protection': backup status, freeze mode. 'preferences': timezone, journey length. 'all': full dashboard.",
        },
        session_id: {
          type: 'string',
          description: 'Session ID for session-specific status',
        },
      },
      required: ['check'],
    },
  },

  handler: handleStatus,
};

// ============================================================
// USER RESOLUTION (single point of entry for all status queries)
// ============================================================

/**
 * Resolve the calling user's internal UUID from auth context.
 * Returns null if user has never interacted with the system.
 * This is the ONLY function that touches the users table — all
 * downstream queries receive an already-validated userId.
 */
async function resolveUserId(authContext?: AuthContext): Promise<string | null> {
  const supabase = getSupabaseClient();
  const externalId = await extractUserFromContext(authContext);

  const user = throwOnError(
    await supabase
      .from('users')
      .select('id')
      .eq('external_id', externalId)
      .maybeSingle()
  );

  return user?.id ?? null;
}

export async function handleStatus(args: unknown) {
  try {
    const input = StatusInputSchema.parse(args);

    logger.info('Running status check', { check: input.check });

    // Resolve the calling user ONCE — all queries scope to this userId
    const userId = await resolveUserId(input.auth as AuthContext | undefined);

    if (!userId) {
      return {
        success: true,
        check: input.check,
        timestamp: new Date().toISOString(),
        summary: 'No user data found. Start a session or save a memory to get started.',
        next_steps: ['Start your first session with "start a reflection" or "let\'s begin"'],
      };
    }

    const result: StatusResult = {
      check: input.check,
      timestamp: new Date().toISOString(),
    };

    // Run appropriate checks based on type — all scoped to userId
    if (input.check === 'session' || input.check === 'all') {
      result.session = await getSessionStatus(userId, input.session_id);
    }

    if (input.check === 'history' || input.check === 'all') {
      result.history = await getHistoryStatus(userId);
    }

    if (input.check === 'context' || input.check === 'all') {
      result.context = await getContextStatus();
    }

    if (input.check === 'protection' || input.check === 'all') {
      result.protection = await getProtectionStatusSummary();
    }

    if (input.check === 'preferences' || input.check === 'all') {
      result.preferences = await getPreferencesStatus(input.auth as AuthContext | undefined);
    }

    // Generate personalized summary and next steps
    result.summary = generateSummary(result);
    result.next_steps = generateNextSteps(result);

    return {
      success: true,
      ...result,
    };
  } catch (error) {
    logger.error('Error in status:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================
// SESSION STATUS
// ============================================================

interface SessionStatus {
  has_active_session: boolean;
  session_id?: string;
  journey_name?: string;
  current_step?: number;
  total_steps?: number;
  percent_complete?: number;
  checkpoints_saved: number;
  time_elapsed_minutes?: number;
  started_at?: string;
  last_activity?: string;
  status?: string;
}

async function getSessionStatus(userId: string, sessionId?: string): Promise<SessionStatus> {
  try {
    const supabase = getSupabaseClient();

    let session;

    if (sessionId) {
      // Explicit session lookup — MUST belong to this user
      session = throwOnError(
        await supabase
          .from('sessions')
          .select('*')
          .eq('id', sessionId)
          .eq('user_id', userId)
          .maybeSingle()
      );
    } else {
      // Most recent active session FOR THIS USER
      session = throwOnError(
        await supabase
          .from('sessions')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'active')
          .order('last_active_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      );
    }

    if (!session) {
      return {
        has_active_session: false,
        checkpoints_saved: 0,
      };
    }

    // Get progress
    const engine = new WorkflowEngine();
    const progress = await engine.getSessionProgress(session.id);

    // Get checkpoint count (session is already user-scoped, but checkpoints
    // are keyed by sessionId which is user-owned)
    const sessionCheckpoints = throwOnError(
      await supabase
        .from('checkpoints')
        .select('*')
        .eq('session_id', session.id)
    );

    // Calculate time elapsed
    // Supabase returns ISO strings, not Date objects
    const startTime = new Date(session.started_at);
    const now = new Date();
    const timeElapsedMinutes = Math.round((now.getTime() - startTime.getTime()) / 60000);

    return {
      has_active_session: true,
      session_id: session.id,
      journey_name: session.journey_id || undefined,
      current_step: progress.currentStep,
      total_steps: progress.totalSteps,
      percent_complete: progress.percentComplete,
      checkpoints_saved: (sessionCheckpoints ?? []).length,
      time_elapsed_minutes: timeElapsedMinutes,
      started_at: session.started_at,
      last_activity: session.last_active_at ?? undefined,
      status: session.status,
    };
  } catch (error) {
    logger.error('Error getting session status:', error);
    return {
      has_active_session: false,
      checkpoints_saved: 0,
    };
  }
}

// ============================================================
// HISTORY STATUS
// ============================================================

interface HistoryStatus {
  recent_sessions: Array<{
    id: string;
    journey?: string;
    status: string;
    started_at: string;
  }>;
  total_sessions: number;
  total_insights: number;
  recent_insights: Array<{
    content: string;
    tags?: string[];
    created_at: string;
  }>;
  patterns_detected: string[];
}

async function getHistoryStatus(userId: string): Promise<HistoryStatus> {
  try {
    const supabase = getSupabaseClient();

    // All queries scoped to this user's data only

    const recentSessions = throwOnError(
      await supabase
        .from('sessions')
        .select('*')
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(5)
    );

    const sessionCountResult = await supabase
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (sessionCountResult.error) throw new Error(sessionCountResult.error.message);
    const sessionCount = sessionCountResult.count ?? 0;

    const recentInsights = throwOnError(
      await supabase
        .from('insights')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5)
    );

    // Tags query also scoped to this user
    const allInsightTags = throwOnError(
      await supabase
        .from('insights')
        .select('tags')
        .eq('user_id', userId)
    );
    const safeInsightTags = allInsightTags ?? [];
    const insightCount = safeInsightTags.length;

    // Detect patterns from insight tags
    const tagCounts: Record<string, number> = {};
    for (const insight of safeInsightTags) {
      const tags = insight.tags as string[] | null;
      if (tags) {
        for (const tag of tags) {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }
    }

    // Find recurring patterns (tags that appear 3+ times)
    const patterns = Object.entries(tagCounts)
      .filter(([, cnt]) => cnt >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, cnt]) => `${tag} (${cnt} occurrences)`);

    return {
      recent_sessions: (recentSessions ?? []).map((s: Record<string, unknown>) => ({
        id: s.id as string,
        journey: (s.journey_id as string) || undefined,
        status: s.status as string,
        started_at: s.started_at as string,
      })),
      total_sessions: sessionCount ?? 0,
      total_insights: insightCount,
      recent_insights: (recentInsights ?? []).map((i: Record<string, unknown>) => ({
        content: (i.content as string).substring(0, 100) + ((i.content as string).length > 100 ? '...' : ''),
        tags: i.tags as string[] | undefined,
        created_at: i.created_at as string,
      })),
      patterns_detected: patterns,
    };
  } catch (error) {
    logger.error('Error getting history status:', error);
    return {
      recent_sessions: [],
      total_sessions: 0,
      total_insights: 0,
      recent_insights: [],
      patterns_detected: [],
    };
  }
}

// ============================================================
// CONTEXT STATUS
// ============================================================

interface ContextStatus {
  context_window_usage_percent: number;
  entries_by_category: Record<string, number>;
  total_entries: number;
  recent_decisions: string[];
  recent_constraints: string[];
  stored_patterns: string[];
  warning?: string;
}

async function getContextStatus(): Promise<ContextStatus> {
  try {
    const contextManager = await getContextManager();
    const checkResult = await contextManager.check(true);

    const metadata = (checkResult.data || {}) as ContextMetadata;
    const entries = await contextManager.retrieve();

    const allEntries = (Array.isArray(entries.data) ? entries.data : []) as ContextEntry[];

    // Categorize entries
    const entriesByCategory: Record<string, number> = {};
    const recentDecisions: string[] = [];
    const recentConstraints: string[] = [];
    const storedPatterns: string[] = [];

    for (const entry of allEntries as Array<{ category: string; content: string }>) {
      entriesByCategory[entry.category] = (entriesByCategory[entry.category] || 0) + 1;

      if (entry.category === 'decision') {
        recentDecisions.push(entry.content.substring(0, 80));
      } else if (entry.category === 'constraint') {
        recentConstraints.push(entry.content.substring(0, 80));
      } else if (entry.category === 'pattern') {
        storedPatterns.push(entry.content.substring(0, 80));
      }
    }

    return {
      context_window_usage_percent: metadata.context_window_usage_percent || 0,
      entries_by_category: entriesByCategory,
      total_entries: allEntries.length,
      recent_decisions: recentDecisions.slice(0, 3),
      recent_constraints: recentConstraints.slice(0, 3),
      stored_patterns: storedPatterns.slice(0, 3),
      warning: metadata.context_window_usage_percent > 80
        ? 'Context window is getting full. Consider archiving old entries.'
        : undefined,
    };
  } catch (error) {
    logger.error('Error getting context status:', error);
    return {
      context_window_usage_percent: 0,
      entries_by_category: {},
      total_entries: 0,
      recent_decisions: [],
      recent_constraints: [],
      stored_patterns: [],
    };
  }
}

// ============================================================
// PROTECTION STATUS
// ============================================================

interface ProtectionStatus {
  code_freeze_enabled: boolean;
  total_backups: number;
  recent_backups: Array<{
    file: string;
    created_at: string;
  }>;
  protected_files: number;
  disk_usage_mb?: number;
}

async function getProtectionStatusSummary(): Promise<ProtectionStatus> {
  try {
    const status = await getProtectionStatus({});
    const backups = await listBackups({});

    const backupList = Array.isArray(backups) ? backups : (backups as { backups?: unknown[] }).backups || [];

    return {
      code_freeze_enabled: (status as { codeFreezeEnabled?: boolean }).codeFreezeEnabled || false,
      total_backups: backupList.length,
      recent_backups: (backupList as Array<{ path?: string; filePath?: string; createdAt?: string }>)
        .slice(0, 3)
        .map(b => ({
          file: b.path || b.filePath || 'unknown',
          created_at: b.createdAt || 'unknown',
        })),
      protected_files: (status as { protectedFiles?: number }).protectedFiles || 0,
    };
  } catch (error) {
    logger.error('Error getting protection status:', error);
    return {
      code_freeze_enabled: false,
      total_backups: 0,
      recent_backups: [],
      protected_files: 0,
    };
  }
}

// ============================================================
// PREFERENCES STATUS
// ============================================================

interface PreferencesStatus {
  has_preferences: boolean;
  timezone?: string;
  preferred_journey_length?: string;
  notification_preferences?: Record<string, boolean>;
  last_updated?: string;
}

async function getPreferencesStatus(authContext?: AuthContext): Promise<PreferencesStatus> {
  try {
    // Pass auth context through so getUserContext resolves the correct user
    const userContext = await getUserContext({
      include_recent_insights: false,
      include_session_history: false,
      auth: authContext,
    });

    const prefs = (userContext as { preferences?: Record<string, unknown> }).preferences || {};

    return {
      has_preferences: Object.keys(prefs).length > 0,
      timezone: prefs.timezone as string | undefined,
      preferred_journey_length: prefs.preferredJourneyLength as string | undefined,
      notification_preferences: prefs.notifications as Record<string, boolean> | undefined,
    };
  } catch (error) {
    logger.error('Error getting preferences status:', error);
    return {
      has_preferences: false,
    };
  }
}

// ============================================================
// SUMMARY AND NEXT STEPS
// ============================================================

function generateSummary(result: StatusResult): string {
  const parts: string[] = [];

  if (result.session?.has_active_session) {
    const s = result.session;
    parts.push(`Active session: Step ${s.current_step}/${s.total_steps} (${s.percent_complete}% complete), ${s.checkpoints_saved} checkpoints saved, ${s.time_elapsed_minutes} min elapsed.`);
  } else if (result.session) {
    parts.push('No active session.');
  }

  if (result.history) {
    const h = result.history;
    parts.push(`History: ${h.total_sessions} sessions, ${h.total_insights} insights.`);
    if (h.patterns_detected.length > 0) {
      parts.push(`Patterns: ${h.patterns_detected.slice(0, 2).join(', ')}.`);
    }
  }

  if (result.context) {
    const c = result.context;
    parts.push(`Context: ${c.total_entries} entries stored, ${c.context_window_usage_percent.toFixed(0)}% window used.`);
    if (c.warning) {
      parts.push(`⚠️ ${c.warning}`);
    }
  }

  if (result.protection) {
    const p = result.protection;
    parts.push(`Protection: ${p.total_backups} backups, freeze ${p.code_freeze_enabled ? 'enabled' : 'disabled'}.`);
  }

  return parts.join(' ');
}

function generateNextSteps(result: StatusResult): string[] {
  const steps: string[] = [];

  if (!result.session?.has_active_session && result.history?.total_sessions === 0) {
    steps.push('Start your first session with "start a reflection" or "let\'s begin"');
  } else if (!result.session?.has_active_session && result.history) {
    steps.push('Resume a session with "continue" or start fresh with "new session"');
  }

  if (result.session?.has_active_session && result.session.percent_complete && result.session.percent_complete > 75) {
    steps.push('You\'re almost done! Say "wrap up" to complete your session.');
  }

  if (result.context?.context_window_usage_percent && result.context.context_window_usage_percent > 80) {
    steps.push('Consider cleaning up old context with "clean up context"');
  }

  if (result.protection && !result.protection.code_freeze_enabled && result.protection.total_backups === 0) {
    steps.push('Enable protection with "backup my files" before making changes');
  }

  if (!result.preferences?.has_preferences) {
    steps.push('Set your preferences with "remember my timezone" or "I prefer short journeys"');
  }

  if (steps.length === 0) {
    steps.push('Everything looks good! What would you like to do next?');
  }

  return steps.slice(0, 3);
}

// ============================================================
// TYPES
// ============================================================

interface StatusResult {
  check: string;
  timestamp: string;
  session?: SessionStatus;
  history?: HistoryStatus;
  context?: ContextStatus;
  protection?: ProtectionStatus;
  preferences?: PreferencesStatus;
  summary?: string;
  next_steps?: string[];
}
