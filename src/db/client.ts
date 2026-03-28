/**
 * Database client — Supabase JS SDK only.
 *
 * All database access goes through the Supabase client.
 * Drizzle ORM has been removed.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger.js';

let supabase: SupabaseClient | null = null;

export async function initDatabase() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required',
      );
    }

    if (supabaseUrl.includes('xxx') || supabaseServiceKey.includes('your-')) {
      throw new Error(
        'Supabase credentials contain placeholder values. Set real values in your .env file.',
      );
    }

    supabase = createClient(supabaseUrl, supabaseServiceKey, {
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

export async function closeDatabase() {
  supabase = null;
  logger.info('Database connection closed');
}

export { supabase };
