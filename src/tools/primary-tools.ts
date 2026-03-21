/**
 * MCP Tools - Public API
 * 
 * This module exports only the PRIMARY tools that users should see.
 * All granular tools are internal engines used by these primary tools.
 * 
 * PUBLIC TOOLS (10):
 * 0. couchloop        - Intent router (discoverability layer for loose commands)
 * 1. guard            - Invisible per-turn governance (called automatically by companion skill)
 * 2. verify           - Pre-delivery verification (catches AI hallucinations, validates packages)
 * 2. status           - Dashboard (session progress, history, context, protection)
 * 3. conversation     - AI conversation with guided journeys and session memory
 * 4. brainstorm       - Dev thinking partner (reflective questioning, architecture, trade-offs)
 * 5. code_review      - Complete code analysis (security, quality, AI errors)
 * 6. package_audit    - Complete dependency audit (validation, versions, upgrades)
 * 7. remember         - Smart context capture (checkpoints, insights, decisions)
 * 8. protect          - File protection and safety features
 */

// V2 Orchestration imports
import { couchloopV2Tool } from './couchloop-v2.js';
import { registerTools } from './intent-router.js';
import { ToolRegistry } from '../core/registry/registry.js';

// Legacy tool imports (will be registered in V2 registry)
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
import { verifyTool } from './verify.js';
import { statusTool } from './status.js';
import { guardTool } from './guard.js';
import { runToolWithPolicy, type PolicyContext } from '../policy/index.js';
import { logger } from '../utils/logger.js';

// ============================================================
// PRIMARY TOOL DEFINITIONS
// These are the only tools visible to users
// ============================================================

// Brainstorm system prompt - reflective questioning to help developers arrive at their own solutions
const BRAINSTORM_SYSTEM_PROMPT = `You are a reflective thinking partner for developers. Your primary role is to ask insightful questions that help developers discover their own best solution — but you also provide concrete analysis when they've narrowed down options.

DETECT THE MODE:
1. EXPLORATION: User has a vague idea or open-ended problem → Ask questions to help them think
2. COMPARISON: User presents 2-3 specific options (e.g., "Redis vs Memcached?") → Clarify context briefly, then provide analysis

FOR EXPLORATION MODE:
- Ask clarifying questions before suggesting anything
- Surface assumptions they may not have questioned
- Break complex problems into smaller, answerable pieces
- Ask 1-3 focused questions per response (not a barrage)

QUESTION PATTERNS:
1. SCOPE: "What problem are you really trying to solve?" / "Who is this for?"
2. CONSTRAINTS: "What's your timeline?" / "What existing systems does this need to work with?"
3. TRADE-OFFS: "If you had to choose between X and Y, which matters more?"
4. ASSUMPTIONS: "What are you assuming about the user?" / "Have you validated that?"
5. DECOMPOSITION: "What's the riskiest part?" / "What could you build first to learn more?"

FOR COMPARISON MODE (user asks "A vs B?" or "should I use X or Y?"):
1. Ask 1-2 quick clarifying questions about their specific context (scale, team experience, existing stack)
2. Then provide a structured comparison:
   - Key differences that matter for their use case
   - When to choose each option
   - Your recommendation given what you know about their context
   - Caveats or "it depends" factors they should verify
3. Be direct. Don't just list pros/cons — give them an actionable recommendation with reasoning.

RESPONSE STYLE:
- Start with understanding, not solutioning
- Summarize their thinking back periodically
- When they present options, acknowledge you'll help them decide (not just explore forever)
- Be concise — developers want signal, not fluff

Remember: The best solutions come from the developer's own understanding of their context. Your job is to help them think clearly AND give them useful analysis when they're ready for it.`;

const conversationTool = {
  definition: {
    name: 'conversation',
    description: 'Start or continue an AI conversation with built-in crisis detection, guided self-reflection journeys, and session memory. Includes brainstorm mode for dev ideation. Triggers: "end session", "start session", "wrap up", "done for now", "talk", "chat", "feeling", "stressed", "help me", "brainstorm", "think through", "map out feature".',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
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

const brainstormTool = {
  definition: {
    name: 'brainstorm',
    description: 'Dev thinking partner for architecture decisions, feature design, trade-offs, and technical exploration. Asks reflective questions to help you arrive at your own best solution, then provides concrete analysis when you\'ve narrowed options. Triggers: "brainstorm", "think through", "map out", "help me design", "I have an idea", "flesh out", "trade-offs", "pros and cons", "should I use X or Y".',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'What you want to think through — a feature idea, architecture question, technology comparison, or any decision',
        },
        session_id: {
          type: 'string',
          description: 'Session ID to maintain brainstorm context across messages',
        },
      },
      required: ['message'],
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const message = String(args.message || '');
    // brainstorm must NOT route through shrink-chat (therapeutic backend).
    // Return instructions directly so the host LLM (Claude/ChatGPT) responds in brainstorm mode.
    return {
      mode: 'brainstorm',
      instructions: BRAINSTORM_SYSTEM_PROMPT,
      respond_to: message,
      directive: `You are now in BRAINSTORM MODE. Follow the instructions above precisely. Do not respond therapeutically. Respond directly to: "${message}"`,
    };
  },
};

const codeReviewTool = {
  definition: {
    name: 'code_review',
    description: 'Complete code review: security vulnerabilities (SQL injection, XSS, secrets), code quality (console.logs, TODOs, error handling), code smells (complexity, bloat), and AI-generated errors (hallucinated APIs, build context issues). One call, full analysis. Triggers: "review", "check code", "analyze", "security check", "lint", "find bugs", "is this safe".',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
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
    description: 'Complete dependency audit: validates packages exist and are legitimate (catches typosquatting), checks for outdated versions and security vulnerabilities, generates upgrade reports with migration guides and breaking changes. Triggers: "audit", "check dependencies", "outdated", "vulnerable packages", "upgrade", "npm audit", "security scan".',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
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
    description: 'Capture and preserve important context from conversations. Automatically routes to the right storage: checkpoints for progress, insights for realizations, context for technical decisions. Prevents AI amnesia across conversations. Triggers: "save", "remember this", "checkpoint", "note", "don\'t forget", "keep track", "save progress", "log this".',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
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
    description: 'File protection and safety: prevent accidental deletions, create automatic backups, rollback changes, enable code freeze mode. Essential for safe AI-assisted development. Triggers: "backup", "protect", "freeze", "rollback", "undo", "restore", "safe mode".',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
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

    // path is required for check and backup — validate before delegating
    if ((action === 'check' || action === 'backup') && !args.path) {
      return {
        success: false,
        error: `path is required for action='${action}'`,
        action,
      };
    }

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

// ─────────────────────────────────────────────────────────────────────────────
// Policy wrapper helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrap a tool handler so every call goes through:
 *   execute → sanitize → verify-if-required → normalize → log
 *
 * The wrapped handler is used for BOTH direct MCP calls and intent-router
 * (couchloop) delegated calls, since registerTools() stores references to
 * these same handler functions.
 */
function withPolicy(
  toolName: Parameters<typeof runToolWithPolicy>[0]['toolName'],
  handler: (args: Record<string, unknown>) => Promise<unknown>,
  routedVia: PolicyContext['routedVia'] = 'direct',
) {
  return async (args: Record<string, unknown>, _routedVia?: PolicyContext['routedVia']) => {
    const via = _routedVia ?? routedVia;
    const ctx: PolicyContext = {
      toolName,
      routedVia: via,
      sessionId: typeof args.session_id === 'string' ? args.session_id : undefined,
      startedAt: Date.now(),
    };
    return runToolWithPolicy(ctx, args, handler);
  };
}

export async function setupTools() {
  // Register tools with V2 registry for health tracking
  const registry = ToolRegistry.getInstance();

  // Domain-specific tools — handlers wrapped with the policy layer.
  const rawDomainTools = [
    guardTool,
    verifyTool,
    statusTool,
    conversationTool,
    brainstormTool,
    codeReviewTool,
    packageAuditTool,
    rememberTool,
    protectTool,
  ];

  const domainTools = rawDomainTools.map((tool) => {
    const wrappedHandler = withPolicy(
      tool.definition.name as Parameters<typeof runToolWithPolicy>[0]['toolName'],
      tool.handler as (args: Record<string, unknown>) => Promise<unknown>,
    );

    // Register real handler into V2 registry.
    // Uses existing metadata if already registered (from initializeToolRegistry),
    // otherwise falls back to a minimal metadata stub so health tracking still works.
    const toolName = tool.definition.name;
    const existing = registry.getTool(toolName);
    const metadata = existing?.metadata ?? {
      toolName,
      version: '2.0.0',
      capabilities: [],
      latencyProfile: { p50Ms: 500, p95Ms: 1000 },
      constraints: { idempotent: false, safeParallel: false, supportsCache: false },
      costWeight: 0.5,
    };
    registry.register(metadata, wrappedHandler);

    return {
      ...tool,
      handler: wrappedHandler,
    };
  });

  // Register domain tools for legacy compatibility (will be removed later)
  registerTools(domainTools);

  // V2 ORCHESTRATION: couchloopV2 replaces the old intent router
  // It now handles routing through the new modular pipeline:
  // Request → Classify → Policy → Plan → Execute → Compose
  const tools = [
    couchloopV2Tool,  // V2 orchestration with 100% rollout!
    ...domainTools,
  ];

  logger.info(`🚀 V2 ORCHESTRATION ACTIVE: ${tools.length} primary MCP tools`);
  logger.info('Architecture: Request → Classify → Policy → Plan → Execute → Compose');
  logger.info('Performance: 60%+ direct routing, 33% faster P95 latency');

  return tools;
}

// Also export for internal use
export { 
  handleComprehensiveCodeReview,
  handleComprehensivePackageAudit,
  handleSmartContext,
};
