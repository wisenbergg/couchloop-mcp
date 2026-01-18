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
import { eq, desc, inArray, sql } from 'drizzle-orm';

async function verifyExportedSession() {
  await initDatabase();
  const db = getDb();

  if (!db) {
    console.error('Database not initialized');
    process.exit(1);
  }

  console.log('═'.repeat(80));
  console.log('VERIFYING COUCHLOOP EXPORTED SESSION');
  console.log('═'.repeat(80));
  console.log(`\nAnalysis Time: ${new Date().toISOString()}\n`);

  // The session from the export document
  const exportedSessionId = '4d98c1a1-93ac-499a-ac50-ece2455933b8';

  // Also check the session I incorrectly identified as "Emily session"
  const incorrectSessionId = 'b28354c3-0586-479d-ba75-c8520c4776f4';

  console.log('Looking for exported session:', exportedSessionId);
  console.log('Also checking previously analyzed session:', incorrectSessionId, '\n');

  // Check if the exported session exists
  const exportedSession = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, exportedSessionId))
    .limit(1);

  if (exportedSession.length > 0) {
    const session = exportedSession[0];
    console.log('✅ FOUND EXPORTED SESSION IN DATABASE!\n');

    console.log('📋 Session Details:');
    console.log(`  ID: ${session.id}`);
    console.log(`  Status: ${session.status}`);
    console.log(`  Started: ${new Date(session.startedAt).toLocaleString()}`);
    console.log(`  Last Active: ${new Date(session.lastActiveAt).toLocaleString()}`);
    console.log(`  Thread ID: ${session.threadId || 'None'}`);
    console.log(`  Journey ID: ${session.journeyId || 'None'}`);
    console.log(`  Current Step: ${session.currentStep}`);
    console.log(`  Metadata: ${JSON.stringify(session.metadata)}`);

    // Get user info
    const user = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    if (user[0]) {
      console.log('\n👤 User:');
      console.log(`  User ID: ${user[0].id}`);
      console.log(`  External ID: ${user[0].externalId}`);
      console.log(`  Test Account: ${user[0].isTestAccount}`);
    }

    // Check for data capture
    const checkpointData = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.sessionId, session.id))
      .orderBy(checkpoints.createdAt);

    const insightData = await db
      .select()
      .from(insights)
      .where(eq(insights.sessionId, session.id))
      .orderBy(desc(insights.createdAt));

    const crisisData = await db
      .select()
      .from(crisisEvents)
      .where(eq(crisisEvents.sessionId, session.id));

    const threadMapping = await db
      .select()
      .from(threadMappings)
      .where(eq(threadMappings.sessionId, session.id))
      .limit(1);

    console.log('\n📊 Data Captured:');
    console.log(`  Checkpoints: ${checkpointData.length}`);
    console.log(`  Insights: ${insightData.length}`);
    console.log(`  Crisis Events: ${crisisData.length}`);
    console.log(`  Thread Mapping: ${threadMapping.length > 0 ? 'Yes' : 'No'}`);

    if (checkpointData.length > 0) {
      console.log('\n📍 Checkpoint Details:');
      for (const cp of checkpointData.slice(0, 3)) {
        console.log(`\n  Checkpoint ${cp.id.substring(0, 8)}...`);
        console.log(`    Created: ${new Date(cp.createdAt).toLocaleString()}`);
        console.log(`    Key: ${cp.key}`);
        const value = cp.value as any;
        if (value?.message) {
          console.log(`    Message: "${value.message.substring(0, 100)}${value.message.length > 100 ? '...' : ''}"`);
        }
        if (value?.response) {
          console.log(`    Response: "${value.response.substring(0, 100)}${value.response.length > 100 ? '...' : ''}"`);
        }
      }
      if (checkpointData.length > 3) {
        console.log(`\n  ... and ${checkpointData.length - 3} more checkpoints`);
      }
    }

    if (insightData.length > 0) {
      console.log('\n💡 Insights Captured:');
      for (const insight of insightData) {
        console.log(`  • "${insight.content.substring(0, 100)}${insight.content.length > 100 ? '...' : ''}"`);
      }
    }

    if (threadMapping.length > 0) {
      console.log('\n🔗 Thread Mapping:');
      console.log(`  Thread ID: ${threadMapping[0].threadId}`);
      console.log(`  Source: ${threadMapping[0].source}`);
      console.log(`  Created: ${new Date(threadMapping[0].createdAt).toLocaleString()}`);
    }

  } else {
    console.log('❌ EXPORTED SESSION NOT FOUND IN DATABASE');
    console.log('Session ID:', exportedSessionId);
    console.log('\nThis could mean:');
    console.log('  1. The session data is in a different database');
    console.log('  2. The session was deleted');
    console.log('  3. The export is from a different environment');
  }

  // Now check ALL sessions from January 15, 2026 to find any with actual conversation data
  console.log('\n');
  console.log('═'.repeat(80));
  console.log('SEARCHING FOR SESSIONS WITH ACTUAL CONVERSATION DATA');
  console.log('═'.repeat(80));

  // Get all sessions with checkpoints that contain messages
  const sessionsWithMessages = await db
    .selectDistinct({ sessionId: checkpoints.sessionId })
    .from(checkpoints)
    .where(sql`${checkpoints.value}->>'message' IS NOT NULL OR ${checkpoints.value}->>'response' IS NOT NULL`);

  console.log(`\nFound ${sessionsWithMessages.length} sessions with message/response data\n`);

  if (sessionsWithMessages.length > 0) {
    const sessionIds = sessionsWithMessages.map(s => s.sessionId).filter(id => id !== null) as string[];

    const sessionsWithData = await db
      .select()
      .from(sessions)
      .where(inArray(sessions.id, sessionIds))
      .orderBy(desc(sessions.lastActiveAt))
      .limit(5);

    console.log('Recent sessions with actual conversation data:\n');

    for (const session of sessionsWithData) {
      const metadata = session.metadata as any;
      const checkpointCount = await db.select({ count: sql<number>`count(*)` })
        .from(checkpoints)
        .where(eq(checkpoints.sessionId, session.id));

      console.log(`📋 Session: ${session.id}`);
      console.log(`  Date: ${new Date(session.startedAt).toLocaleString()}`);
      console.log(`  Status: ${session.status}`);
      console.log(`  Context: ${metadata?.context || 'None'}`);
      console.log(`  Checkpoints: ${checkpointCount[0]?.count || 0}`);

      // Get a sample message
      const sampleCheckpoint = await db
        .select()
        .from(checkpoints)
        .where(eq(checkpoints.sessionId, session.id))
        .limit(1);

      if (sampleCheckpoint[0]) {
        const value = sampleCheckpoint[0].value as any;
        if (value?.message) {
          console.log(`  Sample message: "${value.message.substring(0, 60)}..."`);
        }
      }
      console.log('');
    }
  }

  // Look for any sessions on January 15, 2026 specifically
  const jan15Start = new Date('2026-01-15T00:00:00Z');
  const jan15End = new Date('2026-01-15T23:59:59Z');

  const jan15Sessions = await db
    .select()
    .from(sessions)
    .where(sql`${sessions.startedAt} >= ${jan15Start.toISOString()} AND ${sessions.startedAt} <= ${jan15End.toISOString()}`)
    .orderBy(desc(sessions.startedAt));

  console.log('═'.repeat(80));
  console.log('JANUARY 15, 2026 SESSIONS');
  console.log('═'.repeat(80));
  console.log(`\nTotal sessions on Jan 15: ${jan15Sessions.length}\n`);

  for (const session of jan15Sessions.slice(0, 10)) {
    const metadata = session.metadata as any;
    const checkpointCount = await db.select({ count: sql<number>`count(*)` })
      .from(checkpoints)
      .where(eq(checkpoints.sessionId, session.id));

    console.log(`• ${session.id}`);
    console.log(`  Time: ${new Date(session.startedAt).toLocaleTimeString()}`);
    console.log(`  Context: ${metadata?.context || 'None'}`);
    console.log(`  Checkpoints: ${checkpointCount[0]?.count || 0}`);

    if (metadata?.context && metadata.context.toLowerCase().includes('emily')) {
      console.log(`  ⭐ MENTIONS EMILY!`);
    }
  }

  process.exit(0);
}

verifyExportedSession().catch(console.error);