#!/usr/bin/env node
// Quick test to verify MCP server can start and connect to database

const { spawn } = require('child_process');

console.log('Testing MCP Server startup with current database schema...\n');

// Start the MCP server
const mcp = spawn('npm', ['run', 'dev'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'development' }
});

let output = '';
let errorOutput = '';
let timeout;

// Capture output
mcp.stdout.on('data', (data) => {
  output += data.toString();
  console.log('Server:', data.toString().trim());
});

mcp.stderr.on('data', (data) => {
  errorOutput += data.toString();
  console.error('Error:', data.toString().trim());
});

// Send initialize request after a short delay
setTimeout(() => {
  console.log('\nSending initialize request...');
  const initRequest = {
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {}
    },
    id: 1
  };

  mcp.stdin.write(JSON.stringify(initRequest) + '\n');

  // Wait for response
  timeout = setTimeout(() => {
    if (output.includes('"result"') || output.includes('initialized')) {
      console.log('\n✅ MCP Server started successfully!');
      console.log('Database connection is working with current schema.');
    } else if (errorOutput.includes('error')) {
      console.log('\n❌ MCP Server failed to start');
      console.log('Database schema updates may be needed.');
    } else {
      console.log('\n⚠️  Server started but no response received');
    }

    mcp.kill();
    process.exit(0);
  }, 3000);
}, 2000);

mcp.on('exit', (code) => {
  clearTimeout(timeout);
  if (code !== 0 && code !== null) {
    console.log(`\n❌ Server exited with code ${code}`);
    console.log('Schema updates may be needed.');
    process.exit(1);
  }
});

process.on('SIGINT', () => {
  mcp.kill();
  process.exit(0);
});