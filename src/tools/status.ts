/**
 * MCP Tool: status
 * 
 * Dashboard and quick status checks for session, history, context, protection, and preferences.
 * Provides personalized status with actionable next steps.
 */

import { z } from 'zod';
import { getDb } from '../db/client.js';
import { sessions, checkpoints, insights } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { WorkflowEngine } from '../workflows/engine.js';
import { ContextManager } from '../developer/managers/context-manager.js';
import { ContextMetadata, ContextEntry } from '../types/context.js';
import { getProtectionStatus, listBackups } from './protect-files.js';
import { getUserContext } from './insight.js';
import { logger } from '../utils/logger.js';

const StatusInputSchema = z.object({
  check: z.enum(['session', 'history', 'context', 'protection', 'preferences', 'all']).describe('What to check'),
  session_id: z.string().optional().describe('Session ID for session-specific status'),
});

export type StatusInput = z.infer<typeof StatusInputSchema>;

export const statusTool = {
  definition: {
    name: 'status',
    description: `Dashboard and quick status checks. Use for: "how am I doing", "what's my progress", "show my history", "what do you know about me", "my settings", "context window", "backup status". Returns personalized status with actionable next steps.`,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
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

export async function handleStatus(args: unknown) {
  try {
    const input = StatusInputSchema.parse(args);
    
    logger.info('Running status check', { check: input.check });
    
    const result: StatusResult = {
      check: input.check,
      timestamp: new Date().toISOString(),
    };

    // Run appropriate checks based on type
    if (input.check === 'session' || input.check === 'all') {
      result.session = await getSessionStatus(input.session_id);
    }

    if (input.check === 'history' || input.check === 'all') {
      result.history = await getHistoryStatus();
    }

    if (input.check === 'context' || input.check === 'all') {
      result.context = await getContextStatus();
    }

    if (input.check === 'protection' || input.check === 'all') {
      result.protection = await getProtectionStatusSummary();
    }

    if (input.check === 'preferences' || input.check === 'all') {
      result.preferences = await getPreferencesStatus();
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

async function getSessionStatus(sessionId?: string): Promise<SessionStatus> {
  try {
    const db = getDb();
    
    // Find active or specified session
    let session;
    
    if (sessionId) {
      [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
    } else {
      // Get most recent active session
      [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.status, 'active'))
        .orderBy(desc(sessions.lastActiveAt))
        .limit(1);
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

    // Get checkpoint count
    const sessionCheckpoints = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.sessionId, session.id));

    // Calculate time elapsed
    const startTime = new Date(session.startedAt);
    const now = new Date();
    const timeElapsedMinutes = Math.round((now.getTime() - startTime.getTime()) / 60000);

    return {
      has_active_session: true,
      session_id: session.id,
      journey_name: session.journeyId || undefined,
      current_step: progress.currentStep,
      total_steps: progress.totalSteps,
      percent_complete: progress.percentComplete,
      checkpoints_saved: sessionCheckpoints.length,
      time_elapsed_minutes: timeElapsedMinutes,
      started_at: session.startedAt.toISOString(),
      last_activity: session.lastActiveAt?.toISOString(),
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

async function getHistoryStatus(): Promise<HistoryStatus> {
  try {
    const db = getDb();
    
    // Get recent sessions
    const recentSessions = await db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.startedAt))
      .limit(5);

    // Get total session count
    const allSessions = await db.select().from(sessions);

    // Get recent insights
    const recentInsights = await db
      .select()
      .from(insights)
      .orderBy(desc(insights.createdAt))
      .limit(5);

    // Get all insights for pattern detection
    const allInsights = await db.select().from(insights);

    // Detect patterns from insight tags
    const tagCounts: Record<string, number> = {};
    for (const insight of allInsights) {
      const tags = insight.tags as string[] | null;
      if (tags) {
        for (const tag of tags) {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }
    }

    // Find recurring patterns (tags that appear 3+ times)
    const patterns = Object.entries(tagCounts)
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, count]) => `${tag} (${count} occurrences)`);

    return {
      recent_sessions: recentSessions.map(s => ({
        id: s.id,
        journey: s.journeyId || undefined,
        status: s.status,
        started_at: s.startedAt.toISOString(),
      })),
      total_sessions: allSessions.length,
      total_insights: allInsights.length,
      recent_insights: recentInsights.map(i => ({
        content: i.content.substring(0, 100) + (i.content.length > 100 ? '...' : ''),
        tags: i.tags as string[] | undefined,
        created_at: i.createdAt.toISOString(),
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
    const contextManager = new ContextManager();
    await contextManager.initialize();
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

async function getPreferencesStatus(): Promise<PreferencesStatus> {
  try {
    // Get user preferences (using anonymous user for now)
    const userContext = await getUserContext({
      include_recent_insights: false,
      include_session_history: false,
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
