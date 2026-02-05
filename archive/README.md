# Archive Directory

This directory contains code that was developed but is not currently used in the production system.

## /oauth-advanced/

**Date Archived:** January 13, 2025
**Reason:** Advanced OAuth features not needed for current MCP server requirements

Contains enterprise-grade OAuth implementation including:
- DPoP (Demonstrating Proof-of-Possession) protocol
- PKCE with SHA-256 challenges
- OAuth provider integrations (Google, GitHub)
- GDPR compliance framework
- Anomaly detection system
- Token family rotation with reuse detection
- Security monitoring and audit logging

**Why Archived:**
- MCP server only needs to authenticate AI agents (ChatGPT/Claude), not human users
- Basic OAuth in authServer.ts is sufficient for current needs
- These features were causing 90+ TypeScript compilation errors
- Code was never integrated with the main server

**To Restore:**
If these features are needed in the future:
1. Move files back to src/server/oauth/
2. Fix import/export issues in GDPR files
3. Install missing dependencies (@types/tar)
4. Integrate with main server routes
5. Update database schema to support advanced features