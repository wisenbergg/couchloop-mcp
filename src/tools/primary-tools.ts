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

import { z } from 'zod';
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
import {
  createCorrection,
  confirmIssue,
  approveFix,
  dismissCorrection,
  getMostRecentPendingCorrection,
  CorrectionState,
} from './correction-flow.js';
import { runToolWithPolicy, type PolicyContext } from '../policy/index.js';
import { logger } from '../utils/logger.js';

// ============================================================
// PRIMARY TOOL DEFINITIONS (4 public tools)
// ============================================================

// ── 1. MEMORY (hero feature — registered first) ─────────────────────────────

// Zod schemas for handler validation (CLAUDE.md Key Invariant #1)
const MemoryInputSchema = z.object({
  action: z.enum(['save', 'recall', 'list']).optional(),
  content: z.unknown().optional(),
  type: z.string().optional(),
  tags: z.array(z.string()).optional(),
  session_id: z.string().optional(),
  auth: z.record(z.unknown()).optional(),
});

const ConversationInputSchema = z.object({
  action: z.enum(['send', 'start', 'end', 'resume', 'status']).optional(),
  message: z.string().optional(),
  journey: z.string().optional(),
  session_id: z.string().optional(),
  auth: z.record(z.unknown()).optional(),
});

const memoryTool = {
  definition: {
    name: 'memory',
    description: 'Save and retrieve context, insights, checkpoints, and decisions across conversations. Prevents AI amnesia. Use action "save" to store, "recall" to retrieve, "list" to browse. Use type "checkpoint" for sprint progress ("save where I am", "bookmark this"), type "decision" for architectural choices and milestones ("lock this in", "we decided on X"), type "constraint" for rules the AI must follow ("never do X again", "always ask before Y"). Constraints tagged "ai-mistake" are auto-saved by the review tool when it catches errors — recall these at the start of new conversations to avoid repeating past mistakes. Triggers: "remember this", "stash this context", "where did we leave off", "what did we decide", "what was the approach we picked", "load my previous context", "don\'t lose this", "never do that again". With no arguments, returns a summary of everything saved.',
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
          description: 'checkpoint: short-term sprint progress, quick save points, "save where I am". insight: learnings and realizations. decision: long-term architectural or milestone decisions that should persist across projects. requirement/constraint: project rules. pattern: reusable code patterns.',
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
        auth: {
          type: 'object',
          description: 'Authentication context for user identification',
        },
      },
      required: [],
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const parsed = MemoryInputSchema.parse(args);
    const action = parsed.action ?? 'save';
    const sessionId = parsed.session_id;
    const auth = parsed.auth;

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
          content: parsed.content,
          type: parsed.type || 'insight',
          tags: parsed.tags,
          session_id: parsed.session_id,
          auth,
        });
    }
  },
};

// ── 2. CONVERSATION ──────────────────────────────────────────────────────────

const conversationTool = {
  definition: {
    name: 'conversation',
    description: 'Guided self-reflection, burnout check-ins, and wellness conversations with crisis detection. Routes to therapeutic AI backend. Triggers: "I\'m burned out", "need a break", "feeling stuck", "let\'s do a retro on my week", "check in with me", "I keep going in circles", "rubber duck my frustration", "decompress", "vent session", "daily standup with myself". Use when the user sounds frustrated, stuck, or wants a non-code conversation about how work is going. NOTE: if the user is angry at AI output specifically (cursing at the AI, "you broke it"), prefer the review tool with verify mode first to address the problem — only use conversation if frustration persists without a code context or the user explicitly wants to talk it out.',
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
        auth: {
          type: 'object',
          description: 'Authentication context for user identification',
        },
      },
      required: ['message'],
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const parsed = ConversationInputSchema.parse(args);
    const action = parsed.action ?? 'send';
    const auth = parsed.auth;

    switch (action) {
      case 'start':
        return createSession({
          journey_slug: parsed.journey,
          context: parsed.message,
          auth,
        });
      case 'end':
        return endSession(parsed.session_id, auth);
      case 'resume':
        return resumeSession({ session_id: parsed.session_id as string, auth });
      case 'status':
        if (parsed.session_id) {
          return getJourneyStatus({ session_id: parsed.session_id, auth });
        }
        return listJourneys({});
      case 'send':
      default:
        return sendMessage({
          message: parsed.message,
          session_id: parsed.session_id,
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
    description: 'Unified code review, package audit, pre-delivery verification, and error correction. Modes: "code" for security/quality analysis, "packages" for dependency audit, "verify" for hallucination/fact check (starts correction flow), "confirm" for user confirming detected issue, "apply-fix" for user approving the fix, "dismiss" for user saying "that\'s not the issue", "full" for all checks. Triggers: "review this", "sanity check this", "is this safe to ship", "check before I push", "audit my deps", "sniff test this", "vet these dependencies". ALSO use verify mode when the user expresses distrust or frustration: "are you sure", "that doesn\'t look right", "prove it", "did you make that up", "that broke everything", "why did you do that", "I didn\'t ask for this". Profanity or anger directed at the AI is a strong signal to immediately run verify. CORRECTION FLOW: verify detects issue → present it plainly and ask "is this what you mean?" → user confirms (call with mode "confirm") → explain fix and ask permission → user approves (call with mode "apply-fix") → apply. If user says no (mode "dismiss"), ask them to explain. Memory auto-saves the mistake ONLY after user confirms. Use proactively when the user pastes code, shares a diff, or adds new packages.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['code', 'packages', 'verify', 'confirm', 'apply-fix', 'dismiss', 'full'],
          description: 'code: security/quality analysis. packages: dependency audit. verify: hallucination/fact check — starts a correction flow. confirm: user confirms the detected issue is correct (requires correction_id). apply-fix: user approves the proposed fix (requires correction_id). dismiss: user says "that\'s not the issue" (requires correction_id). full: all checks.',
        },
        content: {
          type: 'string',
          description: 'Code to review, content to verify, or general input for analysis',
        },
        correction_id: {
          type: 'string',
          description: 'ID of a pending correction (for confirm, apply-fix, dismiss modes). If omitted, uses the most recent pending correction.',
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
    const sessionId = (args.session_id as string) || 'anonymous';
    const auth = args.auth as Record<string, unknown> | undefined;

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

      case 'verify': {
        if (!args.content) {
          return { success: false, error: 'content is required for verify mode' };
        }
        const verifyResult = await handleVerify({
          type: 'all',
          content: args.content,
          language: args.language,
          registry: args.registry,
        }) as Record<string, unknown>;

        const issues = verifyResult.issues as string[] | undefined;
        const fixes = verifyResult.fixes as string[] | undefined;

        // If issues found, create a correction and enter PENDING_ACKNOWLEDGMENT
        // Do NOT save to memory yet — wait for user to confirm the issue is correct
        if (verifyResult.success && !verifyResult.verified && issues && issues.length > 0) {
          const fixedCode = (verifyResult.code_verification as Record<string, unknown> | undefined)?.fixed_code as string | undefined;
          const correction = createCorrection(
            issues,
            fixes && fixes.length > 0 ? fixes : ['No automatic fix available — manual correction needed.'],
            args.content as string,
            sessionId,
            fixedCode,
            auth,
          );

          return {
            ...verifyResult,
            correction: {
              correction_id: correction.id,
              state: correction.state,
              what_i_found: issues,
              instruction: 'I found potential issues. Present them plainly to the user and ask: "Is this what you are referring to?" Do NOT propose fixes yet. Do NOT save to memory yet. Wait for the user to confirm with review mode "confirm".',
            },
          };
        }

        return verifyResult;
      }

      // ── User confirms the detected issue is correct ──
      case 'confirm': {
        const correctionId = args.correction_id as string | undefined;
        const correction = correctionId
          ? await confirmIssue(correctionId, sessionId)
          : await (async () => {
              const pending = getMostRecentPendingCorrection(sessionId, CorrectionState.PENDING_ACKNOWLEDGMENT);
              if (!pending) throw new Error('No pending correction to confirm. Run verify first.');
              return confirmIssue(pending.id, sessionId);
            })();

        return {
          success: true,
          correction: {
            correction_id: correction.id,
            state: correction.state,
            proposed_fixes: correction.proposed_fixes,
            fixed_code: correction.fixed_code || null,
            saved_to_memory: correction.saved_to_memory,
            memory_save_error: correction.memory_save_error || null,
            instruction: 'The user confirmed the issue. Now explain the fix clearly and ask: "Want me to go ahead with this fix?" Wait for approval before applying. Use review mode "apply-fix" when the user approves.',
          },
        };
      }

      // ── User approves the fix ──
      case 'apply-fix': {
        const applyId = args.correction_id as string | undefined;
        const applied = applyId
          ? approveFix(applyId, sessionId)
          : (() => {
              const pending = getMostRecentPendingCorrection(sessionId, CorrectionState.PENDING_FIX_APPROVAL);
              if (!pending) throw new Error('No pending correction to apply. Run verify and confirm first.');
              return approveFix(pending.id, sessionId);
            })();

        return {
          success: true,
          correction: {
            correction_id: applied.id,
            state: applied.state,
            proposed_fixes: applied.proposed_fixes,
            fixed_code: applied.fixed_code || null,
            instruction: 'The user approved the fix. Apply it now.',
          },
        };
      }

      // ── User says "no, that's not the issue" ──
      case 'dismiss': {
        const dismissId = args.correction_id as string | undefined;
        const dismissed = dismissId
          ? dismissCorrection(dismissId, sessionId)
          : (() => {
              const pending = getMostRecentPendingCorrection(sessionId);
              if (!pending) throw new Error('No pending correction to dismiss.');
              return dismissCorrection(pending.id, sessionId);
            })();

        return {
          success: true,
          correction: {
            correction_id: dismissed.id,
            state: dismissed.state,
            instruction: 'The detected issue was not what the user meant. Ask the user to explain what went wrong so you can help correctly. Do NOT guess.',
          },
        };
      }

      case 'full': {
        const results: Record<string, unknown> = {};
        if (args.content) {
          results.code_review = await handleComprehensiveCodeReview({
            code: args.content,
            language: args.language,
            auto_fix: args.auto_fix,
          });
          const fullVerifyResult = await handleVerify({
            type: 'all',
            content: args.content,
            language: args.language,
          }) as Record<string, unknown>;
          results.verification = fullVerifyResult;

          const fullIssues = fullVerifyResult.issues as string[] | undefined;
          const fullFixes = fullVerifyResult.fixes as string[] | undefined;
          if (fullVerifyResult.success && !fullVerifyResult.verified && fullIssues && fullIssues.length > 0) {
            const fixedCode = (fullVerifyResult.code_verification as Record<string, unknown> | undefined)?.fixed_code as string | undefined;
            const correction = createCorrection(
              fullIssues,
              fullFixes && fullFixes.length > 0 ? fullFixes : ['No automatic fix available — manual correction needed.'],
              args.content as string,
              sessionId,
              fixedCode,
              auth,
            );
            results.correction = {
              correction_id: correction.id,
              state: correction.state,
              what_i_found: fullIssues,
              instruction: 'I found potential issues. Present them plainly to the user and ask: "Is this what you are referring to?" Do NOT propose fixes yet. Wait for confirmation.',
            };
          }
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
        return { success: false, error: `Unknown mode: ${mode}. Use: code, packages, verify, confirm, apply-fix, dismiss, or full` };
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
