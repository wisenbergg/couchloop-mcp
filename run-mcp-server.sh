#!/bin/bash
# MCP Server launcher script - loads environment variables from .env.local

# Change to the script's directory
cd "$(dirname "$0")"

# Load environment variables from .env.local
if [ -f .env.local ]; then
  export $(cat .env.local | grep -v '^#' | xargs)
fi

# Always set MCP_MODE
export MCP_MODE=true

# Run the MCP server
exec node dist/index.js