/**
 * Test script to verify that our MCP data capture is working correctly
 * This simulates the flow that Claude uses when calling our MCP tools
 */

import { initDatabase, getDb } from './src/db/client.js';
import { createSession } from './src/tools/session.js';
import { sendMessage } from './src/tools/sendMessage.js';
import { getCheckpoints } from './src/tools/checkpoint.js';
import { getUserContext } from './src/tools/insight.js';
import { sessions, checkpoints, threadMappings, crisisEvents } from './src/db/schema.js';
import { eq, desc } from 'drizzle-orm';

async function testDataCapture() {
  console.log('═'.repeat(80));
  console.log('TESTING MCP DATA CAPTURE - SIMULATING CLAUDE CONVERSATION');
  console.log('═'.repeat(80));
  console.log(`Test Time: ${new Date().toISOString()}\n`);

  // Initialize database
  await initDatabase();
  const db = getDb();

  if (!db) {
    console.error('Database not initialized');
    process.exit(1);
  }

  try {
    // Step 1: Get user context (like Claude does)
    console.log('1. Getting user context...');
    const userContext = await getUserContext({
      include_recent_insights: true,
      include_session_history: true,
    });
    console.log(`User ID: ${userContext.user.id}`);
    console.log(`External ID: ${userContext.user.externalId}\n`);

    // Step 2: Create session (like Claude does)
    console.log('2. Creating session with context...');
    const createSessionResult = await createSession({
      context: 'Testing MCP data capture for Claude conversation - Wife Emily',
    });
    console.log(`Session created: ${createSessionResult.session_id}\n`);

    const sessionId = createSessionResult.session_id;

    // Step 3: Send first message (like Claude does with send_message)
    console.log('3. Sending first message...');
    const message1Result = await sendMessage({
      session_id: sessionId,
      message: "I'm having a tough time with my wife Emily. I want to talk through what's going on.",
    });
    console.log(`Response received: ${message1Result.content?.substring(0, 100)}...`);
    console.log(`Thread ID: ${message1Result.metadata?.threadId}\n`);

    // Step 4: Send follow-up message
    console.log('4. Sending follow-up message...');
    const message2Result = await sendMessage({
      session_id: sessionId,
      message: "It's been really difficult. We're on different pages and having trouble communicating.",
    });
    console.log(`Response received: ${message2Result.content?.substring(0, 100)}...`);

    // Small delay to ensure database writes complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 5: Verify data capture
    console.log('\n' + '═'.repeat(80));
    console.log('DATA CAPTURE VERIFICATION');
    console.log('═'.repeat(80));

    // Check checkpoints directly from database
    const capturedCheckpoints = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.sessionId, sessionId))
      .orderBy(checkpoints.createdAt);

    console.log(`\n📊 Checkpoints Captured: ${capturedCheckpoints.length}`);

    const userMessages = capturedCheckpoints.filter(cp => cp.key === 'user-message');
    const assistantMessages = capturedCheckpoints.filter(cp => cp.key === 'assistant-message');
    const otherCheckpoints = capturedCheckpoints.filter(
      cp => cp.key !== 'user-message' && cp.key !== 'assistant-message'
    );

    console.log(`  ✅ User messages: ${userMessages.length}`);
    console.log(`  ✅ Assistant messages: ${assistantMessages.length}`);
    console.log(`  ✅ Other checkpoints: ${otherCheckpoints.length}`);

    // Display captured messages
    console.log('\n📝 Captured User Messages:');
    for (const msg of userMessages) {
      const value = msg.value as any;
      console.log(`  - "${value.message?.substring(0, 60)}..."`);
    }

    console.log('\n💬 Captured Assistant Responses:');
    for (const msg of assistantMessages) {
      const value = msg.value as any;
      console.log(`  - "${value.message?.substring(0, 60)}..."`);
    }

    // Check thread mapping
    const threadMapping = await db
      .select()
      .from(threadMappings)
      .where(eq(threadMappings.sessionId, sessionId))
      .limit(1);

    console.log('\n🔗 Thread Mapping:');
    if (threadMapping.length > 0) {
      console.log(`  ✅ Thread mapping created`);
      console.log(`  Thread ID: ${threadMapping[0].threadId}`);
      console.log(`  Source: ${threadMapping[0].source}`);
    } else {
      console.log('  ❌ No thread mapping found');
    }

    // Check session update
    const [updatedSession] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    console.log('\n📋 Session Status:');
    console.log(`  Session ID: ${updatedSession.id}`);
    console.log(`  Thread ID: ${updatedSession.threadId || 'None'}`);
    console.log(`  Status: ${updatedSession.status}`);
    console.log(`  Context: ${JSON.stringify(updatedSession.metadata)}`);

    // Check for crisis events (shouldn't have any in this test)
    const crisisEventCount = await db
      .select()
      .from(crisisEvents)
      .where(eq(crisisEvents.sessionId, sessionId));

    console.log(`\n🚨 Crisis Events: ${crisisEventCount.length}`);

    // Summary
    console.log('\n' + '═'.repeat(80));
    console.log('TEST SUMMARY');
    console.log('═'.repeat(80));

    const success = userMessages.length === 2 &&
                   assistantMessages.length === 2 &&
                   threadMapping.length === 1;

    if (success) {
      console.log('\n✅ SUCCESS: All data capture mechanisms are working correctly!');
      console.log('  - User messages are being saved as checkpoints');
      console.log('  - Assistant responses are being saved as checkpoints');
      console.log('  - Thread mappings are being created');
      console.log('  - Sessions are properly linked to threads');
    } else {
      console.log('\n❌ ISSUES FOUND:');
      if (userMessages.length !== 2) {
        console.log(`  - Expected 2 user messages, found ${userMessages.length}`);
      }
      if (assistantMessages.length !== 2) {
        console.log(`  - Expected 2 assistant messages, found ${assistantMessages.length}`);
      }
      if (threadMapping.length !== 1) {
        console.log(`  - Expected 1 thread mapping, found ${threadMapping.length}`);
      }
    }

    console.log('\n' + '═'.repeat(80));
    console.log(`Test completed. Session ID for reference: ${sessionId}`);
    console.log('═'.repeat(80));

    process.exit(success ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    process.exit(1);
  }
}

// Run the test
testDataCapture().catch(console.error);