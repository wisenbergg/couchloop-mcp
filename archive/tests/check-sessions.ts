import { initDatabase, getDb } from './src/db/client';
import { sessions, checkpoints, insights } from './src/db/schema';
import { sql } from 'drizzle-orm';

async function checkRecentActivity() {
  await initDatabase();
  const db = getDb();

  if (!db) {
    console.error('Database not initialized');
    process.exit(1);
  }

  console.log('=== Recent Sessions ===');
  const recentSessions = await db.select().from(sessions).limit(5);
  console.log(JSON.stringify(recentSessions, null, 2));

  console.log('\n=== Recent Checkpoints ===');
  const recentCheckpoints = await db.select().from(checkpoints).limit(5);
  console.log(JSON.stringify(recentCheckpoints, null, 2));

  console.log('\n=== Recent Insights ===');
  const recentInsights = await db.select().from(insights).limit(5);
  console.log(JSON.stringify(recentInsights, null, 2));

  process.exit(0);
}

checkRecentActivity().catch(console.error);