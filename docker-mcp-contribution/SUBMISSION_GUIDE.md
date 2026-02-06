# Docker MCP Registry Submission Guide for CouchLoop

## Prerequisites

1. **Install Required Tools**:
```bash
# Install Go (v1.24+)
brew install go

# Install Task automation tool
brew install go-task/tap/go-task

# Ensure Docker Desktop is installed and running
```

2. **Fork & Clone Docker MCP Registry**:
```bash
# Fork https://github.com/docker/mcp-registry on GitHub first
git clone https://github.com/YOUR-USERNAME/mcp-registry.git
cd mcp-registry
```

## Submission Steps

### Step 1: Copy CouchLoop Files

Copy the prepared CouchLoop files to the registry:
```bash
# From this directory (docker-mcp-contribution)
cp -r couchloop ~/mcp-registry/servers/
```

### Step 2: Generate Configuration (Optional Validation)

Use the Docker registry wizard to validate configuration:
```bash
cd ~/mcp-registry

# Run the wizard for local server
task wizard

# When prompted:
# - Server type: local
# - Server name: couchloop
# - Description: [paste from server.yaml]
# - Repository URL: https://github.com/wisenbergg/couchloop-mcp
# - Dockerfile path: Dockerfile
```

### Step 3: Test Local Build

Build and test the Docker image:
```bash
# Build the CouchLoop image
task build -- --tools couchloop

# Generate catalog entry
task catalog -- couchloop

# The image will be available as:
# docker.io/mcp/couchloop:latest
```

### Step 4: Test in Docker Desktop

1. Open Docker Desktop
2. Go to the MCP Toolkit section
3. Import the CouchLoop server
4. Test the tools with sample commands

### Step 5: Prepare Environment File for Testing

Create a test `.env` file:
```bash
cat > test.env << 'EOF'
DATABASE_URL=postgresql://test:test@localhost:5432/couchloop
SUPABASE_URL=https://test.supabase.co
SUPABASE_ANON_KEY=test-key
JWT_SECRET=test-secret-key-minimum-32-characters-required
NODE_ENV=development
EOF
```

### Step 6: Run Integration Tests

```bash
# Start the container
docker run -d \
  --name couchloop-test \
  --env-file test.env \
  -p 3000:3000 \
  mcp/couchloop:latest

# Check health
curl http://localhost:3000/health

# Stop and remove test container
docker stop couchloop-test
docker rm couchloop-test
```

### Step 7: Create Pull Request

1. **Commit Changes**:
```bash
git add servers/couchloop/
git commit -m "Add CouchLoop MCP server for AI behavioral governance

CouchLoop provides a behavioral governance layer for LLMs with:
- Hallucination and tone drift detection
- Stateful session management
- Progress checkpoints and guided journeys
- Crisis detection for mental health safety"
```

2. **Push to Your Fork**:
```bash
git push origin main
```

3. **Create PR on GitHub**:
- Go to https://github.com/docker/mcp-registry
- Click "New Pull Request"
- Select your fork and branch
- Use this PR template:

```markdown
## Server: CouchLoop

### Description
CouchLoop is a behavioral governance layer for LLMs that monitors for hallucination, inconsistency, tone drift, and unsafe reasoning patterns. It provides stateful conversation management with session persistence, progress checkpoints, and guided journeys.

### Key Features
- 🛡️ Behavioral governance and safety monitoring
- 💾 Persistent session management across interruptions
- 🎯 Guided therapeutic journeys
- 🧠 User context and insight capture

### Testing
- [x] Built successfully with `task build -- --tools couchloop`
- [x] Tested in Docker Desktop MCP Toolkit
- [x] Health check endpoint verified
- [x] All tools documented in tools.json

### Server Type
- [x] Local (Containerized with Dockerfile)
- [ ] Remote

### Links
- Repository: https://github.com/wisenbergg/couchloop-mcp
- Documentation: https://github.com/wisenbergg/couchloop-mcp/blob/main/README.md
- NPM Package: https://www.npmjs.com/package/couchloop-eq-mcp

### Authentication Requirements
Requires PostgreSQL database and Supabase credentials for full functionality. Can run in demo mode without backend connection.

### Checklist
- [x] server.yaml configuration file
- [x] tools.json with all tool definitions
- [x] readme.md with comprehensive documentation
- [x] Dockerfile for containerization
- [x] MIT License
```

## Additional Notes

### For Docker Team Review

If the Docker team needs test credentials, provide through their secure form:
- Supabase project can be created free at https://supabase.com
- PostgreSQL can use Docker postgres image for testing
- JWT_SECRET can be any 32+ character string

### Environment Variables for Production

```env
# Required
DATABASE_URL=postgresql://user:pass@host:5432/db
SUPABASE_URL=https://project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
JWT_SECRET=minimum-32-character-secret-key

# Optional
SHRINK_CHAT_API_KEY=api-key-for-therapeutic-features
NODE_ENV=production
LOG_LEVEL=info
```

### Common Issues

1. **Port 3000 Already in Use**:
   - Change port mapping: `-p 3001:3000`

2. **Database Connection Failed**:
   - Ensure PostgreSQL is accessible
   - Check DATABASE_URL format

3. **Health Check Failing**:
   - Verify all required env vars are set
   - Check container logs: `docker logs couchloop-test`

## Contact

For questions about the CouchLoop MCP server:
- GitHub Issues: https://github.com/wisenbergg/couchloop-mcp/issues
- Email: greg@couchloop.com