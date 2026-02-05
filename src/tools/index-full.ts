import { createSession, resumeSession } from './session.js';
import { endSession } from './session-manager.js';
import { saveCheckpoint, getCheckpoints } from './checkpoint.js';
import { listJourneys, getJourneyStatus } from './journey.js';
import { saveInsight, getInsights, getUserContext } from './insight.js';
import { sendMessage } from './sendMessage.js';
import { validatePackagesTool, handleValidatePackages } from './validate_packages.js';
import { preReviewCodeTool, handlePreReviewCode } from './pre-review-code.js';
import { scanSecurityTool, handleScanSecurity } from './scan-security.js';
import { detectCodeSmellTool, handleDetectCodeSmell } from './detect-code-smell.js';
import { preventAIErrorsTool, handlePreventAIErrors } from './prevent-ai-errors.js';
import { detectBuildContextTool, handleDetectBuildContext } from './detect-build-context.js';
import { generateUpgradeReportTool, handleGenerateUpgradeReport } from './generate-upgrade-report.js';
import { comprehensiveCodeReviewTool, handleComprehensiveCodeReview } from './comprehensive-code-review.js';
import { comprehensivePackageAuditTool, handleComprehensivePackageAudit } from './comprehensive-package-audit.js';
import { smartContextTool, handleSmartContext } from './smart-context.js';
import {
  protectFiles,
  getProtectionStatus,
  getOperationHistory,
  listBackups,
  rollbackFile,
  enableCodeFreeze,
  disableCodeFreeze,
} from './protect-files.js';
import { preserveContext } from './preserve-context.js';
import { checkVersionsTool, handleCheckVersions } from './check-versions.js';
import { logger } from '../utils/logger.js';

export async function setupTools() {
  const tools = [
    {
      definition: {
        name: 'create_session',
        description: 'Start a new guided session. Optionally specify a journey to follow.',
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {
            journey_slug: {
              type: 'string',
              description: 'Optional journey to follow (e.g., "daily-reflection")',
            },
            context: {
              type: 'string',
              description: 'Brief context for this session',
            },
          },
          required: [],
        },
      },
      handler: createSession
    },
    {
      definition: {
        name: 'send_message',
        description: 'Send a message through the therapeutic AI stack with crisis detection and emotional support. Session is created automatically if not provided.',
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: true,
        },
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Session ID (optional - auto-created if not provided)',
            },
            message: {
              type: 'string',
              description: 'The message to send',
            },
            save_checkpoint: {
              type: 'boolean',
              description: 'Whether to save this exchange as a checkpoint (default: false)',
            },
            checkpoint_key: {
              type: 'string',
              description: 'Custom key for the checkpoint if saving',
            },
            advance_step: {
              type: 'boolean',
              description: 'Whether to advance to next journey step after response (default: false)',
            },
            include_memory: {
              type: 'boolean',
              description: 'Include session memory context (default: true)',
            },
            system_prompt: {
              type: 'string',
              description: 'Optional custom system prompt',
            },
            conversation_type: {
              type: 'string',
              description: 'Type of conversation (e.g., "therapeutic", "crisis", "casual")',
            },
          },
          required: ['message'],
        },
      },
      handler: sendMessage
    },
    {
      definition: {
        name: 'resume_session',
        description: 'Resume a previously paused session. Returns current state and next step.',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Session ID to resume (omit to resume most recent)',
            },
          },
          required: [],
        },
      },
      handler: resumeSession
    },
    {
      definition: {
        name: 'end_session',
        description: 'End the current session. Call this when done with stateful operations.',
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Session ID to end (optional - ends current session if not provided)',
            },
          },
          required: [],
        },
      },
      handler: endSession
    },
    {
      definition: {
        name: 'save_checkpoint',
        description: 'Save progress, capture insights, and preserve context in one unified operation. Consolidates checkpoint, insight, and context preservation functionality.',
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Session ID (optional - auto-created if not provided)',
            },
            key: {
              type: 'string',
              description: 'What is being captured (e.g., "mood", "reflection", "gratitude")',
            },
            value: {
              // Using empty schema {} to allow any JSON value type
              type: 'object',
              additionalProperties: true,
              description: 'The captured content (can be any JSON value: string, number, object, array, etc.)',
            },
            advance_step: {
              type: 'boolean',
              description: 'Whether to advance to next journey step (default: true)',
            },
            // === Consolidated insight functionality ===
            save_as_insight: {
              type: 'boolean',
              description: 'Also save this as a user insight for long-term recall (default: false)',
            },
            insight_tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags for the insight if saving as insight',
            },
            // === Consolidated context preservation ===
            preserve_context: {
              type: 'boolean',
              description: 'Also store as persistent project context to prevent AI amnesia (default: false)',
            },
            context_category: {
              type: 'string',
              enum: ['architecture', 'requirements', 'constraints', 'decisions', 'technical-patterns', 'project-metadata'],
              description: 'Category for context preservation',
            },
            // === Governance ===
            governance_check: {
              type: 'boolean',
              description: 'Run governance validation on the value (default: true)',
            },
          },
          required: ['key', 'value'],
        },
      },
      handler: saveCheckpoint
    },
    {
      definition: {
        name: 'get_checkpoints',
        description: 'Get all checkpoints for a session. Uses current session if not specified.',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Session ID (optional - uses current session if not provided)',
            },
          },
          required: [],
        },
      },
      handler: getCheckpoints
    },
    {
      definition: {
        name: 'list_journeys',
        description: 'List available guided journeys/experiences.',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {
            tag: {
              type: 'string',
              description: 'Filter by tag (e.g., "reflection", "gratitude")',
            },
          },
          required: [],
        },
      },
      handler: listJourneys
    },
    {
      definition: {
        name: 'get_journey_status',
        description: 'Get current progress in a session/journey.',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Session ID to check',
            },
          },
          required: ['session_id'],
        },
      },
      handler: getJourneyStatus
    },
    {
      definition: {
        name: 'save_insight',
        description: 'Capture a meaningful insight or realization from the conversation.',
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
              description: 'The insight to save',
            },
            session_id: {
              type: 'string',
              description: 'Optional session to link this insight to',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional tags for categorization',
            },
          },
          required: ['content'],
        },
      },
      handler: saveInsight
    },
    {
      definition: {
        name: 'get_insights',
        description: 'Get user insights, optionally filtered by session.',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Optional session ID to filter insights',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of insights to return (default: 10)',
            },
            auth: {
              type: 'object',
              description: 'Authentication context for user identification',
              properties: {
                token: {
                  type: 'string',
                  description: 'OAuth access token or session identifier',
                },
                user_id: {
                  type: 'string',
                  description: 'External user identifier from OAuth provider',
                },
                client_id: {
                  type: 'string',
                  description: 'Client application identifier',
                },
              },
            },
          },
          required: [],
        },
      },
      handler: getInsights
    },
    {
      definition: {
        name: 'get_user_context',
        description: 'Get relevant context about this user for personalization.',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {
            include_recent_insights: {
              type: 'boolean',
              description: 'Include recent insights (default: true)',
            },
            include_session_history: {
              type: 'boolean',
              description: 'Include recent session summaries (default: true)',
            },
          },
          required: [],
        },
      },
      handler: getUserContext
    },
    {
      definition: validatePackagesTool,
      handler: handleValidatePackages
    },
    {
      definition: preReviewCodeTool,
      handler: handlePreReviewCode
    },
    {
      definition: scanSecurityTool,
      handler: handleScanSecurity
    },
    {
      definition: detectCodeSmellTool,
      handler: handleDetectCodeSmell
    },
    {
      definition: preventAIErrorsTool,
      handler: handlePreventAIErrors
    },
    {
      definition: detectBuildContextTool,
      handler: handleDetectBuildContext
    },
    {
      definition: generateUpgradeReportTool,
      handler: handleGenerateUpgradeReport
    },
    // === COMPOSITE TOOLS (bundled for maximum impact, minimal thinking) ===
    {
      definition: comprehensiveCodeReviewTool,
      handler: handleComprehensiveCodeReview
    },
    {
      definition: comprehensivePackageAuditTool,
      handler: handleComprehensivePackageAudit
    },
    {
      definition: smartContextTool,
      handler: handleSmartContext
    },
    {
      definition: {
        name: 'protect_files',
        description: 'Prevents accidental file deletion and destructive operations. Validates operations against protected paths and patterns, creates automatic backups, and provides rollback capability.',
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['delete', 'overwrite', 'move'],
              description: 'Type of file operation to protect',
            },
            path: {
              type: 'string',
              description: 'Path to file or directory being modified',
            },
            target_path: {
              type: 'string',
              description: 'Destination path (required for move operations)',
            },
            force: {
              type: 'boolean',
              description: 'Force operation (bypasses some safety checks)',
            },
            reason: {
              type: 'string',
              description: 'Reason for the operation',
            },
          },
          required: ['operation', 'path'],
        },
      },
      handler: protectFiles,
    },
    {
      definition: {
        name: 'get_protection_status',
        description: 'Get current file protection status, configuration, and backup statistics.',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      handler: getProtectionStatus,
    },
    {
      definition: {
        name: 'get_operation_history',
        description: 'Get history of file operations that were attempted or executed.',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of operations to return (default: 50)',
            },
          },
          required: [],
        },
      },
      handler: getOperationHistory,
    },
    {
      definition: {
        name: 'list_backups',
        description: 'List all available backup snapshots that can be restored.',
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      handler: listBackups,
    },
    {
      definition: {
        name: 'rollback_file',
        description: 'Restore a file from a backup snapshot (undo a file modification/deletion).',
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {
            backup_id: {
              type: 'string',
              description: 'ID of the backup to restore from',
            },
          },
          required: ['backup_id'],
        },
      },
      handler: rollbackFile,
    },
    {
      definition: {
        name: 'enable_code_freeze',
        description: 'Enable code freeze mode - all file operations require explicit approval (critical protection mode).',
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      handler: enableCodeFreeze,
    },
    {
      definition: {
        name: 'disable_code_freeze',
        description: 'Disable code freeze mode - resume normal file operation protection rules.',
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      handler: disableCodeFreeze,
    },
    {
      definition: {
        name: 'preserve_context',
        description: 'Store, retrieve, and manage important project context to prevent AI amnesia when context windows fill up. Preserves architectural decisions, requirements, constraints, and technical patterns across conversations.',
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
              enum: ['store', 'retrieve', 'check'],
              description: 'Action to perform: "store" (save context), "retrieve" (get stored context), or "check" (view status)',
            },
            category: {
              type: 'string',
              enum: ['architecture', 'requirements', 'constraints', 'decisions', 'technical-patterns', 'project-metadata'],
              description: 'Context category (required for store, optional for retrieve)',
            },
            content: {
              type: 'string',
              description: 'Content to store (required for store action)',
            },
            search_term: {
              type: 'string',
              description: 'Search term for retrieving context (optional)',
            },
            include_metadata: {
              type: 'boolean',
              description: 'Include usage metadata in response (for check action, default: false)',
            },
          },
          required: ['action'],
        },
      },
      handler: preserveContext,
    },
    {
      definition: checkVersionsTool,
      handler: handleCheckVersions
    }
  ];

  logger.info(`Prepared ${tools.length} MCP tools`);
  return tools;
}