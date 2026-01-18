/**
 * Test script to debug staging API requirements
 */

async function testStagingAPI() {
  console.log('Testing staging API at staging.couchloopchat.com');
  console.log('=' .repeat(60));

  const testCases = [
    {
      name: 'Test 1: threadId in body',
      body: {
        prompt: 'Test message',
        threadId: 'test-thread-123',
      },
      headers: {
        'Content-Type': 'application/json',
        'X-Source': 'mcp-server',
      },
    },
    {
      name: 'Test 2: thread_id in body',
      body: {
        prompt: 'Test message',
        thread_id: 'test-thread-123',
      },
      headers: {
        'Content-Type': 'application/json',
        'X-Source': 'mcp-server',
      },
    },
    {
      name: 'Test 3: threadId as header',
      body: {
        prompt: 'Test message',
      },
      headers: {
        'Content-Type': 'application/json',
        'X-Source': 'mcp-server',
        'X-Thread-Id': 'test-thread-123',
      },
    },
    {
      name: 'Test 4: Full payload like MCP sends',
      body: {
        prompt: 'Test message',
        threadId: 'test-thread-123',
        memoryContext: '',
        enhancedContext: {},
        history: [],
        systemPrompt: undefined,
        conversationType: undefined,
      },
      headers: {
        'Content-Type': 'application/json',
        'X-Source': 'mcp-server',
      },
    },
  ];

  for (const testCase of testCases) {
    console.log(`\n${testCase.name}`);
    console.log('-'.repeat(40));

    try {
      const response = await fetch('https://staging.couchloopchat.com/api/shrink?stream=false', {
        method: 'POST',
        headers: testCase.headers,
        body: JSON.stringify(testCase.body),
      });

      const responseText = await response.text();
      let responseData;

      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = responseText;
      }

      console.log(`Status: ${response.status}`);
      console.log('Response:', JSON.stringify(responseData, null, 2));

      if (response.ok) {
        console.log('✅ SUCCESS!');
        break;
      }
    } catch (error) {
      console.log('Error:', error);
    }
  }
}

// Run the test
testStagingAPI().catch(console.error);