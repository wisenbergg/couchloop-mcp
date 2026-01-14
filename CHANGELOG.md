# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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