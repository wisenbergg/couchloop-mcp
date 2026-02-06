#!/usr/bin/env node
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { logger } from '../utils/logger.js';

config();

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    logger.error('DATABASE_URL is not set');
    process.exit(1);
  }

  logger.info('Running database migrations...');

  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql);

  try {
    await migrate(db, { migrationsFolder: './src/db/migrations' });
    logger.info('Migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
}

export { runMigrations };