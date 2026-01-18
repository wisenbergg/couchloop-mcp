import { initDatabase, getDb } from './src/db/client';
import { sessions, checkpoints } from './src/db/schema';
import { eq } from 'drizzle-orm';

async function examineExportCheckpoint() {
  await initDatabase();
  const db = getDb();

  if (!db) {
    console.error('Database not initialized');
    process.exit(1);
  }

  console.log('═'.repeat(80));
  console.log('EXAMINING EXPORTED SESSION CHECKPOINT DATA');
  console.log('═'.repeat(80));
  console.log(`\nAnalysis Time: ${new Date().toISOString()}\n`);

  const exportedSessionId = '4d98c1a1-93ac-499a-ac50-ece2455933b8';

  // Get the checkpoint data
  const checkpointData = await db
    .select()
    .from(checkpoints)
    .where(eq(checkpoints.sessionId, exportedSessionId));

  console.log(`Found ${checkpointData.length} checkpoint(s) for session\n`);

  for (const cp of checkpointData) {
    console.log('Checkpoint Details:');
    console.log('─'.repeat(40));
    console.log(`ID: ${cp.id}`);
    console.log(`Session ID: ${cp.sessionId}`);
    console.log(`Key: ${cp.key}`);
    console.log(`Created: ${new Date(cp.createdAt).toLocaleString()}`);
    console.log(`\nCheckpoint Value (Full):\n`);
    console.log(JSON.stringify(cp.value, null, 2));
    console.log('\n' + '═'.repeat(80));
  }

  // Also check the incorrect Emily session I was looking at
  const incorrectSessionId = 'b28354c3-0586-479d-ba75-c8520c4776f4';

  console.log('\nChecking the other "Emily" session I incorrectly analyzed:');
  console.log('Session ID:', incorrectSessionId);

  const otherSession = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, incorrectSessionId))
    .limit(1);

  if (otherSession.length > 0) {
    console.log('\nFound session:');
    console.log(`  Context: ${JSON.stringify(otherSession[0].metadata)}`);
    console.log(`  Started: ${new Date(otherSession[0].startedAt).toLocaleString()}`);
  }

  process.exit(0);
}

examineExportCheckpoint().catch(console.error);