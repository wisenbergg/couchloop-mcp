import { initDatabase, getDb } from './src/db/client';
import { sessions, checkpoints, insights, users } from './src/db/schema';
import { desc, eq } from 'drizzle-orm';

async function checkAllSessions() {
  await initDatabase();
  const db = getDb();

  if (!db) {
    console.error('Database not initialized');
    process.exit(1);
  }

  // Get all sessions ordered by most recent
  console.log('=== ALL SESSIONS (Most Recent First) ===\n');
  const allSessions = await db.select().from(sessions)
    .orderBy(desc(sessions.lastActiveAt));

  for (const session of allSessions) {
    console.log(`Session ID: ${session.id}`);
    console.log(`Status: ${session.status}`);
    console.log(`Started: ${session.startedAt}`);
    console.log(`Last Active: ${session.lastActiveAt}`);
    if (session.metadata) {
      console.log(`Metadata: ${JSON.stringify(session.metadata)}`);
    }

    // Get checkpoints for this session
    const sessionCheckpoints = await db.select().from(checkpoints)
      .where(eq(checkpoints.sessionId, session.id))
      .orderBy(checkpoints.createdAt);

    if (sessionCheckpoints.length > 0) {
      console.log(`\n  Checkpoints (${sessionCheckpoints.length}):`);
      for (const cp of sessionCheckpoints) {
        const value = cp.value as any;
        if (value?.message) {
          console.log(`    - ${new Date(cp.createdAt).toISOString()}: "${value.message}"`);
        } else {
          console.log(`    - ${new Date(cp.createdAt).toISOString()}: ${cp.key}`);
        }
      }
    }

    console.log('\n' + '='.repeat(60) + '\n');
  }

  // Summary stats
  const activeCount = allSessions.filter(s => s.status === 'active').length;
  const completedCount = allSessions.filter(s => s.status === 'completed').length;
  const pausedCount = allSessions.filter(s => s.status === 'paused').length;

  console.log('SUMMARY:');
  console.log(`Total Sessions: ${allSessions.length}`);
  console.log(`Active: ${activeCount}`);
  console.log(`Completed: ${completedCount}`);
  console.log(`Paused: ${pausedCount}`);

  process.exit(0);
}

checkAllSessions().catch(console.error);