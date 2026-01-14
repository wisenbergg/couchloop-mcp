#!/usr/bin/env node
// Test script for MCP server

const { spawn } = require('child_process');
const readline = require('readline');

// Start the MCP server
const mcp = spawn('npm', ['run', 'dev'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper to send JSON-RPC requests
function sendRequest(method, params = {}) {
  const request = {
    jsonrpc: "2.0",
    method: method,
    params: params,
    id: Date.now()
  };

  console.log('\n→ Sending:', JSON.stringify(request, null, 2));
  mcp.stdin.write(JSON.stringify(request) + '\n');
}

// Handle server output
mcp.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(line => line.trim());
  lines.forEach(line => {
    try {
      const response = JSON.parse(line);
      console.log('\n← Response:', JSON.stringify(response, null, 2));
    } catch (e) {
      console.log('Server:', line);
    }
  });
});

mcp.stderr.on('data', (data) => {
  console.error('Error:', data.toString());
});

// Test menu
function showMenu() {
  console.log('\n=== MCP Server Test Menu ===');
  console.log('1. Initialize connection');
  console.log('2. List available tools');
  console.log('3. List available resources');
  console.log('4. Create a session');
  console.log('5. List journeys');
  console.log('6. Exit');
  console.log('============================\n');

  rl.question('Choose an option: ', (answer) => {
    switch(answer) {
      case '1':
        sendRequest('initialize', {
          protocolVersion: "2024-11-05",
          capabilities: {}
        });
        break;
      case '2':
        sendRequest('tools/list');
        break;
      case '3':
        sendRequest('resources/list');
        break;
      case '4':
        sendRequest('tools/call', {
          name: 'create_session',
          arguments: {
            journey_slug: 'daily-reflection',
            context: 'Test session'
          }
        });
        break;
      case '5':
        sendRequest('tools/call', {
          name: 'list_journeys',
          arguments: {}
        });
        break;
      case '6':
        mcp.kill();
        process.exit(0);
      default:
        console.log('Invalid option');
    }

    setTimeout(showMenu, 2000);
  });
}

// Wait for server to start
setTimeout(() => {
  console.log('MCP Server Test Interface\n');
  showMenu();
}, 2000);

process.on('exit', () => {
  mcp.kill();
});