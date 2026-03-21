import { nanoid } from 'nanoid';
import { getSupabase } from '../../db/client.js';
import { logger } from '../../utils/logger.js';
import {
  ContextEntry,
  ContextCategoryType,
  ContextMetadata,
  PreserveContextResponse,
} from '../../types/context.js';

const TABLE = 'context_entries';
const MAX_CONTEXT_WINDOW_TOKENS = 200_000;
const AVG_CHARS_PER_TOKEN = 4;


/**
 * ContextManager — Supabase-backed context storage.
 *
 * Replaces the previous filesystem implementation (context-store.json)
 * which failed in containerised deployments (Railway) where the application
 * filesystem is read-only at runtime.
 *
 * Uses the existing getSupabase() singleton from db/client.ts — no new
 * connections, no environment branching. Works identically in local dev,
 * staging, and production as long as SUPABASE_* env vars are set.
 *
 * Falls back gracefully (degraded mode) when Supabase is unavailable so
 * the MCP server can still respond to tool/list requests.
 */
export class ContextManager {
  /**
   * Store a context entry.
   */
  async storeEntry(
    category: ContextCategoryType,
    content: string,
  ): Promise<PreserveContextResponse> {
    const supabase = getSupabase();
    if (!supabase) {
      return this.degraded('store', 'Supabase client unavailable — check SUPABASE_* env vars');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from(TABLE)
      .insert({ id: nanoid(), category, content, usage_count: 0, tags: [] })
      .select()
      .single();

    if (error) {
      logger.error('[ContextManager] storeEntry error:', error.message);
      return {
        success: false,
        action: 'store',
        message: `Failed to store context: ${error.message}`,
      };
    }

    logger.info(`[ContextManager] Stored entry id=${data.id} category=${category}`);

    return {
      success: true,
      action: 'store',
      message: `Successfully stored context in "${category}" category`,
      data: [this.toEntry(data)],
    };
  }

  /**
   * Retrieve context entries — optionally filtered by category and/or search term.
   * Increments usage_count and updates last_accessed as a fire-and-forget side effect.
   */
  async retrieve(
    category?: ContextCategoryType,
    searchTerm?: string,
  ): Promise<PreserveContextResponse> {
    const supabase = getSupabase();
    if (!supabase) {
      return this.degraded('retrieve', 'Supabase client unavailable');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from(TABLE)
      .select('*')
      .order('created_at', { ascending: false });

    if (category) {
      query = query.eq('category', category);
    }
    if (searchTerm) {
      // Escape SQL LIKE wildcards in the search term
      const escaped = searchTerm.replace(/[%_]/g, '\\$&');
      query = query.ilike('content', `%${escaped}%`);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('[ContextManager] retrieve error:', error.message);
      return {
        success: false,
        action: 'retrieve',
        message: `Failed to retrieve context: ${error.message}`,
      };
    }

    if (!data || data.length === 0) {
      return {
        success: true,
        action: 'retrieve',
        message: `No context found${category ? ` in category "${category}"` : ''}${
          searchTerm ? ` matching "${searchTerm}"` : ''
        }`,
        data: null,
      };
    }

    // Fire-and-forget: bump usage stats on retrieved rows
    const ids = data.map((r: any) => r.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .rpc('increment_usage_count', { row_ids: ids })
      .then(() => {}, (err: unknown) => {
        // Fallback: update each row individually if RPC not available
        ids.forEach((id: string) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any)
            .from(TABLE)
            .update({ last_accessed: new Date().toISOString() })
            .eq('id', id)
            .then(() => {}, () => {});
        });
        logger.warn('[ContextManager] usage RPC failed, used fallback:', err);
      });

    logger.info(`[ContextManager] Retrieved ${data.length} entries`);

    return {
      success: true,
      action: 'retrieve',
      message: `Retrieved ${data.length} context entries`,
      data: data.map((r: any) => this.toEntry(r)),
    };
  }

  /**
   * Check context window usage and return store metadata.
   */
  async check(includeMetadata = false): Promise<PreserveContextResponse> {
    const supabase = getSupabase();
    if (!supabase) {
      return this.degraded('check', 'Supabase client unavailable');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from(TABLE)
      .select('category, content');

    if (error) {
      logger.error('[ContextManager] check error:', error.message);
      return {
        success: false,
        action: 'check',
        message: `Failed to check context: ${error.message}`,
      };
    }

    const rows = data ?? [];
    const totalBytes = rows.reduce((sum: number, r: any) => sum + (r.content?.length ?? 0), 0);
    const estimatedTokens = totalBytes / AVG_CHARS_PER_TOKEN;
    const usagePct = Math.min((estimatedTokens / MAX_CONTEXT_WINDOW_TOKENS) * 100, 100);

    const entriesByCategory: Record<ContextCategoryType, number> = {
      architecture: 0,
      requirements: 0,
      constraints: 0,
      decisions: 0,
      'technical-patterns': 0,
      'project-metadata': 0,
    };
    rows.forEach((r: any) => {
      if (r.category in entriesByCategory) {
        entriesByCategory[r.category as ContextCategoryType]++;
      }
    });

    let warning: string | undefined;
    if (usagePct > 80) {
      warning = `Context store is ${usagePct.toFixed(1)}% full. Consider cleaning up old entries.`;
    } else if (usagePct > 60) {
      warning = `Context store is ${usagePct.toFixed(1)}% full.`;
    }

    const metadata: ContextMetadata = {
      total_entries: rows.length,
      entries_by_category: entriesByCategory,
      total_stored_bytes: totalBytes,
      last_updated: new Date(),
      context_window_usage_percent: usagePct,
    };

    return {
      success: true,
      action: 'check',
      message: `Context store contains ${rows.length} entries`,
      warning,
      ...(includeMetadata ? { data: metadata } : {}),
    };
  }

  /**
   * Remove entries older than `daysOld` days.
   */
  async cleanup(daysOld = 30): Promise<PreserveContextResponse> {
    const supabase = getSupabase();
    if (!supabase) {
      return this.degraded('cleanup', 'Supabase client unavailable');
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error, count } = await (supabase as any)
      .from(TABLE)
      .delete({ count: 'exact' })
      .lt('created_at', cutoff.toISOString());

    if (error) {
      logger.error('[ContextManager] cleanup error:', error.message);
      return {
        success: false,
        action: 'cleanup',
        message: `Cleanup failed: ${error.message}`,
      };
    }

    logger.info(`[ContextManager] Cleaned up ${count ?? 0} entries older than ${daysOld} days`);

    return {
      success: true,
      action: 'cleanup',
      message: `Removed ${count ?? 0} entries older than ${daysOld} days`,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Map a raw Supabase row to the ContextEntry shape used by the rest of the codebase. */
  private toEntry(row: any): ContextEntry {
    return {
      id: row.id,
      category: row.category as ContextCategoryType,
      content: row.content,
      timestamp: new Date(row.created_at),
      usage_count: row.usage_count ?? 0,
      last_retrieved: row.last_accessed ? new Date(row.last_accessed) : null,
    };
  }

  /** Return a consistent degraded-mode response when Supabase is unavailable. */
  private degraded(action: PreserveContextResponse['action'], reason: string): PreserveContextResponse {
    logger.warn(`[ContextManager] Degraded mode — ${reason}`);
    return {
      success: false,
      action,
      message: `Context storage unavailable: ${reason}`,
    };
  }
}

// Singleton — no initialize() needed; Supabase client handles its own lifecycle.
let instance: ContextManager | null = null;

export async function getContextManager(): Promise<ContextManager> {
  if (!instance) {
    instance = new ContextManager();
  }
  return instance;
}
