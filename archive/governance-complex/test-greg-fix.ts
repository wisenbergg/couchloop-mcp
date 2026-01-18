/**
 * Test that Greg's message now gets a proper therapeutic response
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

import { initDatabase, getDb } from './src/db/client.js';
import { createSession } from './src/tools/session.js';
import { sendMessage } from './src/tools/sendMessage.js';

async function testGregFix() {
  console.log('\n' + '═'.repeat(80));
  console.log("TESTING GREG'S SCENARIO - EMOTIONAL PROFANITY FIX");
  console.log('═'.repeat(80));

  // Initialize database
  await initDatabase();

  try {
    // Create a session with Greg's context
    console.log('\n1. Creating session with Greg\'s context...');
    const session = await createSession({
      context: 'Greg talking about wife Emily and relationship pressures',
    });

    console.log(`   Session ID: ${session.session_id}`);

    // Send Greg's original message
    console.log('\n2. Sending Greg\'s message: "to chill the fuck out"...');
    const response = await sendMessage({
      session_id: session.session_id,
      message: "to chill the fuck out",
      conversation_type: 'therapeutic'
    });

    console.log('\n3. Response Analysis:');
    console.log('   ' + '─'.repeat(75));

    // Check if the response is inappropriate (mentions explicit content)
    const isInappropriate = response.content?.includes('explicit content') ||
                           response.content?.includes('sexual') ||
                           response.content?.includes('not explicit');

    if (isInappropriate) {
      console.log('   ❌ FAILED: Still getting inappropriate boundary-setting response');
      console.log(`   Response: "${response.content}"`);
    } else {
      console.log('   ✅ SUCCESS: Got appropriate therapeutic response!');
      console.log(`   Response: "${response.content?.substring(0, 200)}..."`);
    }

    console.log('   ' + '─'.repeat(75));
    console.log('\n   Metadata:');
    console.log(`   - Thread ID: ${response.metadata?.threadId}`);
    console.log(`   - Message ID: ${response.messageId}`);
    console.log(`   - Crisis Level: ${response.metadata?.crisisLevel || 'none'}`);

    // Test with more context
    console.log('\n4. Testing with full context...');
    const fullResponse = await sendMessage({
      session_id: session.session_id,
      message: "I just want my wife Emily to chill the fuck out about all this pressure",
      conversation_type: 'therapeutic'
    });

    console.log(`   Response: "${fullResponse.content?.substring(0, 200)}..."`);

    console.log('\n' + '═'.repeat(80));
    console.log('TEST COMPLETE');
    console.log('═'.repeat(80));

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testGregFix().catch(console.error);