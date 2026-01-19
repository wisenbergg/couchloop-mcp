import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger.js';
import * as schema from './schema.js';

let db: ReturnType<typeof drizzle> | null = null;
let supabase: ReturnType<typeof createClient> | null = null;
let sql: ReturnType<typeof postgres> | null = null;

export async function initDatabase() {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not configured');
    }

    // Make Supabase optional - MCP server can work with just database
    const hasSupabase = supabaseUrl && supabaseAnonKey &&
                       supabaseServiceKey &&
                       !supabaseUrl.includes('xxx') &&
                       !supabaseAnonKey.includes('your-') &&
                       !supabaseServiceKey.includes('your-');

    // Initialize Postgres connection for Drizzle
    // Optimized pool configuration for better performance under load
    sql = postgres(databaseUrl, {
      max: 25,              // Increased from 10 for better concurrency
      idle_timeout: 60,     // Increased from 20 to keep connections warm longer
      connect_timeout: 10,  // Keep same connection timeout
      prepare: false,       // Disable prepared statements for better connection reuse
      types: {
        // Ensure JSONB is handled correctly
        json: {
          to: 114,
          from: [114],
        }
      }
    });

    // Initialize Drizzle ORM
    db = drizzle(sql, { schema });

    // Initialize Supabase client only if configuration is valid
    if (hasSupabase) {
      supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
      logger.info('Supabase client initialized');
    } else {
      logger.info('Supabase configuration incomplete or uses placeholders - running without Supabase client');
    }

    // Test the connection
    await sql`SELECT 1`;
    logger.info('Database connection established successfully');

    return { db, supabase, sql };
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    throw error;
  }
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function getSupabase() {
  if (!supabase) {
    logger.warn('Supabase client not initialized - check environment configuration');
    return null;
  }
  return supabase;
}

export async function closeDatabase() {
  if (sql) {
    await sql.end();
    sql = null;
    db = null;
    supabase = null;
    logger.info('Database connections closed');
  }
}

export { db, supabase };