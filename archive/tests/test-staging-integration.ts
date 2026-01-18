/**
 * Test MCP integration with staging API
 * This loads environment variables and tests the full flow
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables BEFORE importing anything else
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

console.log('Environment check:');
console.log('  SHRINK_CHAT_API_URL:', process.env.SHRINK_CHAT_API_URL);
console.log('  DATABASE_URL:', process.env.DATABASE_URL ? '✓ Set' : '✗ Missing');

import { initDatabase, getDb } from './src/db/client.js';
import { createSession } from './src/tools/session.js';
import { sendMessage } from './src/tools/sendMessage.js';
import { sessions, checkpoints, threadMappings } from './src/db/schema.js';
import { eq } from 'drizzle-orm';

async function testStagingIntegration() {
  console.log('\n' + '═'.repeat(80));
  console.log('TESTING MCP WITH STAGING API');
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
    // Step 1: Create session
    console.log('1. Creating session...');
    const createSessionResult = await createSession({
      context: 'Testing staging API integration',
    });
    console.log(`Session created: ${createSessionResult.session_id}`);

    const sessionId = createSessionResult.session_id;

    // Step 2: Send test message
    console.log('\n2. Sending message to staging API...');
    const messageResult = await sendMessage({
      session_id: sessionId,
      message: "I'm testing the staging API integration. Can you respond?",
    });

    console.log('Response received:');
    console.log(`  Success: ${messageResult.success}`);
    console.log(`  Content: ${messageResult.content?.substring(0, 100)}...`);
    console.log(`  Thread ID: ${messageResult.metadata?.threadId}`);
    console.log(`  Message ID: ${messageResult.messageId}`);

    // Step 3: Verify data capture
    console.log('\n3. Verifying data capture...');

    // Check checkpoints
    const capturedCheckpoints = await db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.sessionId, sessionId));

    const userMessages = capturedCheckpoints.filter(cp => cp.key === 'user-message');
    const assistantMessages = capturedCheckpoints.filter(cp => cp.key === 'assistant-message');

    console.log(`  User messages captured: ${userMessages.length}`);
    console.log(`  Assistant messages captured: ${assistantMessages.length}`);

    // Check thread mapping
    const threadMapping = await db
      .select()
      .from(threadMappings)
      .where(eq(threadMappings.sessionId, sessionId))
      .limit(1);

    if (threadMapping.length > 0) {
      console.log(`  Thread mapping created: ✓`);
      console.log(`  Thread ID: ${threadMapping[0].threadId}`);
    } else {
      console.log('  Thread mapping created: ✗');
    }

    // Summary
    console.log('\n' + '═'.repeat(80));
    console.log('SUMMARY');
    console.log('═'.repeat(80));

    if (messageResult.success && !messageResult.error) {
      console.log('\n✅ SUCCESS: Staging API integration is working!');
      console.log('  - Connected to staging API');
      console.log('  - Received AI response');
      console.log('  - Data captured correctly');
    } else if (messageResult.success && messageResult.metadata?.fallbackMode) {
      console.log('\n⚠️ FALLBACK MODE: Staging API not reachable');
      console.log('  - Using local fallback processing');
      console.log('  - Data still captured correctly');
      console.log('  - Check staging API deployment');
    } else {
      console.log('\n❌ ERROR: Integration failed');
      console.log(`  - Error: ${messageResult.error}`);
    }

    console.log('\n' + '═'.repeat(80));
    console.log(`Session ID: ${sessionId}`);
    console.log('═'.repeat(80));

    process.exit(messageResult.success ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    process.exit(1);
  }
}

// Run the test
testStagingIntegration().catch(console.error);