/**
 * Intent Router - CouchLoop Discoverability Layer
 * 
 * This module provides a meta-tool that routes loose/ambiguous user commands
 * to the appropriate CouchLoop tool. Ensures couchloop tools are invoked
 * regardless of how the user phrases their request.
 * 
 * Pattern-based classification (0 latency, deterministic).
 * Falls back to conversation tool for unknown intents.
 */

import { logger } from '../utils/logger.js';

// ============================================================
// INTENT DEFINITIONS
// ============================================================

interface IntentMapping {
  patterns: RegExp[];
  tool: string;
  action?: string;
  defaultArgs?: Record<string, unknown>;
}

const INTENT_MAPPINGS: IntentMapping[] = [
  // Session Management - HIGH PRIORITY (check first)
  {
    patterns: [
      /\b(end|finish|done|wrap[\s-]?up|close|stop|quit|exit)\b.*\b(session|chat|conversation|talking)?\b/i,
      /\b(session|chat|conversation)\b.*\b(end|finish|done|close|stop)\b/i,
      /\bi'?m\s+(done|finished|leaving)\b/i,
      /\b(goodbye|bye|see\s+you|talk\s+later|gtg|gotta\s+go)\b/i,
      // Casual closers
      /\b(that'?s\s+all|all\s+set|we'?re\s+done|all\s+done)\b/i,
      /\b(thanks?,?\s*)?(done|finished|that'?s\s+it)\b/i,
      /\b(signing\s+off|logging\s+off|heading\s+out)\b/i,
      /\b(catch\s+you\s+later|until\s+next\s+time|take\s+care)\b/i,
    ],
    tool: 'conversation',
    action: 'end',
  },
  {
    patterns: [
      /\b(start|begin|new)\b.*\b(session|chat|conversation)\b/i,
      /\b(session|chat|conversation)\b.*\b(start|begin|new)\b/i,
      /\blet'?s\s+(start|begin|chat|talk)\b/i,
    ],
    tool: 'conversation',
    action: 'start',
  },
  {
    patterns: [
      /\b(resume|continue|pick\s+up)\b.*\b(session|chat|conversation|where)\b/i,
      /\bwhere\s+(were\s+we|did\s+we\s+leave)\b/i,
    ],
    tool: 'conversation',
    action: 'resume',
  },
  {
    patterns: [
      /\b(session|chat)\s*(status|info|details)\b/i,
      /\bwhat'?s\s+(the\s+)?(session|status)\b/i,
    ],
    tool: 'conversation',
    action: 'status',
  },

  // Memory/Context - save, remember, checkpoint
  {
    patterns: [
      /\b(save|store|keep|preserve|record|log)\b.*\b(this|that|it|progress|context|work)?\b/i,
      /\b(remember|don'?t\s+forget|note)\b.*\b(this|that|it)?\b/i,
      /\b(checkpoint|snapshot|bookmark)\b/i,
      /\bsave\s+(for\s+later|my\s+progress)\b/i,
      /\bkeep\s+track\b/i,
    ],
    tool: 'remember',
    action: 'save',
  },
  {
    patterns: [
      /\b(recall|retrieve|get|show|what)\b.*\b(saved|stored|remembered|checkpoints?|context)\b/i,
      /\bwhat\s+(do\s+you|did\s+we)\s+(remember|know|save)\b/i,
      /\bprevious\s+(context|session|work)\b/i,
    ],
    tool: 'remember',
    action: 'recall',
  },
  {
    patterns: [
      /\blist\b.*\b(saved|checkpoints?|insights?|memories)\b/i,
      /\bshow\s+(all\s+)?(saved|checkpoints?|insights?)\b/i,
    ],
    tool: 'remember',
    action: 'list',
  },

  // Code Review
  {
    patterns: [
      /\b(review|check|analyze|audit|inspect|look\s+at)\b.*\b(code|this|function|file|snippet)?\b/i,
      /\b(code)\b.*\b(review|check|analysis)\b/i,
      /\b(security|vulnerability)\b.*\b(check|scan|audit)\b/i,
      /\b(lint|linting)\b/i,
      /\b(find|detect)\b.*\b(bugs?|issues?|problems?|errors?)\b/i,
      /\bis\s+(this|it)\s+(safe|secure|ok|good)\b/i,
      /\bwhat'?s\s+wrong\s+with\b/i,
    ],
    tool: 'code_review',
  },

  // Package Audit
  {
    patterns: [
      /\b(audit|check|validate)\b.*\b(packages?|dependencies|deps|npm|pypi)\b/i,
      /\b(packages?|dependencies|deps)\b.*\b(audit|check|outdated|vulnerable)\b/i,
      /\b(outdated|deprecated|vulnerable)\b.*\b(packages?|dependencies|deps)?\b/i,
      /\bnpm\s+audit\b/i,
      /\b(upgrade|update)\b.*\b(packages?|dependencies|deps)\b/i,
      /\bsecurity\s+scan\b.*\b(packages?|deps)?\b/i,
    ],
    tool: 'package_audit',
  },

  // File Protection
  {
    patterns: [
      /\b(backup|back\s+up)\b.*\b(file|code|this)?\b/i,
      /\b(protect|guard|safe)\b.*\b(file|code|this)?\b/i,
      /\b(freeze|lock)\b.*\b(code|file|changes?)?\b/i,
      /\b(rollback|undo|restore|revert)\b/i,
      /\bcode\s+freeze\b/i,
      /\bsafe\s+mode\b/i,
    ],
    tool: 'protect',
  },

  // Help/Capabilities - show what couchloop can do
  {
    patterns: [
      /\b(help|what\s+can\s+you\s+do|capabilities|features)\b/i,
      /\b(list|show)\s+(tools|commands|options)\b/i,
      /\bhow\s+do\s+i\b/i,
      /\bwhat\s+(are|is)\s+(your|the)\s+(tools|capabilities|features)\b/i,
      /\bguide|tutorial|getting\s+started\b/i,
    ],
    tool: 'help',  // Special case - handled inline
  },

  // Status/Dashboard - NEW
  {
    patterns: [
      /\b(how\s+am\s+i\s+doing|what'?s\s+my\s+(progress|status))\b/i,
      /\b(show|check|get)\s+my\s+(status|progress|history)\b/i,
      /\b(what\s+do\s+you\s+know\s+about\s+me)\b/i,
      /\bmy\s+(settings|preferences)\b/i,
      /\b(context\s+window|backup\s+status)\b/i,
      /\bwhere\s+should\s+i\s+start\b/i,
      /\b(dashboard|overview)\b/i,
      /\bwhat'?s\s+(saved|stored|remembered)\b/i,
    ],
    tool: 'status',
    action: 'all',
  },

  // Verify - PRE-DELIVERY VERIFICATION - NEW
  {
    patterns: [
      /\b(verify|validate|check)\s+(this|my|the)\s+(response|code|answer|output)\b/i,
      /\b(is\s+this|are\s+these)\s+(correct|right|accurate|true)\b/i,
      /\bbefore\s+(i\s+)?(show|present|send)\b/i,
      /\b(double[\s-]?check|fact[\s-]?check)\b/i,
      /\b(verify|check)\s+before\s+(presenting|showing|sending)\b/i,
      /\b(verify|validate)\s+(packages?|dependencies)\s+exist\b/i,
      /\bdoes\s+(this|that)\s+package\s+exist\b/i,
      /\b(check|verify)\s+for\s+(hallucination|errors|mistakes)\b/i,
    ],
    tool: 'verify',
    defaultArgs: { type: 'all' },
  },

  // Wellness/Emotional Support - LOWEST PRIORITY (catch-all for emotional content)
  {
    patterns: [
      /\b(stressed|anxious|worried|overwhelmed|sad|depressed|angry|frustrated|scared|lonely)\b/i,
      /\b(feeling|i\s+feel|i'?m\s+feeling)\b/i,
      /\b(help\s+me|need\s+help|struggling)\b/i,
      /\bhow\s+are\s+you\b/i,
      /\b(talk|chat|vent)\b.*\b(to\s+you|with\s+you)?\b/i,
      /\b(support|encourage|listen)\b/i,
    ],
    tool: 'conversation',
    action: 'send',
  },
];

// ============================================================
// INTENT CLASSIFICATION
// ============================================================

export interface ClassificationResult {
  tool: string;
  action?: string;
  confidence: number;
  matchedPattern?: string;
  args: Record<string, unknown>;
}

function classifyIntent(input: string): ClassificationResult {
  const normalizedInput = input.toLowerCase().trim();

  for (const mapping of INTENT_MAPPINGS) {
    for (const pattern of mapping.patterns) {
      if (pattern.test(normalizedInput)) {
        return {
          tool: mapping.tool,
          action: mapping.action,
          confidence: 0.9,
          matchedPattern: pattern.source,
          args: mapping.defaultArgs || {},
        };
      }
    }
  }

  // Default fallback: conversation tool (send action)
  return {
    tool: 'conversation',
    action: 'send',
    confidence: 0.5,
    args: {},
  };
}

// ============================================================
// TOOL REGISTRY (populated by primary-tools.ts)
// ============================================================

const toolRegistry: Map<string, { handler: (args: Record<string, unknown>) => Promise<unknown> }> = new Map();

export function registerTools(tools: Array<{ definition: { name: string }; handler: (args: Record<string, unknown>) => Promise<unknown> }>) {
  toolRegistry.clear();
  for (const tool of tools) {
    toolRegistry.set(tool.definition.name, { handler: tool.handler });
  }
  logger.info(`Intent router registered ${toolRegistry.size} tools`);
}

// ============================================================
// INTENT ROUTER TOOL DEFINITION
// ============================================================

export const intentRouterTool = {
  definition: {
    name: 'couchloop',
    description: `Universal entry point for CouchLoop. Routes ANY command to the right tool. ALWAYS use for ambiguous/loose commands. Handles:
- Sessions: "end session", "start", "done", "wrap up", "goodbye", "resume", "where should I start", "hi", "hey"
- Status: "how am I doing", "what do you know about me", "show my progress", "my settings"
- Memory: "save", "remember", "checkpoint", "recall", "don't forget"
- Code: "review code", "check this", "find bugs", "is this safe"
- Packages: "audit dependencies", "outdated", "npm audit", "upgrade"
- Protection: "backup", "freeze code", "rollback", "undo", "restore"
- Wellness: "I'm stressed", "feeling anxious", "help me", "need to talk"
- Verification: "verify this", "check my response", "is this correct", "does this package exist"

This tool should be invoked for ANY ambiguous or loose command related to sessions, memory, code quality, verification, or emotional support.`,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          description: 'What the user wants to do. Can be a loose phrase like "end session" or "review this code".',
        },
        context: {
          type: 'string',
          description: 'Additional context (code to review, message content, etc.)',
        },
        session_id: {
          type: 'string',
          description: 'Session ID if known',
        },
      },
      required: ['intent'],
    },
  },

  handler: async (args: Record<string, unknown>) => {
    const intent = args.intent as string;
    const context = args.context as string | undefined;
    const sessionId = args.session_id as string | undefined;

    if (!intent) {
      return {
        error: 'Missing required parameter: intent',
        hint: 'Provide what the user wants to do, e.g., "end session" or "review code"',
      };
    }

    // Classify the intent
    const classification = classifyIntent(intent);

    logger.info('Intent classification:', {
      input: intent,
      tool: classification.tool,
      action: classification.action,
      confidence: classification.confidence,
      matchedPattern: classification.matchedPattern,
    });

    // Special case: help - return capabilities inline
    if (classification.tool === 'help') {
      return {
        routed_to: 'help',
        message: 'CouchLoop MCP Server - Available Tools',
        tools: {
          couchloop: 'Universal entry point - routes any command to the right tool',
          verify: 'Pre-delivery verification - catches AI hallucinations, validates packages, checks code',
          status: 'Dashboard - session progress, history, context, protection, preferences',
          conversation: 'Therapeutic AI conversation with crisis detection and session memory. Actions: start, send, end, resume, status',
          remember: 'Save and recall context, checkpoints, insights. Actions: save, recall, list, preferences',
          code_review: 'Complete code analysis - security vulnerabilities, code smells, AI errors. Modes: full, security, quality, ai_errors, verify_before_presenting',
          package_audit: 'Dependency audit - validates packages exist, checks versions, finds vulnerabilities. Modes: full, security, validate, validate_before_recommending',
          protect: 'File protection - backup, freeze, rollback, restore',
        },
        examples: [
          'couchloop(intent: "end session") → ends current session',
          'couchloop(intent: "where should I start") → status with next steps',
          'verify(type: "packages", content: "import lodash-utils") → validates package exists',
          'verify(type: "code", content: "function foo()...") → checks for AI errors',
          'status(check: "all") → full dashboard',
          'conversation(action: "send", message: "I\'m feeling stressed") → wellness chat',
        ],
        hint: 'Use couchloop for loose commands, verify before presenting AI-generated content, or call specific tools directly.',
      };
    }

    // Look up the target tool
    const targetTool = toolRegistry.get(classification.tool);

    if (!targetTool) {
      return {
        error: `Tool not found: ${classification.tool}`,
        classification,
        registeredTools: Array.from(toolRegistry.keys()),
      };
    }

    // Build arguments for the target tool
    const targetArgs: Record<string, unknown> = {
      ...classification.args,
    };

    // Map common parameters
    if (sessionId) {
      targetArgs.session_id = sessionId;
    }

    // Tool-specific argument mapping
    switch (classification.tool) {
      case 'conversation':
        targetArgs.action = classification.action || 'send';
        targetArgs.message = context || intent;
        break;

      case 'remember':
        targetArgs.action = classification.action || 'save';
        targetArgs.content = context || intent;
        break;

      case 'code_review':
        targetArgs.code = context || '';
        if (!context) {
          return {
            routed_to: 'code_review',
            message: 'Ready to review code. Please provide the code to analyze.',
            hint: 'Invoke code_review directly with the code parameter, or call couchloop again with context containing the code.',
          };
        }
        break;

      case 'package_audit':
        // Try to extract package names from context
        if (context) {
          const packages = context.split(/[,\s]+/).filter(p => p.length > 0);
          targetArgs.packages = packages;
        } else {
          return {
            routed_to: 'package_audit',
            message: 'Ready to audit packages. Please provide package names.',
            hint: 'Invoke package_audit directly with the packages parameter.',
          };
        }
        break;

      case 'protect':
        // Infer action from intent
        if (/rollback|undo|restore|revert/i.test(intent)) {
          targetArgs.action = 'rollback';
        } else if (/freeze|lock/i.test(intent)) {
          targetArgs.action = 'freeze';
        } else if (/unfreeze|unlock/i.test(intent)) {
          targetArgs.action = 'unfreeze';
        } else if (/backup/i.test(intent)) {
          targetArgs.action = 'backup';
        } else {
          targetArgs.action = 'status';
        }
        if (context) {
          targetArgs.path = context;
        }
        break;

      case 'status':
        // Infer what to check from intent
        if (/session|progress/i.test(intent)) {
          targetArgs.check = 'session';
        } else if (/history|insight|pattern/i.test(intent)) {
          targetArgs.check = 'history';
        } else if (/context|window|stored|decisions/i.test(intent)) {
          targetArgs.check = 'context';
        } else if (/backup|protection|freeze/i.test(intent)) {
          targetArgs.check = 'protection';
        } else if (/preference|setting|timezone/i.test(intent)) {
          targetArgs.check = 'preferences';
        } else {
          targetArgs.check = 'all';
        }
        break;

      case 'verify':
        // Infer verification type from intent/context
        if (/package|dependenc|npm|pypi/i.test(intent) || /package|dependenc/i.test(context || '')) {
          targetArgs.type = 'packages';
        } else if (/code|function|class|import/i.test(intent) || context?.includes('function') || context?.includes('import')) {
          targetArgs.type = 'code';
        } else if (/fact|claim|statistic|true|correct/i.test(intent)) {
          targetArgs.type = 'facts';
        } else if (/response|answer|output|tone/i.test(intent)) {
          targetArgs.type = 'response';
        } else {
          targetArgs.type = 'all';
        }
        targetArgs.content = context || intent;
        break;
    }

    // Invoke the target tool
    try {
      const result = await targetTool.handler(targetArgs);

      return {
        routed_to: classification.tool,
        action: classification.action,
        confidence: classification.confidence,
        result,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Tool invocation failed';
      logger.error('Intent router tool invocation failed:', error);
      return {
        routed_to: classification.tool,
        error: errorMessage,
        classification,
        args_passed: targetArgs,
      };
    }
  },
};
