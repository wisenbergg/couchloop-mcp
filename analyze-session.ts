import { initDatabase, getDb } from './src/db/client';
import { sessions, checkpoints, insights, users, journeys } from './src/db/schema';
import { eq } from 'drizzle-orm';
import { writeFileSync } from 'fs';

async function analyzeSession(sessionId: string) {
  await initDatabase();
  const db = getDb();

  if (!db) {
    console.error('Database not initialized');
    process.exit(1);
  }

  // Get session details
  const [session] = await db.select().from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session) {
    console.error(`Session ${sessionId} not found`);
    process.exit(1);
  }

  // Get user details
  const [user] = await db.select().from(users)
    .where(eq(users.id, session.userId));

  // Get journey details if applicable
  let journey = null;
  if (session.journeyId) {
    const [journeyData] = await db.select().from(journeys)
      .where(eq(journeys.id, session.journeyId));
    journey = journeyData;
  }

  // Get all checkpoints for this session
  const sessionCheckpoints = await db.select().from(checkpoints)
    .where(eq(checkpoints.sessionId, sessionId))
    .orderBy(checkpoints.createdAt);

  // Get all insights for this user during this session timeframe
  const sessionInsights = await db.select().from(insights)
    .where(eq(insights.userId, session.userId))
    .orderBy(insights.createdAt);

  // Create comprehensive analysis document
  const analysis = {
    sessionAnalysis: {
      sessionId: session.id,
      status: session.status,
      startedAt: session.startedAt,
      lastActiveAt: session.lastActiveAt,
      completedAt: session.completedAt,
      duration: session.lastActiveAt ?
        (new Date(session.lastActiveAt).getTime() - new Date(session.startedAt).getTime()) / 1000 / 60 : 0,
      metadata: session.metadata,
      threadId: session.threadId,
      currentStep: session.currentStep,
    },
    userInformation: user ? {
      userId: user.id,
      name: user.name,
      email: user.email,
      preferences: user.preferences,
      metadata: user.metadata,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    } : null,
    journeyInformation: journey ? {
      journeyId: journey.id,
      name: journey.name,
      description: journey.description,
      steps: journey.steps,
      metadata: journey.metadata,
    } : null,
    checkpoints: sessionCheckpoints.map(cp => ({
      id: cp.id,
      stepId: cp.stepId,
      key: cp.key,
      value: cp.value,
      createdAt: cp.createdAt,
      timeSinceStart: (new Date(cp.createdAt).getTime() - new Date(session.startedAt).getTime()) / 1000,
    })),
    insights: sessionInsights.map(insight => ({
      id: insight.id,
      sessionId: insight.sessionId,
      content: insight.content,
      type: insight.type,
      createdAt: insight.createdAt,
    })),
    summary: {
      totalCheckpoints: sessionCheckpoints.length,
      totalInsights: sessionInsights.length,
      sessionDurationMinutes: session.lastActiveAt ?
        (new Date(session.lastActiveAt).getTime() - new Date(session.startedAt).getTime()) / 1000 / 60 : 0,
      journeyProgress: journey && session.currentStep !== null ?
        `Step ${session.currentStep} of ${(journey.steps as any[]).length}` : 'N/A',
      isCompleted: session.status === 'completed',
    }
  };

  // Output as formatted JSON
  const jsonOutput = JSON.stringify(analysis, null, 2);

  // Save to file
  const filename = `session-analysis-${sessionId}.json`;
  writeFileSync(filename, jsonOutput);

  console.log(`Analysis saved to ${filename}`);

  // Also create a markdown report
  const markdownReport = `# Session Analysis Report
## Session ID: ${session.id}

### Session Overview
- **Status:** ${session.status}
- **Started:** ${new Date(session.startedAt).toLocaleString()}
- **Last Active:** ${new Date(session.lastActiveAt).toLocaleString()}
- **Duration:** ${analysis.summary.sessionDurationMinutes.toFixed(2)} minutes
- **Thread ID:** ${session.threadId || 'None'}
- **Current Step:** ${session.currentStep !== null ? session.currentStep : 'N/A'}

### Context
${session.metadata ? JSON.stringify(session.metadata, null, 2) : 'No metadata'}

### User Information
${user ? `
- **User ID:** ${user.id}
- **Name:** ${user.name || 'Not provided'}
- **Email:** ${user.email || 'Not provided'}
- **Created:** ${new Date(user.createdAt).toLocaleString()}
` : 'User information not available'}

### Journey Information
${journey ? `
- **Journey:** ${journey.name}
- **Description:** ${journey.description}
- **Total Steps:** ${(journey.steps as any[]).length}
- **Current Progress:** Step ${session.currentStep} of ${(journey.steps as any[]).length}
` : 'Not part of a guided journey'}

### Checkpoints (${sessionCheckpoints.length} total)
${sessionCheckpoints.length > 0 ? sessionCheckpoints.map((cp, index) => {
  const value = cp.value as any;
  const timeSinceStart = (new Date(cp.createdAt).getTime() - new Date(session.startedAt).getTime()) / 1000;
  return `
#### Checkpoint ${index + 1}
- **Time:** ${new Date(cp.createdAt).toLocaleString()} (${timeSinceStart.toFixed(0)}s from start)
- **Step ID:** ${cp.stepId}
- **Key:** ${cp.key}
- **Value:** ${value?.message ? `"${value.message}"` : JSON.stringify(value, null, 2)}
`;
}).join('\n') : 'No checkpoints recorded'}

### Insights (${sessionInsights.length} total)
${sessionInsights.length > 0 ? sessionInsights.map((insight, index) => `
#### Insight ${index + 1}
- **Time:** ${new Date(insight.createdAt).toLocaleString()}
- **Type:** ${insight.type || 'general'}
- **Content:** ${insight.content}
`).join('\n') : 'No insights recorded'}

### Analysis Summary
- **Total Checkpoints:** ${sessionCheckpoints.length}
- **Total Insights:** ${sessionInsights.length}
- **Session Duration:** ${analysis.summary.sessionDurationMinutes.toFixed(2)} minutes
- **Journey Progress:** ${analysis.summary.journeyProgress}
- **Completed:** ${analysis.summary.isCompleted ? 'Yes' : 'No'}

### Raw Data
\`\`\`json
${JSON.stringify(analysis, null, 2)}
\`\`\`
`;

  const mdFilename = `session-analysis-${sessionId}.md`;
  writeFileSync(mdFilename, markdownReport);
  console.log(`Markdown report saved to ${mdFilename}`);

  // Display key findings
  console.log('\n=== KEY FINDINGS ===');
  console.log(`Session Context: ${JSON.stringify(session.metadata)}`);
  console.log(`Duration: ${analysis.summary.sessionDurationMinutes.toFixed(2)} minutes`);
  console.log(`Checkpoints: ${sessionCheckpoints.length}`);
  console.log(`Status: ${session.status}`);

  if (sessionCheckpoints.length > 0) {
    console.log('\nCheckpoint Messages:');
    sessionCheckpoints.forEach(cp => {
      const value = cp.value as any;
      if (value?.message) {
        console.log(`  - ${new Date(cp.createdAt).toLocaleString()}: "${value.message}"`);
      }
    });
  }
}

// Run the analysis
const targetSessionId = 'b28354c3-0586-479d-ba75-c8520c4776f4';
analyzeSession(targetSessionId).catch(console.error);