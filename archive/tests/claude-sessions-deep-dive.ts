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
import { eq, desc, inArray, isNotNull, and, or, like, sql } from 'drizzle-orm';

async function claudeSessionsDeepDive() {
  await initDatabase();
  const db = getDb();

  if (!db) {
    console.error('Database not initialized');
    process.exit(1);
  }

  console.log('═'.repeat(80));
  console.log('CLAUDE MCP SESSION DEEP DIVE');
  console.log('═'.repeat(80));
  console.log(`\nAnalysis Time: ${new Date().toISOString()}\n`);

  // 1. Emily Session - Our confirmed Claude conversation
  console.log('═'.repeat(80));
  console.log('CONFIRMED CLAUDE SESSION: EMILY');
  console.log('═'.repeat(80));

  const emilySessionId = 'b28354c3-0586-479d-ba75-c8520c4776f4';

  const emilySession = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, emilySessionId))
    .limit(1);

  if (emilySession.length > 0) {
    const session = emilySession[0];
    const user = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);

    console.log('\n📋 Session Details:');
    console.log(`  ID: ${session.id}`);
    console.log(`  Status: ${session.status}`);
    console.log(`  Started: ${new Date(session.startedAt).toLocaleString()}`);
    console.log(`  Last Active: ${new Date(session.lastActiveAt).toLocaleString()}`);
    console.log(`  Thread ID: ${session.threadId || 'None'}`);
    console.log(`  Journey ID: ${session.journeyId || 'None'}`);
    console.log(`  Current Step: ${session.currentStep}`);
    console.log(`  Metadata: ${JSON.stringify(session.metadata)}`);

    console.log('\n👤 User:');
    if (user[0]) {
      console.log(`  User ID: ${user[0].id}`);
      console.log(`  External ID: ${user[0].externalId}`);
      console.log(`  Test Account: ${user[0].isTestAccount}`);
      console.log(`  Created: ${new Date(user[0].createdAt).toLocaleString()}`);
    }

    // Check for any data capture
    const checkpointCount = await db.select({ count: sql<number>`count(*)` })
      .from(checkpoints)
      .where(eq(checkpoints.sessionId, session.id));

    const insightCount = await db.select({ count: sql<number>`count(*)` })
      .from(insights)
      .where(eq(insights.sessionId, session.id));

    const crisisCount = await db.select({ count: sql<number>`count(*)` })
      .from(crisisEvents)
      .where(eq(crisisEvents.sessionId, session.id));

    const threadMapping = await db.select()
      .from(threadMappings)
      .where(eq(threadMappings.sessionId, session.id))
      .limit(1);

    console.log('\n📊 Data Capture Status:');
    console.log(`  Checkpoints: ${checkpointCount[0]?.count || 0}`);
    console.log(`  Insights: ${insightCount[0]?.count || 0}`);
    console.log(`  Crisis Events: ${crisisCount[0]?.count || 0}`);
    console.log(`  Thread Mapping: ${threadMapping.length > 0 ? 'Yes' : 'No'}`);

    console.log('\n⚠️  MCP Tool Usage:');
    if ((checkpointCount[0]?.count || 0) === 0) {
      console.log('  ❌ No checkpoints saved - save_checkpoint tool not called');
    }
    if ((insightCount[0]?.count || 0) === 0) {
      console.log('  ❌ No insights saved - save_insight tool not called');
    }
    if ((crisisCount[0]?.count || 0) === 0) {
      console.log('  ❌ No crisis events - Crisis detection not triggered');
    }
    if (threadMapping.length === 0) {
      console.log('  ❌ No thread mapping - Integration incomplete');
    }
  } else {
    console.log('\n⚠️  Emily session not found in database');
  }

  // 2. Find other potential Claude sessions (non-test, no checkpoints)
  console.log('\n');
  console.log('═'.repeat(80));
  console.log('OTHER POTENTIAL CLAUDE SESSIONS');
  console.log('═'.repeat(80));

  // Sessions without checkpoints and not test sessions
  const allSessions = await db.select().from(sessions);

  // Get sessions that have checkpoints
  const sessionsWithCheckpoints = await db
    .selectDistinct({ sessionId: checkpoints.sessionId })
    .from(checkpoints);

  const sessionIdsWithCheckpoints = sessionsWithCheckpoints
    .map(s => s.sessionId)
    .filter(id => id !== null) as string[];

  // Filter for non-test sessions without checkpoints
  const potentialClaudeSessions = allSessions.filter(s => {
    const metadata = s.metadata as any;
    const isTestSession = metadata?.context === 'Integration test';
    const hasCheckpoints = sessionIdsWithCheckpoints.includes(s.id);
    const isEmilySession = s.id === emilySessionId;

    return !isTestSession && !hasCheckpoints && !isEmilySession;
  });

  console.log(`\nFound ${potentialClaudeSessions.length} potential Claude sessions (non-test, no checkpoints)\n`);

  // Group by date
  const sessionsByDate = new Map<string, typeof potentialClaudeSessions>();

  for (const session of potentialClaudeSessions) {
    const date = new Date(session.startedAt).toLocaleDateString();
    if (!sessionsByDate.has(date)) {
      sessionsByDate.set(date, []);
    }
    sessionsByDate.get(date)!.push(session);
  }

  // Show recent sessions by date
  const sortedDates = Array.from(sessionsByDate.keys())
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
    .slice(0, 7); // Last 7 days

  for (const date of sortedDates) {
    const dateSessions = sessionsByDate.get(date)!;
    console.log(`\n📅 ${date} (${dateSessions.length} sessions):`);

    // Show up to 3 sessions per day
    for (const session of dateSessions.slice(0, 3)) {
      const metadata = session.metadata as any;
      const user = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);

      console.log(`\n  • Session: ${session.id.substring(0, 8)}...`);
      console.log(`    Time: ${new Date(session.startedAt).toLocaleTimeString()}`);
      console.log(`    Status: ${session.status}`);
      console.log(`    Thread ID: ${session.threadId || 'None'}`);
      console.log(`    User: ${user[0]?.externalId || 'Unknown'}`);
      console.log(`    Context: ${metadata?.context || 'None'}`);

      // Calculate session duration
      const duration = new Date(session.lastActiveAt).getTime() - new Date(session.startedAt).getTime();
      const minutes = Math.round(duration / 1000 / 60);
      if (minutes > 0) {
        console.log(`    Duration: ${minutes} minutes`);
      }
    }
  }

  // 3. Analyze patterns
  console.log('\n');
  console.log('═'.repeat(80));
  console.log('CLAUDE SESSION PATTERNS');
  console.log('═'.repeat(80));

  // Sessions with thread IDs but no checkpoints
  const sessionsWithThreadNoCheckpoints = potentialClaudeSessions.filter(s => s.threadId !== null);

  console.log('\n📈 Pattern Analysis:');
  console.log(`  Total potential Claude sessions: ${potentialClaudeSessions.length}`);
  console.log(`  Sessions with thread IDs: ${sessionsWithThreadNoCheckpoints.length}`);
  console.log(`  Sessions without thread IDs: ${potentialClaudeSessions.length - sessionsWithThreadNoCheckpoints.length}`);

  // Status distribution
  const statusCounts = new Map<string, number>();
  for (const session of potentialClaudeSessions) {
    const status = session.status;
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
  }

  console.log('\n  Status Distribution:');
  for (const [status, count] of statusCounts) {
    const percentage = ((count / potentialClaudeSessions.length) * 100).toFixed(1);
    console.log(`    ${status}: ${count} (${percentage}%)`);
  }

  // Average session duration
  const durations = potentialClaudeSessions.map(s => {
    return new Date(s.lastActiveAt).getTime() - new Date(s.startedAt).getTime();
  }).filter(d => d > 0);

  if (durations.length > 0) {
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const avgMinutes = Math.round(avgDuration / 1000 / 60);
    console.log(`\n  Average session duration: ${avgMinutes} minutes`);
  }

  // 4. Thread mapping analysis
  console.log('\n');
  console.log('═'.repeat(80));
  console.log('THREAD MAPPING INVESTIGATION');
  console.log('═'.repeat(80));

  const allThreadMappings = await db.select().from(threadMappings);

  if (allThreadMappings.length === 0) {
    console.log('\n⚠️  No thread mappings found in database');
    console.log('  This indicates MCP → Shrink-Chat integration is not working');

    // Check how many sessions have thread IDs
    const sessionsWithThreads = allSessions.filter(s => s.threadId !== null);
    console.log(`\n  ${sessionsWithThreads.length} sessions have thread IDs but no mappings`);

    if (sessionsWithThreads.length > 0) {
      console.log('\n  Sample sessions with thread IDs:');
      for (const session of sessionsWithThreads.slice(0, 5)) {
        console.log(`    • ${session.id.substring(0, 8)}... → Thread: ${session.threadId}`);
      }
    }
  } else {
    console.log(`\nFound ${allThreadMappings.length} thread mappings`);

    const sources = new Map<string, number>();
    for (const mapping of allThreadMappings) {
      const source = mapping.source || 'unknown';
      sources.set(source, (sources.get(source) || 0) + 1);
    }

    console.log('\nSources:');
    for (const [source, count] of sources) {
      console.log(`  ${source}: ${count}`);
    }
  }

  // 5. Summary and recommendations
  console.log('\n');
  console.log('═'.repeat(80));
  console.log('CLAUDE MCP INTEGRATION SUMMARY');
  console.log('═'.repeat(80));

  console.log('\n🔍 Key Findings:');
  console.log('  1. Emily session (confirmed Claude) has 0 checkpoints despite full conversation');
  console.log(`  2. ${potentialClaudeSessions.length} other potential Claude sessions found`);
  console.log('  3. No thread mappings exist in database');
  console.log('  4. MCP tools (save_checkpoint, save_insight) not being invoked');
  console.log('  5. Sessions are created but conversation data not captured');

  console.log('\n🚨 Critical Issues:');
  console.log('  • MCP tools not exposed/called during Claude conversations');
  console.log('  • Thread mapping to Shrink-Chat not functioning');
  console.log('  • Crisis detection system not triggering');
  console.log('  • Session data exists in Shrink-Chat but not synced to MCP');

  console.log('\n💡 Recommendations:');
  console.log('  1. Verify MCP server is properly configured in Claude Desktop');
  console.log('  2. Ensure tools are exposed in server manifest');
  console.log('  3. Check if Claude is actually calling the tools');
  console.log('  4. Review OAuth flow for proper user/session linking');
  console.log('  5. Implement thread mapping creation on session start');

  // 6. Check for today's activity
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todaysSessions = potentialClaudeSessions.filter(s =>
    new Date(s.startedAt) >= today
  );

  if (todaysSessions.length > 0) {
    console.log('\n');
    console.log('═'.repeat(80));
    console.log(`TODAY'S CLAUDE ACTIVITY (${new Date().toLocaleDateString()})`)
    console.log('═'.repeat(80));
    console.log(`\n${todaysSessions.length} potential Claude sessions today\n`);

    for (const session of todaysSessions) {
      console.log(`• ${session.id.substring(0, 8)}... - ${new Date(session.startedAt).toLocaleTimeString()}`);
      console.log(`  Status: ${session.status}, Thread: ${session.threadId || 'None'}`);
    }
  }

  // 7. Integration test sessions for comparison
  console.log('\n');
  console.log('═'.repeat(80));
  console.log('INTEGRATION TEST SESSIONS (FOR COMPARISON)');
  console.log('═'.repeat(80));

  const integrationTestSessions = allSessions.filter(s => {
    const metadata = s.metadata as any;
    return metadata?.context === 'Integration test';
  });

  console.log(`\nFound ${integrationTestSessions.length} integration test sessions`);

  if (integrationTestSessions.length > 0) {
    // Show how many have checkpoints
    const testsWithCheckpoints = integrationTestSessions.filter(s =>
      sessionIdsWithCheckpoints.includes(s.id)
    );

    console.log(`Sessions with checkpoints: ${testsWithCheckpoints.length} (${(testsWithCheckpoints.length / integrationTestSessions.length * 100).toFixed(1)}%)`);

    // Show recent test sessions
    const recentTests = integrationTestSessions
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, 3);

    console.log('\nRecent test sessions:');
    for (const test of recentTests) {
      const checkpointCount = await db.select({ count: sql<number>`count(*)` })
        .from(checkpoints)
        .where(eq(checkpoints.sessionId, test.id));

      console.log(`  • ${test.id.substring(0, 8)}... - ${new Date(test.startedAt).toLocaleString()}`);
      console.log(`    Checkpoints: ${checkpointCount[0]?.count || 0}`);
      console.log(`    Thread ID: ${test.threadId || 'None'}`);
    }
  }

  process.exit(0);
}

claudeSessionsDeepDive().catch(console.error);