# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CouchLoop EQ MCP Server - A behavioral governance layer for LLMs that provides both therapeutic session management AND developer safety tools. The project monitors for hallucination, inconsistency, tone drift, and unsafe reasoning while also protecting against common AI coding issues.

## 🔴 CRITICAL SECURITY REQUIREMENTS

### NEVER Use Hardcoded Sensitive Values

**ABSOLUTELY FORBIDDEN:**
- NEVER hardcode API keys, tokens, or secrets in any file
- NEVER use fallback values like `|| 'dev-secret'` or `|| 'change-in-production'`
- NEVER commit `.env` files or any file containing real credentials
- NEVER include database connection strings in code
- NEVER expose database schemas in published packages

**REQUIRED PRACTICES:**
- ALWAYS use environment variables for ALL sensitive configuration
- ALWAYS throw errors when required environment variables are missing:
  ```typescript
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required');
  }
  ```
- ALWAYS validate environment variables at startup
- ALWAYS use `.env.example` with dummy values for documentation
- ALWAYS add real `.env` files to `.gitignore`

### Pre-Publish Security Checklist

**Before ANY npm publish or deployment:**
1. Run `npm pack --dry-run` and verify no sensitive files are included
2. Check for hardcoded values: `grep -r "secret\|password\|key\|token" dist/`
3. Verify `.npmignore` excludes all database and sensitive files
4. Review package.json `files` field to whitelist only necessary files
5. Test the package in an isolated environment

### Required CI/CD Security Workflow

**You MUST implement or verify existence of GitHub Actions workflow that:**
1. Scans for hardcoded secrets using tools like `truffleHog` or `gitleaks`
2. Checks for exposed environment variables
3. Validates `.npmignore` and `files` configuration
4. Blocks deployment if sensitive patterns are detected
5. Runs security audit on dependencies

**Create `.github/workflows/security-check.yml` if it doesn't exist** (see example at end of file)

## Current Implementation (v1.1.0)

### Two Core Capabilities

1. **Therapeutic Session Management** (10 tools)
   - Stateful conversation management via MCP protocol
   - Pass-through messaging to shrink-chat backend at `https://couchloopchat.com`
   - Journey-based guided experiences with checkpoints
   - Crisis detection and intervention

2. **Developer Safety Tools** (13 tools addressing 8/10 top AI coding issues)
   - `validate_packages` - Prevents package hallucination across 7 registries (npm, PyPI, Maven, Cargo, Gem, NuGet, Go)
   - `scan_security` - Detects vulnerabilities, hardcoded secrets, SQL injection
   - `pre_review_code` - Pre-screens AI-generated code for quality issues
   - `detect_code_smell` - Identifies code bloat, over-engineering, anti-patterns
   - `protect_files` - Prevents accidental file deletion with backup/rollback
   - `preserve_context` - Manages project context to prevent AI amnesia
   - `check_versions` - Validates library versions and deprecated APIs

Total: **23 MCP tools** available

## Development Commands

```bash
# Core Development
npm run dev                 # Start MCP server with hot reload (tsx watch src/index.ts)
npm run server:dev          # Start HTTP/SSE server with hot reload (port 3001)
npm test                    # Run Vitest suite
npm run test:watch          # Run tests in watch mode

# Database Management
npm run db:push             # Push schema changes to PostgreSQL
npm run db:seed             # Seed journey definitions and test data
npm run db:studio           # Open Drizzle Studio for database inspection

# Build & Production
npm run build               # Compile TypeScript to dist/
npm run start:mcp           # Run MCP server (stdio) - after build
npm run server              # Run HTTP server (port 3001)

# Code Quality
npm run lint                # ESLint check
npm run typecheck           # TypeScript type checking

# Deployment
npm run vercel              # Deploy to Vercel preview
npm run vercel:prod         # Deploy to Vercel production
```

## Testing

```bash
# Run specific test file
npm test -- tests/tools/session.test.ts

# Run tests matching pattern
npm test -- --grep "session"

# Generate coverage report
npm test -- --coverage
```

Test coverage thresholds: 80% statements/functions/lines, 75% branches

## Environment Configuration

```bash
# Development: .env.local
# Staging: .env.staging
# Production: .env.production

# Required variables
DATABASE_URL=               # PostgreSQL connection string
SUPABASE_URL=              # Supabase project URL
SUPABASE_ANON_KEY=         # Supabase anonymous key
JWT_SECRET=                # Must be 32+ characters
OAUTH_CLIENT_ID=           # OAuth client identifier
OAUTH_CLIENT_SECRET=       # OAuth client secret
OAUTH_REDIRECT_URI=        # OAuth callback URL
COUCHLOOP_SERVER=          # Shrink-chat backend URL (default: https://couchloopchat.com)
```

## Project Structure

```
src/
├── index.ts               # MCP server entry point (stdio)
├── server/
│   ├── index.ts          # HTTP/SSE server (port 3001)
│   ├── sse.ts            # SSE/WebSocket MCP transport
│   ├── chatgpt-mcp.ts    # ChatGPT MCP integration
│   └── oauth/            # OAuth flow (currently stubbed)
├── tools/                # MCP tool handlers (23 tools total)
│   ├── session.ts        # Session management
│   ├── journey.ts        # Journey progression
│   ├── sendMessage.ts    # Shrink-chat integration
│   ├── validate_packages.ts  # Package validation (7 registries)
│   ├── scan-security.ts      # Security scanning
│   ├── pre-review-code.ts    # Code quality pre-review
│   ├── detect-code-smell.ts  # Anti-pattern detection
│   ├── protect-files.ts      # File protection system
│   ├── preserve-context.ts   # Context preservation
│   └── check-versions.ts     # Version compatibility
├── resources/            # MCP resource providers (5 resources)
├── db/                   # Database schema and migrations
├── developer/            # Guardian project components
│   ├── analyzers/       # Code analysis utilities
│   ├── evaluators/      # Quality evaluators
│   ├── guards/          # Protection guards
│   ├── scanners/        # Security scanners
│   └── validators/      # Input validators
├── workflows/            # Journey engine and definitions
└── utils/               # Shared utilities (error handling, retry strategies)
```

## Core Implementation Patterns

### Developer Safety Tool Pattern
All guardian tools follow this structure:
```typescript
1. Input validation with Zod schemas
2. Analysis/scanning/validation logic
3. Risk assessment and scoring
4. Actionable recommendations
5. Comprehensive error handling with retry strategies
```

### Session Management Pattern
```typescript
1. Zod schema validation
2. Database connection
3. Operation execution
4. Standardized response
5. Error handling with custom classes
```

### Error Handling
- Circuit breaker for API resilience
- Retry strategy with exponential backoff
- Custom error classes for different failure types
- Comprehensive logging throughout

## Integration Points

### MCP Protocol Connections
- **Claude Desktop**: stdio transport via `npm run start:mcp`
- **ChatGPT/Web**: SSE transport via `npm run server` (port 3001)
- **VS Code/Copilot Chat**: MCP integration supported
- **Production SSE**: `https://couchloop-mcp-production.up.railway.app/mcp`

### Shrink-Chat Backend Integration
`send_message` tool routes to `https://couchloopchat.com/api/shrink` for:
- Crisis detection and intervention
- Memory management and context
- Therapeutic response generation

## Developer Safety Features (v1.1.0)

### Package Validation
- Supports 7 package registries (npm, PyPI, Maven, Cargo, Gem, NuGet, Go)
- Detects hallucinated packages before installation
- Validates version strings and compatibility

### Security Scanning
- Detects hardcoded secrets and API keys
- Identifies SQL injection vulnerabilities
- Scans for insecure patterns and OWASP risks

### Code Quality Pre-Review
- Pre-screens AI-generated code before human review
- Identifies potential bugs and logic errors
- Checks for maintainability issues

### File Protection System
- Automatic backups before destructive operations
- Rollback capability for accidental deletions
- Code freeze mode for critical protection
- Protected paths configuration

### Context Preservation
- Stores architectural decisions across conversations
- Maintains requirements and constraints
- Prevents AI amnesia when context windows fill
- Categorized storage (architecture, requirements, constraints, decisions, patterns)

## Critical Notes

### Authentication
OAuth implementation in `/api/oauth/` is **intentionally stubbed** by design - generates mock codes/users for simplified integration.

### User Context
Currently uses session-based isolation with mock users (nanoid). Each session gets its own isolated context.

### Local Development Ports
- MCP stdio: Direct process communication
- HTTP/SSE server: Port 3001 (configurable via PORT env)
- Database studio: Port 4983 (Drizzle Studio)

## Common Tasks

### Adding a New MCP Tool
1. Create handler in `src/tools/[name].ts`
2. Define Zod schema for validation
3. Register in `src/tools/index.ts`
4. Follow error handling patterns from existing tools

### Adding a Journey
1. Define in `src/workflows/definitions/`
2. Add to `src/db/seed.ts`
3. Run `npm run db:seed`

### Modifying Database Schema
1. Update `src/db/schema.ts`
2. Run `npm run db:push`
3. Update seed data if needed

## Testing Strategy

### Unit Tests
- Individual tool handlers
- Utility functions
- Error handling logic

### Integration Tests
- End-to-end workflow tests
- MCP protocol communication
- Database operations

### Manual Testing
```bash
# Test MCP tools directly
npm run dev

# Test with Claude Desktop
# Add to ~/Library/Application Support/Claude/claude_desktop_config.json

# Test with ChatGPT Developer Mode
# Use production URL: https://couchloop-mcp-production.up.railway.app/mcp
```

## Key Invariants

1. **Every tool validates input with Zod** (no raw parameter usage)
2. **Every session must have a user** (even if mock)
3. **Journey progress is immutable** (only forward movement)
4. **File operations create backups** (automatic protection)
5. **Context preservation is categorized** (structured storage)
6. **All tools return standardized responses** (consistent API)
7. **NO hardcoded secrets or credentials** (use environment variables only)
8. **Security checks run before EVERY publish** (automated via CI/CD)

## Example Security Workflow (GitHub Actions)

**Required file: `.github/workflows/security-check.yml`**

```yaml
name: Security Check

on:
  push:
    branches: [main, master, develop]
  pull_request:
    branches: [main, master]
  workflow_dispatch:
  # Run before npm publish
  release:
    types: [created]

jobs:
  security-scan:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v3
      with:
        fetch-depth: 0

    # Scan for hardcoded secrets
    - name: TruffleHog Secret Scan
      uses: trufflesecurity/trufflehog@main
      with:
        path: ./
        base: ${{ github.event.repository.default_branch }}
        head: HEAD
        extra_args: --debug --only-verified

    # Check for sensitive patterns
    - name: Check for Hardcoded Values
      run: |
        # Check for development fallback values
        if grep -r "|| 'dev-" --include="*.js" --include="*.ts" .; then
          echo "❌ Found hardcoded development values!"
          exit 1
        fi

        # Check for hardcoded secrets patterns
        if grep -rE "(secret|password|token|key)\\s*=\\s*[\"'][^\"']+[\"']" --include="*.js" --include="*.ts" --exclude-dir=node_modules --exclude-dir=tests .; then
          echo "❌ Found potential hardcoded secrets!"
          exit 1
        fi

    # Verify npm package contents
    - name: Check NPM Package Contents
      run: |
        npm run build
        npm pack --dry-run > package-contents.txt

        # Check for database files
        if grep -E "(schema\.|seed\.|migrate\.)" package-contents.txt; then
          echo "❌ Database files detected in package!"
          exit 1
        fi

        # Check for OAuth files
        if grep -E "oauth|auth.*Server" package-contents.txt; then
          echo "❌ OAuth implementation files detected in package!"
          exit 1
        fi

    # Run dependency audit
    - name: NPM Audit
      run: npm audit --audit-level=moderate

    # Validate environment variables
    - name: Check Environment Variables
      run: |
        # Ensure .env files are gitignored
        if git ls-files | grep -E "\.env$|\.env\.local$|\.env\.production$"; then
          echo "❌ .env files are not properly gitignored!"
          exit 1
        fi

        # Ensure .env.example exists
        if [ ! -f ".env.example" ]; then
          echo "❌ .env.example file is missing!"
          exit 1
        fi

    # SAST Scan
    - name: Semgrep Security Scan
      uses: returntocorp/semgrep-action@v1
      with:
        config: >-
          p/security-audit
          p/secrets
          p/owasp-top-ten
```

**Additional recommended security scripts in `package.json`:**

```json
"scripts": {
  "security:check": "npm run security:secrets && npm run security:audit && npm run security:package",
  "security:secrets": "grep -r 'secret\\|password\\|key\\|token' dist/ --exclude='*.map' || true",
  "security:audit": "npm audit --audit-level=moderate",
  "security:package": "npm pack --dry-run | grep -E 'schema\\.|seed\\.|oauth' && echo '❌ Sensitive files found!' && exit 1 || echo '✅ Package clean'",
  "prepublishOnly": "npm run security:check"
}
```