/**
 * Supabase client helpers.
 *
 * getSupabaseClient() — guaranteed non-null Supabase client.
 * throwOnError()      — unwraps { data, error } and throws on failure.
 */

import { getSupabase, getSupabaseOrReconnect } from './client.js';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Returns the initialized Supabase client or throws.
 * Use this instead of getSupabase() so callers never need null checks.
 *
 * If the client is null (failed init or cold start), attempts a lazy
 * reconnect before giving up. This prevents the server from staying
 * in a permanently degraded state after a transient DB failure.
 */
export function getSupabaseClient(): SupabaseClient {
  const client = getSupabase();
  if (!client) {
    // Kick off async reconnect for the next caller — this call still throws
    // synchronously so existing error handling is preserved.
    getSupabaseOrReconnect().catch(() => {/* will be retried next call */});
    throw new Error(
      'Supabase client not initialized — reconnect in progress. Retry shortly.',
    );
  }
  return client;
}

/**
 * Unwrap a Supabase response. Throws if error is present, otherwise returns data.
 *
 * Usage:
 *   const data = throwOnError(await supabase.from('users').select('*').eq('id', id).maybeSingle());
 */
export function throwOnError<T>(result: { data: T; error: unknown }): T {
  if (result.error) {
    const err = result.error as { message?: string; code?: string; details?: string };
    const msg = err.message || 'Unknown Supabase error';
    const detail = err.details ? ` (${err.details})` : '';
    throw new Error(`Supabase: ${msg}${detail}`);
  }
  return result.data;
}

/** Table name constants — single source of truth */
export const Tables = {
  users: 'users',
  journeys: 'journeys',
  sessions: 'sessions',
  checkpoints: 'checkpoints',
  insights: 'insights',
  oauth_clients: 'oauth_clients',
  oauth_tokens: 'oauth_tokens',
  authorization_codes: 'authorization_codes',
  thread_mappings: 'thread_mappings',
  crisis_events: 'crisis_events',
  governance_evaluations: 'governance_evaluations',
  governance_rules: 'governance_rules',
  governance_audit_log: 'governance_audit_log',
  context_entries: 'context_entries',
} as const;
