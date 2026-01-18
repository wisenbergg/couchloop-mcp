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
import { eq, desc, inArray, isNotNull } from 'drizzle-orm';

async function analyzeIntegrationTests() {
  await initDatabase();
  const db = getDb();

  if (!db) {
    console.error('Database not initialized');
    process.exit(1);
  }

  console.log('═'.repeat(80));
  console.log('INTEGRATION TEST DATA ANALYSIS');
  console.log('═'.repeat(80));
  console.log(`\nAnalysis Time: ${new Date().toISOString()}\n`);

  // 1. Get all sessions with checkpoints
  const sessionsWithCheckpoints = await db
    .selectDistinct({ sessionId: checkpoints.sessionId })
    .from(checkpoints);

  const sessionIds = sessionsWithCheckpoints.map(s => s.sessionId).filter(id => id !== null) as string[];

  console.log(`Found ${sessionIds.length} sessions with checkpoints\n`);

  // 2. Get full session details
  const sessionsWithData = await db
    .select()
    .from(sessions)
    .where(inArray(sessions.id, sessionIds))
    .orderBy(desc(sessions.lastActiveAt));

  // 3. Get all related data
  const allCheckpoints = await db
    .select()
    .from(checkpoints)
    .where(inArray(checkpoints.sessionId, sessionIds))
    .orderBy(checkpoints.createdAt);

  const userIds = [...new Set(sessionsWithData.map(s => s.userId))];
  const allUsers = await db
    .select()
    .from(users)
    .where(inArray(users.id, userIds));

  const allThreadMappings = await db
    .select()
    .from(threadMappings)
    .where(inArray(threadMappings.sessionId, sessionIds));

  const allCrisisEvents = await db
    .select()
    .from(crisisEvents)
    .where(inArray(crisisEvents.sessionId, sessionIds));

  // 4. Separate integration tests from real sessions
  const integrationTests = sessionsWithData.filter(s =>
    (s.metadata as any)?.context === 'Integration test'
  );

  const realSessions = sessionsWithData.filter(s =>
    (s.metadata as any)?.context !== 'Integration test'
  );

  console.log('═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Total sessions with checkpoints: ${sessionsWithData.length}`);
  console.log(`Integration test sessions: ${integrationTests.length}`);
  console.log(`Real user sessions: ${realSessions.length}`);
  console.log(`Total checkpoints: ${allCheckpoints.length}`);
  console.log(`Crisis events: ${allCrisisEvents.length}`);
  console.log(`Thread mappings: ${allThreadMappings.length}\n`);

  // 5. Analyze Integration Test Sessions
  if (integrationTests.length > 0) {
    console.log('═'.repeat(80));
    console.log('INTEGRATION TEST SESSIONS');
    console.log('═'.repeat(80));

    for (const session of integrationTests) {
      const user = allUsers.find(u => u.id === session.userId);
      const sessionCheckpoints = allCheckpoints.filter(c => c.sessionId === session.id);
      const threadMapping = allThreadMappings.find(tm => tm.sessionId === session.id);
      const crisisEvent = allCrisisEvents.find(ce => ce.sessionId === session.id);

      console.log(`\n📋 Test Session: ${session.id}`);
      console.log(`  Created: ${new Date(session.startedAt).toLocaleString()}`);
      console.log(`  Status: ${session.status}`);
      console.log(`  Thread ID: ${session.threadId || 'None'}`);
      console.log(`  User: ${user?.externalId || 'Unknown'} (Test: ${user?.isTestAccount ? 'Yes' : 'No'})`);

      if (threadMapping) {
        console.log(`  Thread Mapping: ${threadMapping.threadId} (Source: ${threadMapping.source})`);
      }

      console.log(`\n  Checkpoints (${sessionCheckpoints.length}):`);
      for (const cp of sessionCheckpoints) {
        const value = cp.value as any;
        console.log(`    • ${new Date(cp.createdAt).toLocaleString()}`);
        console.log(`      Key: ${cp.key}`);
        if (value?.message) {
          console.log(`      Message: "${value.message}"`);
        }
        if (value?.messageId) {
          console.log(`      Message ID: ${value.messageId}`);
        }
      }

      if (crisisEvent) {
        console.log(`\n  🚨 Crisis Event:`);
        console.log(`    Level: ${crisisEvent.crisisLevel}`);
        console.log(`    Handled: ${crisisEvent.handled}`);
        console.log(`    Response: ${crisisEvent.response?.substring(0, 100)}...`);
      }
    }
  }

  // 6. Analyze Real Sessions
  if (realSessions.length > 0) {
    console.log('\n');
    console.log('═'.repeat(80));
    console.log('REAL USER SESSIONS (Non-Test)');
    console.log('═'.repeat(80));

    for (const session of realSessions) {
      const user = allUsers.find(u => u.id === session.userId);
      const sessionCheckpoints = allCheckpoints.filter(c => c.sessionId === session.id);
      const metadata = session.metadata as any;

      console.log(`\n📋 Real Session: ${session.id}`);
      console.log(`  Context: ${metadata?.context || 'None'}`);
      console.log(`  Created: ${new Date(session.startedAt).toLocaleString()}`);
      console.log(`  Status: ${session.status}`);
      console.log(`  Thread ID: ${session.threadId || 'None'}`);
      console.log(`  User: ${user?.externalId || 'Unknown'} (Test: ${user?.isTestAccount ? 'Yes' : 'No'})`);

      console.log(`\n  Checkpoints (${sessionCheckpoints.length}):`);
      for (const cp of sessionCheckpoints) {
        const value = cp.value as any;
        console.log(`    • ${new Date(cp.createdAt).toLocaleString()}`);
        console.log(`      Key: ${cp.key}`);

        if (cp.key === 'session-summary' && value) {
          console.log('      Session Summary:');
          if (value.themes) {
            console.log(`        Themes: ${value.themes.join(', ')}`);
          }
          if (value.insights) {
            console.log(`        Insights: ${JSON.stringify(value.insights).substring(0, 200)}...`);
          }
        } else if (value?.message) {
          console.log(`      Message: "${value.message}"`);
        } else {
          console.log(`      Value: ${JSON.stringify(value).substring(0, 200)}...`);
        }
      }
    }
  }

  // 7. Test Pattern Analysis
  console.log('\n');
  console.log('═'.repeat(80));
  console.log('TEST PATTERN ANALYSIS');
  console.log('═'.repeat(80));

  // Group checkpoints by message content
  const messagePatterns = new Map<string, number>();
  for (const cp of allCheckpoints) {
    const value = cp.value as any;
    if (value?.message) {
      const count = messagePatterns.get(value.message) || 0;
      messagePatterns.set(value.message, count + 1);
    }
  }

  console.log('\nMessage Patterns:');
  for (const [message, count] of messagePatterns) {
    console.log(`  "${message}": ${count} occurrences`);
  }

  // Checkpoint key analysis
  const keyPatterns = new Map<string, number>();
  for (const cp of allCheckpoints) {
    const count = keyPatterns.get(cp.key) || 0;
    keyPatterns.set(cp.key, count + 1);
  }

  console.log('\nCheckpoint Keys:');
  for (const [key, count] of keyPatterns) {
    console.log(`  ${key}: ${count} occurrences`);
  }

  // 8. Session without checkpoints analysis
  const allSessions = await db.select().from(sessions);
  const sessionsWithoutCheckpoints = allSessions.filter(s =>
    !sessionIds.includes(s.id)
  );

  console.log('\n');
  console.log('═'.repeat(80));
  console.log('SESSIONS WITHOUT CHECKPOINTS (Local Dev Testing)');
  console.log('═'.repeat(80));
  console.log(`Total: ${sessionsWithoutCheckpoints.length} sessions`);

  // Sample of recent sessions without checkpoints
  const recentEmptySessions = sessionsWithoutCheckpoints
    .sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime())
    .slice(0, 5);

  console.log('\nMost Recent Sessions Without Checkpoints:');
  for (const session of recentEmptySessions) {
    const metadata = session.metadata as any;
    console.log(`  • ${session.id.substring(0, 8)}... - ${new Date(session.lastActiveAt).toLocaleString()}`);
    console.log(`    Context: ${metadata?.context || 'None'}`);
    console.log(`    Thread ID: ${session.threadId || 'None'}`);
  }

  // 9. MCP Tool Usage Analysis
  console.log('\n');
  console.log('═'.repeat(80));
  console.log('MCP TOOL USAGE EFFECTIVENESS');
  console.log('═'.repeat(80));

  const totalSessions = allSessions.length;
  const sessionsWithCheckpointsCount = sessionIds.length;
  const checkpointCoverage = (sessionsWithCheckpointsCount / totalSessions * 100).toFixed(2);

  console.log(`Total Sessions: ${totalSessions}`);
  console.log(`Sessions with Checkpoints: ${sessionsWithCheckpointsCount} (${checkpointCoverage}%)`);
  console.log(`Sessions without Checkpoints: ${sessionsWithoutCheckpoints.length} (${(100 - parseFloat(checkpointCoverage)).toFixed(2)}%)`);
  console.log(`\nAverage Checkpoints per Session (with data): ${(allCheckpoints.length / sessionsWithCheckpointsCount).toFixed(2)}`);

  // Thread ID coverage
  const sessionsWithThreads = allSessions.filter(s => s.threadId !== null);
  console.log(`\nSessions with Thread IDs: ${sessionsWithThreads.length} (${(sessionsWithThreads.length / totalSessions * 100).toFixed(2)}%)`);
  console.log(`Sessions with Thread Mappings: ${allThreadMappings.length}`);

  // Crisis detection
  console.log(`\nCrisis Events Detected: ${allCrisisEvents.length}`);
  if (allCrisisEvents.length > 0) {
    const handledCrisis = allCrisisEvents.filter(ce => ce.handled);
    console.log(`Crisis Events Handled: ${handledCrisis.length} (${(handledCrisis.length / allCrisisEvents.length * 100).toFixed(2)}%)`);
  }

  process.exit(0);
}

analyzeIntegrationTests().catch(console.error);