/**
 * MCP Tools - Public API
 * 
 * This module exports only the PRIMARY tools that users should see.
 * Consolidated from 10 → 4 tools for clarity and reduced LLM misrouting.
 * 
 * PUBLIC TOOLS (4):
 * 1. memory           - HERO: save & recall insights, checkpoints, decisions (Supabase-backed)
 * 2. conversation     - Emotional support, guided journeys, crisis detection (shrink-chat backend)
 * 3. review           - Unified: code review + package audit + pre-delivery verification
 * 4. status           - Dashboard (session progress, history, context, preferences)
 * 
 * INTERNAL (auto-triggered, not user-facing):
 * - guard             - Per-response governance (runs in withPolicy wrapper)
 * 
 * REMOVED:
 * - couchloop         - Router added latency; LLMs route directly with good descriptions
 * - brainstorm        - Returned static system prompt; LLMs brainstorm natively
 * - protect           - Broken on Railway (read-only /app filesystem)
 */

import { ToolRegistry } from '../core/registry/registry.js';

// Tool handler imports
import { sendMessage } from './sendMessage.js';
import { createSession, resumeSession } from './session.js';
import { endSession } from './session-manager.js';
import { handleComprehensiveCodeReview } from './comprehensive-code-review.js';
import { handleComprehensivePackageAudit } from './comprehensive-package-audit.js';
import { handleSmartContext } from './smart-context.js';
import { listJourneys, getJourneyStatus } from './journey.js';
import { getCheckpoints } from './checkpoint.js';
import { getInsights, getUserContext } from './insight.js';
import { handleVerify } from './verify.js';
import { statusTool } from './status.js';
import { runToolWithPolicy, type PolicyContext } from '../policy/index.js';
import { logger } from '../utils/logger.js';

// ============================================================
// PRIMARY TOOL DEFINITIONS (4 public tools)
// ============================================================

// ── 1. MEMORY (hero feature — registered first) ─────────────────────────────

const memoryTool = {
  definition: {
    name: 'memory',
    description: 'Save and retrieve context, insights, checkpoints, and decisions across conversations. Prevents AI amnesia. Use action "save" to store, "recall" to retrieve, "list" to browse.',
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
          description: 'What to save or search for when recalling',
        },
        action: {
          type: 'string',
          enum: ['save', 'recall', 'list'],
          description: 'save: store new context. recall: retrieve previously stored insights/checkpoints/decisions. list: browse all saved items.',
        },
        type: {
          type: 'string',
          enum: ['checkpoint', 'insight', 'decision', 'requirement', 'constraint', 'pattern'],
          description: 'Type of context (for save action — affects categorization)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization (for save action)',
        },
        session_id: {
          type: 'string',
          description: 'Session to associate with',
        },
      },
      required: [],
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const action = (args.action as string) || 'save';
    const sessionId = args.session_id as string | undefined;
    const auth = args.auth as Record<string, unknown> | undefined;

    switch (action) {
      case 'recall': {
        const checkpointData = await getCheckpoints({ session_id: sessionId, auth });
        const insightData = await getInsights({ session_id: sessionId, limit: 10, auth });
        const userContext = await getUserContext({ include_recent_insights: true, include_session_history: true, auth });
        return { checkpoints: checkpointData, insights: insightData, user_context: userContext };
      }
      case 'list':
        return getInsights({ session_id: sessionId, limit: 20, auth });
      case 'save':
      default:
        return handleSmartContext({
          content: args.content,
          type: args.type || 'insight',
          tags: args.tags,
          session_id: args.session_id,
          auth,
        });
    }
  },
};

// ── 2. CONVERSATION ──────────────────────────────────────────────────────────

const conversationTool = {
  definition: {
    name: 'conversation',
    description: 'Emotional support, guided self-reflection journeys, and wellness conversations with crisis detection. Routes to therapeutic AI backend.',
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
          description: 'Your message for the therapeutic conversation',
        },
        action: {
          type: 'string',
          enum: ['send', 'start', 'end', 'resume', 'status'],
          description: 'send (default), start new session, end session, resume previous, or get status',
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
    const auth = args.auth as Record<string, unknown> | undefined;

    switch (action) {
      case 'start':
        return createSession({
          journey_slug: args.journey as string,
          context: args.message as string,
          auth,
        });
      case 'end':
        return endSession(args.session_id as string, auth);
      case 'resume':
        return resumeSession({ session_id: args.session_id as string, auth });
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

// ── 3. REVIEW (unified: code + packages + verify) ───────────────────────────

const reviewTool = {
  definition: {
    name: 'review',
    description: 'Unified code review, package audit, and pre-delivery verification. Use mode to select: "code" for security/quality/AI-error analysis, "packages" for dependency audit and validation, "verify" for hallucination and fact checking, "full" for all checks.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['code', 'packages', 'verify', 'full'],
          description: 'code: security vulnerabilities, code smells, AI-generated errors. packages: validate existence, audit versions, find vulnerabilities. verify: pre-delivery hallucination/fact check. full: all checks.',
        },
        content: {
          type: 'string',
          description: 'Code to review, content to verify, or general input for analysis',
        },
        packages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Package names to audit (for packages mode)',
        },
        language: {
          type: 'string',
          description: 'Programming language (auto-detected if not specified)',
        },
        registry: {
          type: 'string',
          enum: ['npm', 'pypi', 'maven', 'cargo', 'go', 'nuget', 'gem'],
          description: 'Package registry (default: npm)',
        },
        auto_fix: {
          type: 'boolean',
          description: 'Attempt to auto-fix issues (default: false, code mode only)',
        },
      },
      required: ['mode'],
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const mode = args.mode as string;

    switch (mode) {
      case 'code':
        if (!args.content) {
          return { success: false, error: 'content is required for code review mode' };
        }
        return handleComprehensiveCodeReview({
          code: args.content,
          language: args.language,
          auto_fix: args.auto_fix,
        });

      case 'packages':
        if (!args.packages) {
          return { success: false, error: 'packages array is required for packages mode' };
        }
        return handleComprehensivePackageAudit({
          packages: args.packages,
          registry: args.registry,
        });

      case 'verify':
        if (!args.content) {
          return { success: false, error: 'content is required for verify mode' };
        }
        return handleVerify({
          type: 'all',
          content: args.content,
          language: args.language,
          registry: args.registry,
        });

      case 'full': {
        const results: Record<string, unknown> = {};
        if (args.content) {
          results.code_review = await handleComprehensiveCodeReview({
            code: args.content,
            language: args.language,
            auto_fix: args.auto_fix,
          });
          results.verification = await handleVerify({
            type: 'all',
            content: args.content,
            language: args.language,
          });
        }
        if (args.packages) {
          results.package_audit = await handleComprehensivePackageAudit({
            packages: args.packages,
            registry: args.registry,
          });
        }
        if (!args.content && !args.packages) {
          return { success: false, error: 'content or packages required for full mode' };
        }
        return { success: true, mode: 'full', results };
      }

      default:
        return { success: false, error: `Unknown mode: ${mode}. Use: code, packages, verify, or full` };
    }
  },
};

// ============================================================
// EXPORT ONLY PRIMARY TOOLS (4 tools)
// ============================================================

// ─────────────────────────────────────────────────────────────────────────────
// Policy wrapper helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrap a tool handler so every call goes through:
 *   execute → sanitize → guard-if-clinical → verify-if-required → normalize → log
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
  const registry = ToolRegistry.getInstance();

  // 4 public tools — memory first (hero feature), then conversation, review, status
  const rawDomainTools = [
    memoryTool,
    conversationTool,
    reviewTool,
    statusTool,
  ];

  const domainTools = rawDomainTools.map((tool) => {
    const wrappedHandler = withPolicy(
      tool.definition.name as Parameters<typeof runToolWithPolicy>[0]['toolName'],
      tool.handler as (args: Record<string, unknown>) => Promise<unknown>,
    );

    const toolName = tool.definition.name;
    const existing = registry.getTool(toolName);
    const metadata = existing?.metadata ?? {
      toolName,
      version: '2.1.0',
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

  // No router tool — LLMs route directly with clear descriptions
  const tools = [...domainTools];

  logger.info(`Registered ${tools.length} public MCP tools: ${tools.map(t => t.definition.name).join(', ')}`);

  return tools;
}

// Also export for internal use
export { 
  handleComprehensiveCodeReview,
  handleComprehensivePackageAudit,
  handleSmartContext,
};
