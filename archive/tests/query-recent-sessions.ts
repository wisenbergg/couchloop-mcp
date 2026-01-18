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
import { eq, desc, inArray } from 'drizzle-orm';

async function queryRecentSessions() {
  await initDatabase();
  const db = getDb();

  if (!db) {
    console.error('Database not initialized');
    process.exit(1);
  }

  console.log('=== 3 Most Recent MCP Sessions ===\n');
  console.log(`Query Time: ${new Date().toISOString()}`);
  console.log('Database: CouchLoop MCP Production\n');

  // 1. Get 3 most recent sessions ordered by lastActiveAt
  const recentSessions = await db
    .select()
    .from(sessions)
    .orderBy(desc(sessions.lastActiveAt))
    .limit(3);

  if (recentSessions.length === 0) {
    console.log('No sessions found in database');
    process.exit(0);
  }

  console.log(`Found ${recentSessions.length} recent sessions\n`);

  const sessionIds = recentSessions.map(s => s.id);
  const userIds = [...new Set(recentSessions.map(s => s.userId))];
  const journeyIds = recentSessions
    .map(s => s.journeyId)
    .filter((id): id is string => id !== null);

  // 2. Get all related data in parallel
  console.log('Fetching related data...\n');

  const [
    allCheckpoints,
    allInsights,
    allUsers,
    allJourneys,
    allCrisisEvents,
    allThreadMappings
  ] = await Promise.all([
    db.select().from(checkpoints)
      .where(inArray(checkpoints.sessionId, sessionIds))
      .orderBy(checkpoints.createdAt),

    db.select().from(insights)
      .where(inArray(insights.sessionId, sessionIds))
      .orderBy(desc(insights.createdAt)),

    db.select().from(users)
      .where(inArray(users.id, userIds)),

    journeyIds.length > 0
      ? db.select().from(journeys).where(inArray(journeys.id, journeyIds))
      : Promise.resolve([]),

    db.select().from(crisisEvents)
      .where(inArray(crisisEvents.sessionId, sessionIds))
      .orderBy(desc(crisisEvents.createdAt)),

    db.select().from(threadMappings)
      .where(inArray(threadMappings.sessionId, sessionIds))
      .orderBy(desc(threadMappings.createdAt))
  ]);

  // 3. Organize and display results
  for (let index = 0; index < recentSessions.length; index++) {
    const session = recentSessions[index];
    const user = allUsers.find(u => u.id === session.userId);
    const journey = allJourneys.find(j => j.id === session.journeyId);
    const sessionCheckpoints = allCheckpoints.filter(c => c.sessionId === session.id);
    const sessionInsights = allInsights.filter(i => i.sessionId === session.id);
    const sessionCrisis = allCrisisEvents.filter(c => c.sessionId === session.id);
    const sessionThreads = allThreadMappings.filter(t => t.sessionId === session.id);

    console.log('═'.repeat(80));
    console.log(`SESSION #${index + 1} (Most Recent ${index === 0 ? '- LATEST' : ''})`);
    console.log('═'.repeat(80));

    console.log('\n📋 Session Details:');
    console.log(`  ID:           ${session.id}`);
    console.log(`  Status:       ${session.status}`);
    console.log(`  Current Step: ${session.currentStep}`);
    console.log(`  Started:      ${new Date(session.startedAt).toLocaleString()}`);
    console.log(`  Last Active:  ${new Date(session.lastActiveAt).toLocaleString()}`);
    console.log(`  Completed:    ${session.completedAt ? new Date(session.completedAt).toLocaleString() : 'Not completed'}`);
    console.log(`  Thread ID:    ${session.threadId || 'None'}`);
    console.log(`  Last Synced:  ${session.lastSyncedAt ? new Date(session.lastSyncedAt).toLocaleString() : 'Never'}`);

    if (session.metadata && Object.keys(session.metadata).length > 0) {
      console.log('  Metadata:');
      console.log('    ' + JSON.stringify(session.metadata, null, 2).replace(/\n/g, '\n    '));
    }

    console.log('\n👤 User:');
    if (user) {
      console.log(`  ID:           ${user.id}`);
      console.log(`  External ID:  ${user.externalId || 'None'}`);
      console.log(`  Test Account: ${user.isTestAccount ? 'Yes' : 'No'}`);
      console.log(`  Created:      ${new Date(user.createdAt).toLocaleString()}`);
      if (user.preferences && Object.keys(user.preferences).length > 0) {
        console.log('  Preferences:');
        console.log('    ' + JSON.stringify(user.preferences, null, 2).replace(/\n/g, '\n    '));
      }
    } else {
      console.log('  User not found');
    }

    if (journey) {
      console.log('\n🗺️  Journey:');
      console.log(`  ID:          ${journey.id}`);
      console.log(`  Name:        ${journey.name}`);
      console.log(`  Slug:        ${journey.slug}`);
      console.log(`  Description: ${journey.description}`);
      console.log(`  Est Minutes: ${journey.estimatedMinutes}`);
      console.log(`  Tags:        ${journey.tags?.join(', ') || 'None'}`);
      const steps = journey.steps as any;
      console.log(`  Total Steps: ${steps?.length || 0}`);
      console.log(`  Progress:    Step ${session.currentStep} of ${steps?.length || 0}`);
    } else if (session.journeyId) {
      console.log('\n🗺️  Journey: Referenced but not found');
    }

    if (sessionCheckpoints.length > 0) {
      console.log(`\n📍 Checkpoints (${sessionCheckpoints.length}):`);
      for (const checkpoint of sessionCheckpoints) {
        console.log(`  • ${new Date(checkpoint.createdAt).toLocaleString()}`);
        console.log(`    Step ID: ${checkpoint.stepId}`);
        console.log(`    Key: ${checkpoint.key}`);
        const value = checkpoint.value as any;
        if (value?.message) {
          console.log(`    Message: "${value.message}"`);
        } else {
          console.log(`    Value: ${JSON.stringify(value).substring(0, 100)}${JSON.stringify(value).length > 100 ? '...' : ''}`);
        }
      }
    } else {
      console.log('\n📍 Checkpoints: None');
    }

    if (sessionInsights.length > 0) {
      console.log(`\n💡 Insights (${sessionInsights.length}):`);
      for (const insight of sessionInsights) {
        console.log(`  • ${new Date(insight.createdAt).toLocaleString()}`);
        console.log(`    "${insight.content}"`);
        if (insight.tags?.length > 0) {
          console.log(`    Tags: ${insight.tags.join(', ')}`);
        }
      }
    } else {
      console.log('\n💡 Insights: None');
    }

    if (sessionCrisis.length > 0) {
      console.log(`\n🚨 Crisis Events (${sessionCrisis.length}):`);
      for (const crisis of sessionCrisis) {
        console.log(`  • ${new Date(crisis.createdAt).toLocaleString()}`);
        console.log(`    Level: ${crisis.crisisLevel}`);
        console.log(`    Handled: ${crisis.handled ? 'Yes' : 'No'}`);
        if (crisis.response) {
          console.log(`    Response: "${crisis.response.substring(0, 100)}${crisis.response.length > 100 ? '...' : ''}"`);
        }
        if (crisis.escalationPath) {
          console.log(`    Escalation: ${crisis.escalationPath}`);
        }
      }
    }

    if (sessionThreads.length > 0) {
      console.log(`\n🔗 Thread Mappings (${sessionThreads.length}):`);
      for (const thread of sessionThreads) {
        console.log(`  • Thread ID: ${thread.threadId}`);
        console.log(`    Source: ${thread.source}`);
        console.log(`    Created: ${new Date(thread.createdAt).toLocaleString()}`);
        if (thread.metadata) {
          console.log(`    Metadata: ${JSON.stringify(thread.metadata)}`);
        }
      }
    }

    // Calculate session duration
    const duration = new Date(session.lastActiveAt).getTime() - new Date(session.startedAt).getTime();
    const durationMinutes = Math.round(duration / 1000 / 60);
    console.log(`\n⏱️  Duration: ${durationMinutes} minutes`);

    console.log('\n');
  }

  // Summary statistics
  console.log('═'.repeat(80));
  console.log('SUMMARY STATISTICS');
  console.log('═'.repeat(80));
  console.log(`Total sessions queried: ${recentSessions.length}`);
  console.log(`Total checkpoints: ${allCheckpoints.length}`);
  console.log(`Total insights: ${allInsights.length}`);
  console.log(`Total crisis events: ${allCrisisEvents.length}`);
  console.log(`Total thread mappings: ${allThreadMappings.length}`);

  const statusCounts = recentSessions.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('\nSession Status Distribution:');
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  ${status}: ${count}`);
  }

  process.exit(0);
}

queryRecentSessions().catch(console.error);