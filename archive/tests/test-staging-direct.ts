/**
 * Direct test to debug why staging API isn't seeing threadId
 */

async function testDirectAPI() {
  console.log('Testing staging API directly with minimal payload');
  console.log('=' .repeat(60));

  // Test with exact payload structure the API expects
  const payload = {
    prompt: 'Test message',
    threadId: 'test-thread-123'
  };

  console.log('Sending payload:', JSON.stringify(payload, null, 2));

  try {
    const response = await fetch('https://staging.couchloopchat.com/api/shrink?stream=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Source': 'mcp-server'
      },
      body: JSON.stringify(payload)
    });

    console.log('\nResponse status:', response.status);
    console.log('Response headers:');
    response.headers.forEach((value, key) => {
      console.log(`  ${key}: ${value}`);
    });

    const responseText = await response.text();
    console.log('\nRaw response:', responseText);

    try {
      const parsed = JSON.parse(responseText);
      console.log('\nParsed response:', JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log('Could not parse as JSON');
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

// Also test what our MCP client sends
async function testMCPPayload() {
  console.log('\n\nTesting what MCP client sends');
  console.log('=' .repeat(60));

  const payload = {
    prompt: 'Test message',
    threadId: 'test-thread-123',
    memoryContext: '',
    enhancedContext: {},
    history: [],
    systemPrompt: undefined,
    conversationType: undefined
  };

  console.log('MCP client would send:', JSON.stringify(payload, null, 2));

  try {
    const response = await fetch('https://staging.couchloopchat.com/api/shrink?stream=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Source': 'mcp-server'
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    console.log('Response:', responseText);

  } catch (error) {
    console.error('Error:', error);
  }
}

// Run tests
async function runTests() {
  await testDirectAPI();
  await testMCPPayload();
}

runTests().catch(console.error);