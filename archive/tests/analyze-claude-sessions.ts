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
import { eq, desc, inArray, isNotNull, and, or, like } from 'drizzle-orm';

async function analyzeClaudeSessions() {
  await initDatabase();
  const db = getDb();

  if (!db) {
    console.error('Database not initialized');
    process.exit(1);
  }

  console.log('═'.repeat(80));
  console.log('CLAUDE MCP SESSION ANALYSIS');
  console.log('═'.repeat(80));
  console.log(`\nAnalysis Time: ${new Date().toISOString()}\n`);

  // Look for sessions that might be from Claude
  // Claude sessions might have different patterns than ChatGPT integration tests

  // First, let's look at all thread mappings to see sources
  const allThreadMappings = await db
    .select()
    .from(threadMappings)
    .orderBy(desc(threadMappings.createdAt));

  console.log('═'.repeat(80));
  console.log('THREAD MAPPING SOURCES');
  console.log('═'.repeat(80));

  if (allThreadMappings.length > 0) {
    const sources = new Set(allThreadMappings.map(tm => tm.source));
    console.log(`Unique sources found: ${Array.from(sources).join(', ')}`);

    // Look for Claude-specific mappings
    const claudeMappings = allThreadMappings.filter(tm =>
      tm.source?.toLowerCase().includes('claude') ||
      tm.source === 'mcp'
    );

    if (claudeMappings.length > 0) {
      console.log(`\nClaude thread mappings found: ${claudeMappings.length}`);
      for (const mapping of claudeMappings) {
        console.log(`  Session: ${mapping.sessionId}`);
        console.log(`  Source: ${mapping.source}`);
        console.log(`  Created: ${new Date(mapping.createdAt).toLocaleString()}`);
      }
    }
  } else {
    console.log('No thread mappings found\n');
  }

  // Look for the Emily session specifically (we know this was a real conversation)
  const emilySession = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, 'b28354c3-0586-479d-ba75-c8520c4776f4'))
    .limit(1);

  if (emilySession.length > 0) {
    console.log('═'.repeat(80));
    console.log('EMILY SESSION (Known Claude Conversation)');
    console.log('═'.repeat(80));

    const session = emilySession[0];
    console.log(`\nSession ID: ${session.id}`);
    console.log(`Status: ${session.status}`);
    console.log(`Started: ${new Date(session.startedAt).toLocaleString()}`);
    console.log(`Thread ID: ${session.threadId}`);
    console.log(`Metadata: ${JSON.stringify(session.metadata)}`);

    // Check for any data
    const emilyCheckpoints = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.sessionId, session.id));

    const emilyInsights = await db
      .select()
      .from(insights)
      .where(eq(insights.sessionId, session.id));

    console.log(`\nCheckpoints: ${emilyCheckpoints.length}`);
    console.log(`Insights: ${emilyInsights.length}`);

    if (emilyCheckpoints.length === 0) {
      console.log('⚠️  No checkpoints saved - MCP tools were not called during conversation');
    }
  }

  // Look for sessions without "Integration test" context (likely real sessions)
  console.log('\n');
  console.log('═'.repeat(80));
  console.log('NON-TEST SESSIONS (Potential Claude Sessions)');
  console.log('═'.repeat(80));

  const allSessions = await db.select().from(sessions);

  // Filter out integration test sessions
  const nonTestSessions = allSessions.filter(s => {
    const metadata = s.metadata as any;
    return metadata?.context !== 'Integration test';
  });

  console.log(`\nFound ${nonTestSessions.length} non-test sessions\n`);

  // Group by context
  const contextGroups = new Map<string, typeof nonTestSessions>();
  for (const session of nonTestSessions) {
    const metadata = session.metadata as any;
    const context = metadata?.context || 'No context';

    if (!contextGroups.has(context)) {
      contextGroups.set(context, []);
    }
    contextGroups.get(context)!.push(session);
  }

  // Display sessions grouped by context
  for (const [context, sessions] of contextGroups) {
    console.log(`\nContext: "${context}"`);
    console.log(`Sessions: ${sessions.length}`);

    // Show recent sessions with this context
    const recentSessions = sessions
      .sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime())
      .slice(0, 3);

    for (const session of recentSessions) {
      const checkpointCount = await db
        .select({ count: checkpoints.id })
        .from(checkpoints)
        .where(eq(checkpoints.sessionId, session.id));

      console.log(`  • ${session.id.substring(0, 8)}... - ${new Date(session.lastActiveAt).toLocaleString()}`);
      console.log(`    Status: ${session.status}`);
      console.log(`    Thread ID: ${session.threadId || 'None'}`);
      console.log(`    Checkpoints: ${checkpointCount.length}`);

      // Get user info
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);

      if (user[0]) {
        console.log(`    User: ${user[0].externalId || 'Unknown'}`);
        console.log(`    Test Account: ${user[0].isTestAccount ? 'Yes' : 'No'}`);
      }
    }
  }

  // Look for sessions created today that might be from Claude
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todaysSessions = allSessions.filter(s =>
    new Date(s.startedAt) >= today
  );

  console.log('\n');
  console.log('═'.repeat(80));
  console.log('TODAY\'S SESSIONS (Potential Claude Activity)');
  console.log('═'.repeat(80));
  console.log(`\nTotal sessions today: ${todaysSessions.length}`);

  if (todaysSessions.length > 0) {
    // Check how many have checkpoints
    const sessionsWithData = [];
    const sessionsWithoutData = [];

    for (const session of todaysSessions) {
      const checkpointCount = await db
        .select({ count: checkpoints.id })
        .from(checkpoints)
        .where(eq(checkpoints.sessionId, session.id));

      if (checkpointCount.length > 0) {
        sessionsWithData.push(session);
      } else {
        sessionsWithoutData.push(session);
      }
    }

    console.log(`Sessions with checkpoints: ${sessionsWithData.length}`);
    console.log(`Sessions without checkpoints: ${sessionsWithoutData.length}`);

    // Show sessions without data (likely Claude sessions where tools weren't called)
    if (sessionsWithoutData.length > 0) {
      console.log(`\nRecent sessions without checkpoints (likely Claude with no tool calls):`);
      for (const session of sessionsWithoutData.slice(0, 5)) {
        const metadata = session.metadata as any;
        console.log(`  • ${session.id.substring(0, 8)}... - ${new Date(session.startedAt).toLocaleString()}`);
        console.log(`    Context: ${metadata?.context || 'None'}`);
        console.log(`    Thread ID: ${session.threadId || 'None'}`);
      }
    }
  }

  // Check for patterns that might indicate Claude vs ChatGPT
  console.log('\n');
  console.log('═'.repeat(80));
  console.log('SESSION PATTERNS ANALYSIS');
  console.log('═'.repeat(80));

  // Check external IDs for patterns
  const allUsers = await db.select().from(users);

  const externalIdPatterns = new Map<string, number>();
  for (const user of allUsers) {
    if (user.externalId) {
      const prefix = user.externalId.split('_')[0];
      externalIdPatterns.set(prefix, (externalIdPatterns.get(prefix) || 0) + 1);
    }
  }

  console.log('\nUser External ID Patterns:');
  for (const [prefix, count] of externalIdPatterns) {
    console.log(`  ${prefix}_*: ${count} users`);
  }

  // Look for sessions with specific metadata patterns
  const sessionsByMetadataKeys = new Map<string, number>();
  for (const session of allSessions) {
    const metadata = session.metadata as any;
    if (metadata && typeof metadata === 'object') {
      const keys = Object.keys(metadata).sort().join(',');
      sessionsByMetadataKeys.set(keys, (sessionsByMetadataKeys.get(keys) || 0) + 1);
    }
  }

  console.log('\nMetadata Key Patterns:');
  for (const [keys, count] of sessionsByMetadataKeys) {
    console.log(`  [${keys}]: ${count} sessions`);
  }

  // Summary
  console.log('\n');
  console.log('═'.repeat(80));
  console.log('CLAUDE SESSION SUMMARY');
  console.log('═'.repeat(80));

  const sessionsWithCheckpoints = await db
    .selectDistinct({ sessionId: checkpoints.sessionId })
    .from(checkpoints);

  const sessionIdsWithCheckpoints = sessionsWithCheckpoints.map(s => s.sessionId).filter(id => id !== null);

  console.log(`\nTotal Sessions: ${allSessions.length}`);
  console.log(`Sessions with Checkpoints: ${sessionIdsWithCheckpoints.length}`);
  console.log(`Sessions without Checkpoints: ${allSessions.length - sessionIdsWithCheckpoints.length}`);

  console.log('\nKnown Patterns:');
  console.log('  • Integration test sessions have "Integration test" context');
  console.log('  • Emily session (b28354c3-0586-479d-ba75-c8520c4776f4) is confirmed Claude');
  console.log('  • Sessions without checkpoints are likely Claude/ChatGPT where MCP tools weren\'t called');
  console.log('  • Test accounts have isTestAccount: true');

  process.exit(0);
}

analyzeClaudeSessions().catch(console.error);