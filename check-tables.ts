#!/usr/bin/env tsx
import { initDatabase, getDb } from './src/db/client.js';
import { sql } from 'drizzle-orm';
import { config } from 'dotenv';

config({ path: '.env.local' });

async function checkTables() {
  console.log('🔍 Checking existing database tables...\n');

  // Initialize database connection
  await initDatabase();
  const db = getDb();

  try {
    // Query to list all tables in the public schema
    const result = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    // Handle different result formats
    const tables = (result as any) || [];
    const tableNames = tables.map((row: any) => row.table_name || row.TABLE_NAME);

    console.log(`Found ${tableNames.length} tables in database:\n`);

    // Categorize tables
    const existingTables = new Set(tableNames);

    const expectedTables = [
      'users',
      'sessions',
      'journeys',
      'checkpoints',
      'insights',
      'oauth_clients',
      'oauth_tokens',
      'authorization_codes',
      'thread_mappings',
      'crisis_events'
    ];

    const governanceTables = [
      'governance_evaluations',
      'governance_rules',
      'governance_audit_log'
    ];

    console.log('✅ Existing tables:');
    expectedTables.forEach(table => {
      if (existingTables.has(table)) {
        console.log(`   ✓ ${table}`);
      }
    });

    console.log('\n❌ Missing expected tables:');
    expectedTables.forEach(table => {
      if (!existingTables.has(table)) {
        console.log(`   ✗ ${table}`);
      }
    });

    console.log('\n🆕 Governance tables (to be created):');
    governanceTables.forEach(table => {
      if (existingTables.has(table)) {
        console.log(`   ✓ ${table} (already exists!)`);
      } else {
        console.log(`   → ${table} (will be created)`);
      }
    });

    // Check for OAuth tables specifically
    console.log('\n🔐 OAuth table status:');
    const oauthTables = ['oauth_clients', 'oauth_tokens', 'authorization_codes'];
    oauthTables.forEach(table => {
      if (existingTables.has(table)) {
        console.log(`   ✓ ${table} EXISTS - will be skipped in migration`);
      } else {
        console.log(`   → ${table} MISSING - will be created`);
      }
    });

  } catch (error) {
    console.error('Error checking tables:', error);
  }

  process.exit(0);
}

checkTables();