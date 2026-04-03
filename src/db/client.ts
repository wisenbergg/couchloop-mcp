/**
 * Database client — Supabase JS SDK only.
 *
 * All database access goes through the Supabase client.
 * Drizzle ORM has been removed.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger.js';

let supabase: SupabaseClient | null = null;
let reconnectPromise: Promise<SupabaseClient> | null = null;

export async function initDatabase() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      const missing = [];
      if (!supabaseUrl) missing.push('SUPABASE_URL');
      if (!supabaseKey) missing.push('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY');
      console.error(`FATAL: Missing required env vars: ${missing.join(', ')}`);
      throw new Error(`Missing required env vars: ${missing.join(', ')}`);
    }

    logger.info(`Initializing Supabase client (using ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service_role' : 'anon'} key)`);

    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Test the connection
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) {
      throw new Error(`Supabase connection test failed: ${error.message}`);
    }

    logger.info('Supabase client initialized and connection verified');

    return { supabase };
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    throw error;
  }
}

export function getSupabase(): SupabaseClient | null {
  return supabase;
}

/**
 * Lazy reconnect — if the client is null (failed init or cold start),
 * attempt to reinitialize once. Concurrent callers share the same promise.
 */
export async function getSupabaseOrReconnect(): Promise<SupabaseClient> {
  if (supabase) return supabase;

  // Deduplicate concurrent reconnect attempts
  if (reconnectPromise) return reconnectPromise;

  reconnectPromise = initDatabase()
    .then(({ supabase: client }) => {
      reconnectPromise = null;
      return client;
    })
    .catch((err) => {
      reconnectPromise = null;
      throw err;
    });

  return reconnectPromise;
}

export async function closeDatabase() {
  supabase = null;
  logger.info('Database connection closed');
}

export { supabase };
