/**
 * MCP Tools - Main Export
 * 
 * This module provides two modes:
 * 1. SIMPLE MODE (default): 5 primary tools that bundle all functionality
 * 2. FULL MODE: All 30 granular tools for power users
 * 
 * Set MCP_TOOL_MODE=full in environment for full mode
 */

// Re-export the primary tools setup as default
export { setupTools } from './primary-tools.js';

// Also export granular tools for internal use
export { saveCheckpoint, getCheckpoints } from './checkpoint.js';
export { saveInsight, getInsights, getUserContext } from './insight.js';
export { sendMessage } from './sendMessage.js';
export { createSession, resumeSession } from './session.js';
export { endSession } from './session-manager.js';
export { preserveContext, storeContext, retrieveContext } from './preserve-context.js';
export { handleComprehensiveCodeReview } from './comprehensive-code-review.js';
export { handleComprehensivePackageAudit } from './comprehensive-package-audit.js';
export { handleSmartContext } from './smart-context.js';
export { handlePreventAIErrors } from './prevent-ai-errors.js';
export { handleDetectBuildContext } from './detect-build-context.js';
export { handleGenerateUpgradeReport } from './generate-upgrade-report.js';
export { handleScanSecurity } from './scan-security.js';
export { handlePreReviewCode } from './pre-review-code.js';
export { handleDetectCodeSmell } from './detect-code-smell.js';
export { handleValidatePackages } from './validate_packages.js';
export { handleCheckVersions } from './check-versions.js';
