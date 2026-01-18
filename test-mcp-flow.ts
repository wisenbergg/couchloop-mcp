/**
 * Test script to simulate Claude's MCP tool calls and verify data capture
 * This replicates the exact flow that Claude uses when calling our MCP tools
 */

import { spawn } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

// JSON-RPC helper
let requestId = 1;
function createRequest(method: string, params: any) {
  return {
    jsonrpc: '2.0',
    method,
    params,
    id: requestId++,
  };
}

// Send request to MCP server via stdio
async function sendMCPRequest(method: string, params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const mcp = spawn('npx', ['tsx', 'src/index.ts'], {
      cwd: '/Users/hipdev/dev/mcp',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'development' },
    });

    let response = '';

    mcp.stdout.on('data', (data) => {
      response += data.toString();

      // Try to parse each line as JSON-RPC
      const lines = response.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.result || parsed.error) {
              mcp.kill();
              if (parsed.error) {
                reject(new Error(parsed.error.message || 'Unknown error'));
              } else {
                resolve(parsed.result);
              }
              return;
            }
          } catch (e) {
            // Not valid JSON yet, continue collecting
          }
        }
      }
    });

    mcp.stderr.on('data', (data) => {
      console.error('MCP stderr:', data.toString());
    });

    mcp.on('error', (err) => {
      reject(err);
    });

    // Send the request
    const request = createRequest(method, params);
    mcp.stdin.write(JSON.stringify(request) + '\n');
  });
}

async function testMCPFlow() {
  console.log('═'.repeat(80));
  console.log('TESTING MCP FLOW - SIMULATING CLAUDE CONVERSATION');
  console.log('═'.repeat(80));
  console.log(`Test Time: ${new Date().toISOString()}\n`);

  try {
    // Step 1: Get user context (like Claude does)
    console.log('1. Getting user context...');
    const userContext = await sendMCPRequest('tools/get_user_context', {
      include_recent_insights: true,
      include_session_history: true,
    });
    console.log('User context:', JSON.stringify(userContext, null, 2));

    // Step 2: Create session (like Claude does)
    console.log('\n2. Creating session with context...');
    const createSessionResult = await sendMCPRequest('tools/create_session', {
      context: 'Testing MCP data capture for Claude conversation',
    });
    console.log('Session created:', JSON.stringify(createSessionResult, null, 2));

    const sessionId = createSessionResult.session_id;
    console.log(`\nSession ID: ${sessionId}`);

    // Step 3: Send a message (like Claude does with send_message)
    console.log('\n3. Sending message through MCP...');
    const messageResult = await sendMCPRequest('tools/send_message', {
      session_id: sessionId,
      message: "I'm having a tough time with my wife Emily. I want to talk through what's going on.",
    });
    console.log('Message result:', JSON.stringify(messageResult, null, 2));

    // Step 4: Send follow-up message
    console.log('\n4. Sending follow-up message...');
    const followUpResult = await sendMCPRequest('tools/send_message', {
      session_id: sessionId,
      message: "It's been really difficult. We're on different pages and having trouble communicating.",
    });
    console.log('Follow-up result:', JSON.stringify(followUpResult, null, 2));

    // Step 5: Get checkpoints to verify data capture
    console.log('\n5. Getting checkpoints to verify data capture...');
    const checkpointsResult = await sendMCPRequest('tools/get_checkpoints', {
      session_id: sessionId,
    });
    console.log('Checkpoints:', JSON.stringify(checkpointsResult, null, 2));

    console.log('\n' + '═'.repeat(80));
    console.log('DATA CAPTURE VERIFICATION');
    console.log('═'.repeat(80));

    // Analyze what was captured
    const checkpoints = checkpointsResult.checkpoints || [];
    const userMessages = checkpoints.filter((cp: any) => cp.key === 'user-message');
    const assistantMessages = checkpoints.filter((cp: any) => cp.key === 'assistant-message');

    console.log(`\n✅ User messages captured: ${userMessages.length}`);
    console.log(`✅ Assistant messages captured: ${assistantMessages.length}`);
    console.log(`✅ Total checkpoints: ${checkpoints.length}`);

    if (messageResult.metadata?.threadId) {
      console.log(`✅ Thread ID created: ${messageResult.metadata.threadId}`);
    }

    console.log('\n' + '═'.repeat(80));
    console.log('TEST COMPLETED SUCCESSFULLY');
    console.log('═'.repeat(80));

  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testMCPFlow().catch(console.error);