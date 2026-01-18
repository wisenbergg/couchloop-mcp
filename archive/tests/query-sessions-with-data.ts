import { initDatabase, getDb } from './src/db/client';
import {
  sessions,
  checkpoints,
  insights,
  users,
  journeys,
  crisisEvents,
  threadMappings
} from './src/db/schema';
import { eq, desc, inArray, gt, isNotNull } from 'drizzle-orm';

async function querySessionsWithData() {
  await initDatabase();
  const db = getDb();

  if (!db) {
    console.error('Database not initialized');
    process.exit(1);
  }

  console.log('=== Finding MCP Sessions WITH Actual Data ===\n');
  console.log(`Query Time: ${new Date().toISOString()}`);
  console.log('Database: CouchLoop MCP Production\n');

  // First, find sessions that have checkpoints
  const sessionsWithCheckpoints = await db
    .selectDistinct({ sessionId: checkpoints.sessionId })
    .from(checkpoints);

  console.log(`Found ${sessionsWithCheckpoints.length} sessions with checkpoints\n`);

  if (sessionsWithCheckpoints.length === 0) {
    console.log('No sessions have checkpoints. Checking for sessions with thread IDs...\n');

    // Look for sessions with thread IDs (linked to Shrink-Chat)
    const sessionsWithThreads = await db
      .select()
      .from(sessions)
      .where(isNotNull(sessions.threadId))
      .orderBy(desc(sessions.lastActiveAt))
      .limit(10);

    console.log(`Found ${sessionsWithThreads.length} sessions with thread IDs\n`);

    if (sessionsWithThreads.length > 0) {
      for (const session of sessionsWithThreads.slice(0, 3)) {
        console.log('─'.repeat(60));
        console.log(`Session: ${session.id}`);
        console.log(`Thread ID: ${session.threadId}`);
        console.log(`Status: ${session.status}`);
        console.log(`Started: ${new Date(session.startedAt).toLocaleString()}`);
        console.log(`Metadata: ${JSON.stringify(session.metadata)}`);
      }
    }

    console.log('\n=== Checking for Sessions with Insights ===\n');

    const sessionsWithInsights = await db
      .selectDistinct({ sessionId: insights.sessionId })
      .from(insights)
      .where(isNotNull(insights.sessionId));

    console.log(`Found ${sessionsWithInsights.length} sessions with insights\n`);

    console.log('=== Checking for Sessions with Crisis Events ===\n');

    const sessionsWithCrisis = await db
      .selectDistinct({ sessionId: crisisEvents.sessionId })
      .from(crisisEvents)
      .where(isNotNull(crisisEvents.sessionId));

    console.log(`Found ${sessionsWithCrisis.length} sessions with crisis events\n`);

    process.exit(0);
  }

  // Get the sessions that have checkpoints
  const sessionIds = sessionsWithCheckpoints.map(s => s.sessionId).filter(id => id !== null) as string[];

  const sessionsWithData = await db
    .select()
    .from(sessions)
    .where(inArray(sessions.id, sessionIds))
    .orderBy(desc(sessions.lastActiveAt))
    .limit(5);

  console.log(`Displaying ${sessionsWithData.length} sessions with checkpoint data:\n`);

  for (const session of sessionsWithData) {
    const user = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    const sessionCheckpoints = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.sessionId, session.id))
      .orderBy(checkpoints.createdAt);

    console.log('═'.repeat(80));
    console.log(`SESSION: ${session.id}`);
    console.log('═'.repeat(80));

    console.log('\n📋 Session Details:');
    console.log(`  Status: ${session.status}`);
    console.log(`  Started: ${new Date(session.startedAt).toLocaleString()}`);
    console.log(`  Last Active: ${new Date(session.lastActiveAt).toLocaleString()}`);
    console.log(`  Thread ID: ${session.threadId || 'None'}`);
    console.log(`  Metadata: ${JSON.stringify(session.metadata)}`);

    console.log('\n👤 User:');
    if (user[0]) {
      console.log(`  External ID: ${user[0].externalId || 'None'}`);
      console.log(`  Test Account: ${user[0].isTestAccount ? 'Yes' : 'No'}`);
    }

    console.log(`\n📍 Checkpoints (${sessionCheckpoints.length}):`);
    for (const checkpoint of sessionCheckpoints) {
      console.log(`  • ${new Date(checkpoint.createdAt).toLocaleString()}`);
      console.log(`    Key: ${checkpoint.key}`);
      const value = checkpoint.value as any;
      if (value?.message) {
        console.log(`    Message: "${value.message}"`);
      } else {
        console.log(`    Value: ${JSON.stringify(value).substring(0, 200)}`);
      }
      console.log('');
    }

    // Calculate duration
    const duration = new Date(session.lastActiveAt).getTime() - new Date(session.startedAt).getTime();
    const durationMinutes = Math.round(duration / 1000 / 60);
    console.log(`⏱️  Duration: ${durationMinutes} minutes\n`);
  }

  // Summary of all data
  console.log('═'.repeat(80));
  console.log('OVERALL DATABASE STATISTICS');
  console.log('═'.repeat(80));

  const totalSessions = await db.select({ count: sessions.id }).from(sessions);
  const totalCheckpoints = await db.select({ count: checkpoints.id }).from(checkpoints);
  const totalInsights = await db.select({ count: insights.id }).from(insights);
  const totalCrisis = await db.select({ count: crisisEvents.id }).from(crisisEvents);

  console.log(`Total Sessions: ${totalSessions.length}`);
  console.log(`Total Checkpoints: ${totalCheckpoints.length}`);
  console.log(`Total Insights: ${totalInsights.length}`);
  console.log(`Total Crisis Events: ${totalCrisis.length}`);
  console.log(`\nSessions with checkpoints: ${sessionsWithCheckpoints.length}`);
  console.log(`Sessions without checkpoints: ${totalSessions.length - sessionsWithCheckpoints.length}`);

  process.exit(0);
}

querySessionsWithData().catch(console.error);