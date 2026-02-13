/**
 * MCP Tools - Main Export
 *
 * This module provides two modes:
 * 1. SIMPLE MODE (default): 9 primary tools that bundle all functionality
 * 2. FULL MODE: All 30 granular tools for power users
 *
 * Set MCP_TOOL_MODE=full in environment for full mode
 */

// Re-export the primary tools setup as default
export { setupTools } from "./primary-tools.js";

// Also export granular tools for internal use
export { handleCheckVersions } from "./check-versions.js";
export { getCheckpoints, saveCheckpoint } from "./checkpoint.js";
export { handleComprehensiveCodeReview } from "./comprehensive-code-review.js";
export { handleComprehensivePackageAudit } from "./comprehensive-package-audit.js";
export { handleDetectBuildContext } from "./detect-build-context.js";
export { handleDetectCodeSmell } from "./detect-code-smell.js";
export { handleGenerateUpgradeReport } from "./generate-upgrade-report.js";
export { getInsights, getUserContext, saveInsight } from "./insight.js";
export { handlePreReviewCode } from "./pre-review-code.js";
export {
    preserveContext, retrieveContext, storeContext
} from "./preserve-context.js";
export { handlePreventAIErrors } from "./prevent-ai-errors.js";
export { handleScanSecurity } from "./scan-security.js";
export { sendMessage } from "./sendMessage.js";
export { endSession } from "./session-manager.js";
export { createSession, resumeSession } from "./session.js";
export { handleSmartContext } from "./smart-context.js";
export { handleValidatePackages } from "./validate_packages.js";

