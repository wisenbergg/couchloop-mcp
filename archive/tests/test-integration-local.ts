#!/usr/bin/env node
import dotenv from 'dotenv';
import { initDatabase, getDb } from './src/db/client';
import { createSession } from './src/tools/session';
import { sendMessage } from './src/tools/sendMessage';
import { eq } from 'drizzle-orm';
import { sessions } from './src/db/schema';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function testIntegration() {
  console.log('🚀 Testing MCP → Shrink-Chat Integration\n');

  try {
    // Initialize database
    console.log('1. Initializing database...');
    await initDatabase();
    console.log('✅ Database connected\n');

    // Create a test session
    console.log('2. Creating test session...');
    const sessionResult = await createSession({
      journey_slug: 'daily-reflection',
      context: 'Integration test'
    });

    if (sessionResult.error) {
      throw new Error(`Failed to create session: ${sessionResult.error}`);
    }

    const sessionId = sessionResult.session_id;
    console.log(`✅ Session created: ${sessionId}\n`);

    // Test regular message
    console.log('3. Testing regular message through shrink-chat...');
    const messageResult = await sendMessage({
      session_id: sessionId,
      message: 'I am feeling a bit anxious about my upcoming presentation',
      save_checkpoint: true,
      include_memory: true
    });

    if (!messageResult.success) {
      throw new Error(`Failed to send message: ${messageResult.error}`);
    }

    console.log('✅ Message sent successfully');
    console.log(`   Thread ID: ${messageResult.metadata.threadId}`);
    console.log(`   Content: "${messageResult.content || '(empty)'}"`);
    console.log(`   Content length: ${messageResult.content?.length || 0} characters`);
    console.log(`   Crisis Level: ${messageResult.metadata.crisisLevel || 'None detected'}\n`);

    // Test crisis detection
    console.log('4. Testing crisis detection...');
    const crisisResult = await sendMessage({
      session_id: sessionId,
      message: 'I am having thoughts of self-harm and need help',
      save_checkpoint: true
    });

    if (!crisisResult.success) {
      console.log(`⚠️  Crisis message handling: ${crisisResult.error}`);
    } else {
      console.log('✅ Crisis message handled');
      console.log(`   Crisis Detected: ${crisisResult.metadata.crisisDetected}`);
      console.log(`   Crisis Level: ${crisisResult.metadata.crisisLevel}`);
      console.log(`   Crisis Handled: ${crisisResult.metadata.crisisHandled}`);
      if (crisisResult.metadata.resources) {
        console.log(`   Resources provided: ${crisisResult.metadata.resources.length}`);
      }
    }

    console.log('\n✨ Integration test completed successfully!');

    // Check database records
    const db = getDb();
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    console.log('\n📊 Database verification:');
    console.log(`   Session thread_id: ${session.threadId || 'Will be set after first message'}`);
    console.log(`   Session status: ${session.status}`);
    console.log(`   Session metadata: ${JSON.stringify(session.metadata).substring(0, 50)}...`);

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }

  process.exit(0);
}

// Run the test
testIntegration();