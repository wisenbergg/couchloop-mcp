# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2025-07-09

### Changed — Tool Consolidation (10 → 4 public tools)
- **`memory`** (hero tool) — replaces `remember`, `preserve_context`, `save_checkpoint`, `save_insight`. Actions: save, recall, list
- **`conversation`** — AI conversation with crisis detection, journeys, session memory
- **`review`** (unified) — replaces `code_review`, `package_audit`, `verify`, `brainstorm`. Modes: code, packages, verify, full
- **`status`** — dashboard replacing status + parts of couchloop router
- **`guard`** moved to internal-only — auto-invoked by `withPolicy()` wrapper, no longer exposed as public tool
- Removed `couchloop` meta-tool / intent router from public surface
- Removed standalone `protect`, `brainstorm`, `verify` tools

### Added
- Policy wrapper (`withPolicy()`) auto-invokes guard on every tool call
- Guard threshold-gating: skip governance for responses > 50KB (`GUARD_MAX_RESPONSE_BYTES`)
- `GUARD_EXEMPT_TOOLS` set for guard + memory (prevents recursion)
- `tools/list` response cached with `Object.freeze()` at startup (was 80% of RPC traffic)
- `memoryTool` marked as hero tool — listed first, detailed description with trigger phrases

### Fixed
- `Object.assign` sanitized leak in policy wrapper — changed to `let sanitized` with full reassignment on guard block
- `memoryTool` schema: `required` changed from `["action", "content"]` to `[]` (recall/list don't need content)

### Removed
- Feature flags ceremony in `src/core/init.ts` (dead code)
- `registerTools()` legacy function from primary-tools
- `couchloop-v2.ts` router no longer primary entry point (kept for backward compat)
- `smithery.yaml`: hardcoded JWT fallback removed — `jwtSecret` now required (minLength: 32)

### Documentation
- All 20+ documentation files updated to reflect v2.1.0 architecture
- `AGENT_RUNTIME_CONTRACT.md` fully rewritten for 4-tool lifecycle
- `guardian-skill.md` rewritten: guard is automatic, not manually called

## [1.4.0] - 2026-03-16

### Added
- Mandatory policy wrapper for all 10 public MCP tools: `validate → execute → sanitize → verify-if-required → normalize → log`
- `src/policy/` layer: types, wrapper, sanitize, classifiers, verify-adapter, normalizer, logger
- `src/tools/guard.ts` adapter using `GovernancePipeline` + `InterventionEngine` instances
- `code_review` and `package_audit` auto-trigger a verify pass on every response
- Technical claim detection (version numbers, deprecation notes, statistics) triggers full governance check
- `verifyError` flag distinguishes verify adapter crash from genuine content failures
- Array responses recursively sanitized element-by-element
- `TResult` preserved through the full normalize pipeline (no type erasure)
- 60 unit tests for `sanitize`, `classifiers`, and `normalize` modules
- `hallucinated-packages-corpus` shim for type-safe named import of the corpus file

### Fixed
- `index.ts` dispatch: removed legacy `governancePreCheck`/`governancePostCheck` layer that was double-wrapping tool calls and corrupting `NormalizedToolResponse` shape with a `_governance` key spread
- Classifier regex: `\b\d+(%|...)\b` → `\b\d+(?:%|...)` so percentage metric pattern correctly matches (% is non-word character, trailing `\b` was unreachable)
- `sse.ts` bad content-envelope cast
- `protect` tool: path now required for `check` and `backup` actions

### Changed
- Version bumped to 1.4.0 across `package.json`, `src/index.ts`, `src/server/sse.ts`
- `tsconfig.json`: exclude `MCP Usage Takeaways.guard.ts` archive file from compilation

## [1.3.3] - 2026-03-01

### Changed
- Patch stability improvements and dependency updates

## [1.3.2] - 2026-02-20

### Changed
- Patch fixes for session handling edge cases

## [1.3.1] - 2026-02-15

### Added
- Initial developer safety tools: `validate_packages`, `scan_security`, `pre_review_code`, `detect_code_smell`, `protect_files`, `preserve_context`, `check_versions`
- 9-tool architecture with `couchloop` intent router
- Guard tool with GovernancePipeline and InterventionEngine

## [1.2.0] - 2026-02-10

### Added
- Developer guardian features (v1.1.0 architecture)
- Package hallucination corpus with 200+ confirmed malicious/hallucinated packages
- Security scanning with OWASP pattern detection

## [1.1.4] - 2026-02-04

### Changed
- Archived complex governance detectors for future reference
- Moved advanced OAuth implementation to archive (not needed for current MCP requirements)
- Archived complex test utilities and query scripts
- Cleaned up codebase by organizing unused features into archive directory

### Maintenance
- Organized archive directory with proper documentation
- Preserved complex governance layer code (hallucination, inconsistency, tone drift, unsafe reasoning detectors)
- Preserved advanced session management code for potential future use

## [1.0.5] - 2026-01-22

### Changed
- Optimized npm package size by excluding build artifacts
- Improved package structure for better module loading
- Reduced bundle size from 2.1MB to ~1.2MB
- Cleaned up distribution files for production use

## [1.1.0] - 2026-01-20

### Added
- **6 New Developer Safety Tools** addressing 8/10 top AI coding issues:
  - `validate_packages` - Prevents package hallucination across 7 registries (npm, PyPI, Maven, Cargo, Gem, NuGet, Go)
  - `scan_security` - Detects vulnerabilities, hardcoded secrets, SQL injection, and insecure patterns
  - `pre_review_code` - Pre-screens AI-generated code for quality issues before review
  - `detect_code_smell` - Identifies code bloat, over-engineering, and anti-patterns
  - `protect_files` - Prevents accidental file deletion with backup and rollback capabilities
  - `preserve_context` - Manages project context to prevent AI amnesia across conversations
  - `check_versions` - Validates library versions and detects deprecated APIs
- File protection system with automatic backups and rollback capability
- Context preservation for architectural decisions and requirements
- Support for 7 package registries validation
- Comprehensive error handling with retry strategies and circuit breakers
- TypeScript type safety improvements across all new modules

### Fixed
- TypeScript compilation errors in new developer tools
- Module resolution issues with ES6 imports

### Changed
- Total MCP tools increased from 11 to 23
- Enhanced behavioral governance capabilities for developer workflows
- Improved error messages and user feedback

### Testing
- Successfully tested in VS Code with GitHub Copilot Chat
- Verified integration with Claude Desktop
- All 23 tools confirmed working with MCP protocol

## [1.0.2] - 2026-01-18

### Added
- Chrome Local Network Access support with CORS preflight handling
- `Access-Control-Allow-Private-Network` header implementation
- Claude Desktop integration verification and documentation
- Dynamic environment variable loading based on NODE_ENV

### Fixed
- npm configuration typo (`areregistry` → `registry`)
- Hardcoded environment file loading (now respects NODE_ENV)
- Removed broken mock-based tests that didn't reflect production reality

### Changed
- Simplified governance layer from 2000+ lines to 30 lines
- Leverages shrink-chat's existing crisis detection instead of duplicate patterns
- 100% crisis detection success rate achieved through simplification

### Documentation
- Added LOCAL_NETWORK_ACCESS_TEST_RESULTS.md
- Added CLAUDE_DESKTOP_INTEGRATION_TEST.md
- Clarified OAuth is intentionally stubbed by design (not a limitation)

## [1.0.1] - 2026-01-17

### Added
- ChatGPT Developer Mode support
- SSE/HTTP transport for MCP protocol over HTTP
- Custom `/mcp` endpoint for ChatGPT integration
- CORS support for public web access to local server

### Fixed
- Logo URL in ChatGPT plugin manifest
- GitHub Actions CI/CD workflow issues
- npm package preparation and metadata

### Changed
- Updated documentation for ChatGPT to use `/mcp` endpoint
- Improved MCP handler to support both SSE and HTTP transports

## [1.0.0] - 2024-01-14

### Added
- Initial release of CouchLoop MCP Server
- Model Context Protocol (MCP) implementation for stateful AI conversations
- Session management with pause/resume capabilities
- Checkpoint system for progress tracking
- Journey engine for guided multi-step experiences
- Integration with PostgreSQL via Supabase
- 7 MCP tools:
  - `start_session` - Begin a new conversation session
  - `pause_session` - Temporarily pause the current session
  - `resume_session` - Continue a paused session
  - `end_session` - Complete or abandon a session
  - `save_checkpoint` - Save progress within a session
  - `save_insight` - Capture user reflections
  - `send_message` - Send messages with Shrink-Chat integration
- 5 MCP resources:
  - Current session state
  - Journey definitions
  - User context
  - Session history
  - Checkpoint data
- OAuth stub implementation for authentication flow
- Circuit breaker for API resilience
- Retry strategy with exponential backoff
- Comprehensive error handling
- TypeScript support throughout
- Vitest test suite
- Docker and Kubernetes configurations
- GitHub Actions CI/CD workflows

### Security
- JWT authentication support
- Environment variable validation
- Required secrets validation on startup
- Secure credential handling via wrapper script

### Documentation
- Comprehensive README with setup instructions
- API documentation
- MCP integration guide
- Architecture overview
- Development guidelines

### Infrastructure
- Vercel deployment support
- Docker containerization
- Kubernetes manifests
- Database migrations via Drizzle ORM
- Development environment configuration

### Known Issues
- OAuth implementation is currently stubbed and requires UI completion
- User context uses mock users pending OAuth integration

### Contributors
- Greg Wisenberg <greg@couchloop.com>

## [Unreleased]
### To Do
- Complete OAuth UI implementation
- Add real user authentication
- Enhance journey templates
- Add more comprehensive tests
- Implement telemetry and analytics
- Create web dashboard
- Add plugin system
