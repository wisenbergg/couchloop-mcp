/**
 * MCP Tools - Public API
 * 
 * This module exports only the PRIMARY tools that users should see.
 * All granular tools are internal engines used by these primary tools.
 * 
 * PUBLIC TOOLS (5):
 * 1. conversation     - Therapeutic AI conversation with governance
 * 2. code_review      - Complete code analysis (security, quality, AI errors)
 * 3. package_audit    - Complete dependency audit (validation, versions, upgrades)
 * 4. remember         - Smart context capture (checkpoints, insights, decisions)
 * 5. protect          - File protection and safety features
 */

import { sendMessage } from './sendMessage.js';
import { createSession, resumeSession } from './session.js';
import { endSession } from './session-manager.js';
import { handleComprehensiveCodeReview } from './comprehensive-code-review.js';
import { handleComprehensivePackageAudit } from './comprehensive-package-audit.js';
import { handleSmartContext } from './smart-context.js';
import { 
  protectFiles, 
  getProtectionStatus, 
  listBackups, 
  rollbackFile,
  enableCodeFreeze,
  disableCodeFreeze,
} from './protect-files.js';
import { listJourneys, getJourneyStatus } from './journey.js';
import { getCheckpoints } from './checkpoint.js';
import { getInsights, getUserContext } from './insight.js';
import { logger } from '../utils/logger.js';

// ============================================================
// PRIMARY TOOL DEFINITIONS
// These are the only tools visible to users
// ============================================================

const conversationTool = {
  definition: {
    name: 'conversation',
    description: 'Start or continue a therapeutic AI conversation with built-in crisis detection, emotional support, and session memory. Handles session management automatically.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Your message',
        },
        action: {
          type: 'string',
          enum: ['send', 'start', 'end', 'resume', 'status'],
          description: 'Action: send (default), start new session, end session, resume previous, or get status',
        },
        journey: {
          type: 'string',
          description: 'Optional journey to follow (e.g., "daily-reflection")',
        },
        session_id: {
          type: 'string',
          description: 'Session ID (auto-managed if not provided)',
        },
      },
      required: ['message'],
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const action = (args.action as string) || 'send';
    
    switch (action) {
      case 'start':
        return createSession({
          journey_slug: args.journey as string,
          context: args.message as string,
        });
      case 'end':
        return endSession(args.session_id as string);
      case 'resume':
        return resumeSession({ session_id: args.session_id as string });
      case 'status':
        if (args.session_id) {
          return getJourneyStatus({ session_id: args.session_id as string });
        }
        return listJourneys({});
      case 'send':
      default:
        return sendMessage({
          message: args.message,
          session_id: args.session_id,
          save_checkpoint: true,
          include_memory: true,
        });
    }
  },
};

const codeReviewTool = {
  definition: {
    name: 'code_review',
    description: 'Complete code review: security vulnerabilities (SQL injection, XSS, secrets), code quality (console.logs, TODOs, error handling), code smells (complexity, bloat), and AI-generated errors (hallucinated APIs, build context issues). One call, full analysis.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Code to review',
        },
        language: {
          type: 'string',
          description: 'Programming language (auto-detected if not specified)',
        },
        auto_fix: {
          type: 'boolean',
          description: 'Attempt to auto-fix issues (default: false)',
        },
      },
      required: ['code'],
    },
  },
  handler: handleComprehensiveCodeReview,
};

const packageAuditTool = {
  definition: {
    name: 'package_audit',
    description: 'Complete dependency audit: validates packages exist and are legitimate (catches typosquatting), checks for outdated versions and security vulnerabilities, generates upgrade reports with migration guides and breaking changes.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        packages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Package names to audit',
        },
        registry: {
          type: 'string',
          enum: ['npm', 'pypi', 'maven', 'cargo', 'go', 'nuget', 'gem'],
          description: 'Package registry (default: npm)',
        },
      },
      required: ['packages'],
    },
  },
  handler: handleComprehensivePackageAudit,
};

const rememberTool = {
  definition: {
    name: 'remember',
    description: 'Capture and preserve important context from conversations. Automatically routes to the right storage: checkpoints for progress, insights for realizations, context for technical decisions. Prevents AI amnesia across conversations.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'What to remember',
        },
        type: {
          type: 'string',
          enum: ['checkpoint', 'insight', 'decision', 'requirement', 'constraint', 'pattern'],
          description: 'Type of context (affects where it\'s stored)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
        action: {
          type: 'string',
          enum: ['save', 'recall', 'list'],
          description: 'Action: save (default), recall previous context, or list saved items',
        },
        session_id: {
          type: 'string',
          description: 'Session to associate with',
        },
      },
      required: ['content'],
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const action = (args.action as string) || 'save';
    const sessionId = args.session_id as string | undefined;
    
    switch (action) {
      case 'recall': {
        // Get checkpoints and insights
        const checkpoints = await getCheckpoints({ session_id: sessionId });
        const insights = await getInsights({ session_id: sessionId, limit: 10 });
        const userContext = await getUserContext({ include_recent_insights: true, include_session_history: true });
        return {
          checkpoints,
          insights,
          user_context: userContext,
        };
      }
      case 'list':
        return getInsights({ session_id: sessionId, limit: 20 });
      case 'save':
      default:
        return handleSmartContext({
          content: args.content,
          type: args.type || 'insight',
          tags: args.tags,
          session_id: args.session_id,
        });
    }
  },
};

const protectTool = {
  definition: {
    name: 'protect',
    description: 'File protection and safety: prevent accidental deletions, create automatic backups, rollback changes, enable code freeze mode. Essential for safe AI-assisted development.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['check', 'backup', 'rollback', 'freeze', 'unfreeze', 'status', 'history'],
          description: 'Action to perform',
        },
        path: {
          type: 'string',
          description: 'File path (for check, backup, rollback)',
        },
        operation: {
          type: 'string',
          enum: ['delete', 'overwrite', 'move'],
          description: 'Operation type (for check)',
        },
        backup_id: {
          type: 'string',
          description: 'Backup ID (for rollback)',
        },
      },
      required: ['action'],
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const action = args.action as string;
    
    switch (action) {
      case 'check':
        return protectFiles({
          operation: args.operation as string,
          path: args.path as string,
        });
      case 'status':
        return getProtectionStatus({});
      case 'history':
        return listBackups({});
      case 'rollback':
        return rollbackFile({ backup_id: args.backup_id as string });
      case 'freeze':
        return enableCodeFreeze({});
      case 'unfreeze':
        return disableCodeFreeze({});
      case 'backup':
        // Create a backup by doing a protected check
        return protectFiles({
          operation: 'overwrite',
          path: args.path as string,
        });
      default:
        return { error: `Unknown action: ${action}` };
    }
  },
};

// ============================================================
// EXPORT ONLY PRIMARY TOOLS
// ============================================================

export async function setupTools() {
  const tools = [
    conversationTool,
    codeReviewTool,
    packageAuditTool,
    rememberTool,
    protectTool,
  ];

  logger.info(`Prepared ${tools.length} primary MCP tools`);
  return tools;
}

// Also export for internal use
export { 
  handleComprehensiveCodeReview,
  handleComprehensivePackageAudit,
  handleSmartContext,
};
