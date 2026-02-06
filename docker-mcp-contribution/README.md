# Docker MCP Registry Contribution - CouchLoop

## Overview

This directory contains all the necessary files to submit CouchLoop MCP Server to the official Docker MCP Registry. The contribution follows the guidelines from https://github.com/docker/mcp-registry/blob/main/CONTRIBUTING.md.

## What's Included

### `/couchloop/` Directory
This is the main contribution directory that will be placed in the Docker MCP Registry's `servers/` folder:

- **`server.yaml`** - Server configuration metadata including:
  - Basic information (name, description, author, license)
  - Categories and tags for discoverability
  - Runtime configuration (Docker, TypeScript SDK)
  - Environment variables required/optional
  - Build and deployment specifications
  - Container configuration with health checks

- **`tools.json`** - Complete MCP tool definitions (6 primary tools):
  - `couchloop` - Universal entry point for wellness/session commands
  - `conversation` - Natural therapeutic conversation
  - `code_review` - AI-powered code review with wellness integration
  - `package_audit` - Security audit with burnout pattern detection
  - `remember` - Context persistence and memory management
  - `protect` - Burnout protection and wellness guardrails

- **`readme.md`** - Comprehensive documentation covering:
  - Feature overview and key capabilities
  - Quick start guide with Docker commands
  - Use cases for different audiences
  - Configuration and environment setup
  - Architecture explanation
  - Security considerations

- **`Dockerfile`** - Production-ready multi-stage build:
  - TypeScript compilation stage
  - Optimized production image with Alpine Linux
  - Security hardening with non-root user
  - Health check configuration
  - Proper signal handling with tini

### Support Files

- **`SUBMISSION_GUIDE.md`** - Step-by-step instructions for:
  - Installing prerequisites (Go, Task, Docker Desktop)
  - Forking and cloning the Docker MCP Registry
  - Testing the build locally
  - Creating and submitting the pull request
  - PR template with all required information

- **`test-docker-build.sh`** - Automated test script that:
  - Verifies all prerequisites are installed
  - Builds the Docker image locally
  - Runs container with test environment
  - Validates health endpoint
  - Provides cleanup instructions

## Server Classification

CouchLoop is configured as a **Local Server** (containerized) because:
- It includes a Dockerfile for building the container image
- Runs with container isolation for security
- Benefits from Docker's security features (signatures, provenance, SBOMs)
- Can be distributed via Docker Hub

## Next Steps

### 1. Fork the Docker MCP Registry
```bash
# Go to https://github.com/docker/mcp-registry
# Click "Fork" to create your copy
```

### 2. Clone Your Fork
```bash
git clone https://github.com/YOUR-USERNAME/mcp-registry.git
cd mcp-registry
```

### 3. Copy CouchLoop Files
```bash
# From this directory
cp -r docker-mcp-contribution/couchloop ~/mcp-registry/servers/
```

### 4. Test Locally (Optional)
```bash
# Run the test script
./docker-mcp-contribution/test-docker-build.sh
```

### 5. Commit and Push
```bash
cd ~/mcp-registry
git add servers/couchloop/
git commit -m "Add CouchLoop MCP server for AI behavioral governance"
git push origin main
```

### 6. Create Pull Request
- Go to https://github.com/docker/mcp-registry
- Click "New Pull Request"
- Select your fork and branch
- Use the PR template provided in SUBMISSION_GUIDE.md

## Testing Checklist

Before submitting, ensure:
- [ ] Docker image builds successfully
- [ ] Container starts without errors
- [ ] All environment variables are documented
- [ ] Tools.json includes all 10 tools with proper schemas
- [ ] README provides clear usage instructions
- [ ] Server.yaml has all required fields
- [ ] License is clearly stated (MIT)

## Architecture Highlights

CouchLoop provides:
1. **Behavioral Governance** - Monitors LLMs for hallucination, tone drift, unsafe reasoning
2. **Session Persistence** - Maintains context across interruptions
3. **Journey Management** - Structured therapeutic conversation flows
4. **Memory System** - User insights and personalization

## Environment Requirements

### Required
- PostgreSQL database (for session/checkpoint storage)
- Supabase project (for real-time features)
- JWT secret (32+ characters)

### Optional
- Shrink-chat API key (for therapeutic backend)
- Custom log levels and Node.js options

## Support

- **Repository**: https://github.com/wisenbergg/couchloop-mcp
- **Issues**: https://github.com/wisenbergg/couchloop-mcp/issues
- **NPM**: https://www.npmjs.com/package/couchloop-eq-mcp
- **Contact**: greg@couchloop.com

## License

MIT License - See the main project repository for full license text.

## Notes for Docker Team

- The server can run in demo mode without backend connections
- Full functionality requires PostgreSQL and Supabase
- Test credentials can be provided via secure form if needed
- The server implements both stdio and HTTP transports