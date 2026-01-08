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

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      throw new Error('Supabase configuration is incomplete');
    }

    // Initialize Postgres connection for Drizzle
    sql = postgres(databaseUrl, {
      max: 10, // Max connections
      idle_timeout: 20,
      connect_timeout: 10,
    });

    // Initialize Drizzle ORM
    db = drizzle(sql, { schema });

    // Initialize Supabase client
    supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

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
    throw new Error('Supabase client not initialized. Call initDatabase() first.');
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