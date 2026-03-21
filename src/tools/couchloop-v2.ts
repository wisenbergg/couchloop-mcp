/**
 * CouchLoop V2 - Refactored Intent Router
 *
 * This is the new implementation of couchloop that uses the modular
 * orchestration system instead of the monolithic god-object pattern.
 *
 * It integrates:
 * - Intent classification with confidence scoring
 * - Policy-based routing decisions
 * - Execution planning with DAGs
 * - OpenTelemetry tracing
 * - Tool registry with health tracking
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { classifyIntent } from '../core/intent/classifier.js';
import { intentRouterTool } from './intent-router.js';
import { PolicyEngine } from '../core/policy/engine.js';
import { ExecutionPlanner } from '../core/planning/planner.js';
import { ToolRegistry } from '../core/registry/registry.js';
import {
  createStandardRequest,
  createStandardResponse,
  createStandardError,
} from '../core/envelopes.js';
import {
  startRequestSpan,
  traceAsync,
  TracingStages,
  addSpanEvent,
} from '../core/telemetry/tracing.js';
import type { PolicyContext } from '../core/policy/types.js';

/**
 * Feature flags for gradual rollout
 */
interface FeatureFlags {
  useV2Classifier: boolean;
  useV2PolicyEngine: boolean;
  useV2Planner: boolean;
  useV2Telemetry: boolean;
  directRouteEnabled: boolean;
  parallelExecutionEnabled: boolean;
  cachingEnabled: boolean;
}

// Default feature flags (can be overridden by environment variables)
const FEATURE_FLAGS: FeatureFlags = {
  useV2Classifier: process.env.USE_V2_CLASSIFIER !== 'false',
  useV2PolicyEngine: process.env.USE_V2_POLICY !== 'false',
  useV2Planner: process.env.USE_V2_PLANNER !== 'false',
  useV2Telemetry: process.env.USE_V2_TELEMETRY !== 'false',
  directRouteEnabled: process.env.DIRECT_ROUTE_ENABLED !== 'false',
  parallelExecutionEnabled: process.env.PARALLEL_EXECUTION === 'true',
  cachingEnabled: process.env.CACHING_ENABLED === 'true',
};

// Initialize components
const policyEngine = new PolicyEngine();
const executionPlanner = new ExecutionPlanner();
const toolRegistry = ToolRegistry.getInstance();

/**
 * Main couchloop v2 handler - backward compatible interface
 */
export async function couchloopV2Handler(args: Record<string, unknown>): Promise<unknown> {
  const requestId = uuidv4();
  const traceId = (args.trace_id as string) || uuidv4();
  const startTime = Date.now();

  // Start tracing if enabled
  const span = FEATURE_FLAGS.useV2Telemetry ?
    startRequestSpan('couchloop_v2', { requestId, traceId }) : null;

  try {
    // Extract input from legacy format
    const intent = args.intent as string;
    const context = args.context as string | undefined;
    const sessionId = args.session_id as string | undefined;
    const tenantId = args.tenant_id as string | undefined;
    const userId = args.user_id as string | undefined;

    if (!intent) {
      throw createStandardError('MISSING_INTENT', 'Intent parameter is required');
    }

    // Log incoming request
    logger.info('CouchLoop V2 request', {
      requestId,
      traceId,
      intent: intent.substring(0, 100),
      hasContext: !!context,
      sessionId,
    });

    // Phase 1: Normalize input (minimal for now)
    const normalizedInput = await traceAsync(
      TracingStages.NORMALIZE,
      async (normalizeSpan) => {
        normalizeSpan.setAttributes({
          'input.length': intent.length,
          'has.context': !!context,
        });
        return {
          intent: intent.trim(),
          context: context?.trim(),
          metadata: { sessionId, tenantId, userId },
        };
      },
      { attributes: { requestId, stage: 'normalize' } }
    );

    // Phase 2: Classify intent
    const classification = await traceAsync(
      TracingStages.CLASSIFY,
      async (classifySpan) => {
        if (!FEATURE_FLAGS.useV2Classifier) {
          // Fallback to simple classification for gradual rollout
          return {
            primaryIntent: 'unknown' as const,
            confidence: 0.5,
            ambiguous: true,
            multiIntent: false,
            alternatives: [],
          };
        }

        const result = classifyIntent(normalizedInput.intent);

        classifySpan.setAttributes({
          'intent.primary': result.primaryIntent,
          'intent.confidence': result.confidence,
          'intent.ambiguous': result.ambiguous,
          'intent.multi': result.multiIntent,
        });

        return result;
      },
      { attributes: { requestId, stage: 'classify' } }
    );

    // Phase 3: Apply policy engine
    const policyDecision = await traceAsync(
      TracingStages.POLICY,
      async (policySpan) => {
        if (!FEATURE_FLAGS.useV2PolicyEngine) {
          // Simple policy for gradual rollout
          return {
            action: 'router' as const,
            reason: 'V2 policy engine disabled',
            confidence: classification.confidence,
          };
        }

        const policyContext: PolicyContext = {
          requestId,
          traceId,
          tenantId,
          userId,
          sessionId,
          latencyBudgetMs: 5000,
          priority: 'normal',
        };

        const decision = policyEngine.evaluate(
          policyContext,
          classification,
          toolRegistry.getHealthMap()
        );

        policySpan.setAttributes({
          'policy.action': decision.action,
          'policy.target': decision.targetTool,
          'policy.reason': decision.reason,
        });

        return decision;
      },
      { attributes: { requestId, stage: 'policy' } }
    );

    // Phase 4: Create execution plan
    const executionPlan = await traceAsync(
      TracingStages.PLAN,
      async (planSpan) => {
        if (!FEATURE_FLAGS.useV2Planner) {
          // Simple single-node plan for gradual rollout
          return {
            planId: uuidv4(),
            planType: 'single' as const,
            nodes: [{
              nodeId: 'n1',
              tool: policyDecision.targetTool || 'couchloop_router',
              dependsOn: [],
              deadlineMs: 5000,
              retryPolicy: 'standard' as const,
            }],
            globalDeadlineMs: 5000,
            fallbacks: {},
          };
        }

        const plan = executionPlanner.createPlan(
          classification,
          policyDecision,
          5000 // Default deadline
        );

        planSpan.setAttributes({
          'plan.id': plan.planId,
          'plan.type': plan.planType,
          'plan.nodes': plan.nodes.length,
        });

        return plan;
      },
      { attributes: { requestId, stage: 'plan' } }
    );

    // Phase 5: Execute plan
    const executionResult = await traceAsync(
      TracingStages.EXECUTE,
      async (executeSpan) => {
        executeSpan.setAttributes({
          'execution.plan': executionPlan.planId,
          'execution.nodes': executionPlan.nodes.length,
        });

        // For now, execute the first node only (full parallel execution coming later)
        if (executionPlan.nodes.length === 0) {
          return {
            success: false,
            error: 'No execution nodes in plan',
          };
        }

        const primaryNode = executionPlan.nodes[0];
        if (!primaryNode) {
          return {
            success: false,
            error: 'Primary node not found in plan',
          };
        }

        const tool = toolRegistry.getTool(primaryNode.tool);

        if (!tool) {
          // Fallback to legacy router if tool not found
          addSpanEvent('tool_not_found', { tool: primaryNode.tool });
          return executeLegacyRouter(normalizedInput);
        }

        // Execute the tool with timeout
        const toolStartTime = Date.now();
        try {
          const result = await Promise.race([
            tool.handler({
              ...normalizedInput.metadata,
              intent: normalizedInput.intent,
              context: normalizedInput.context,
              action: mapIntentToAction(classification.primaryIntent),
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Tool execution timeout')), primaryNode.deadlineMs)
            ),
          ]);

          const toolLatency = Date.now() - toolStartTime;
          toolRegistry.recordToolExecution(primaryNode.tool, 'success', toolLatency);

          executeSpan.setAttributes({
            'execution.success': true,
            'execution.latency': toolLatency,
          });

          return {
            success: true,
            result,
            tool: primaryNode.tool,
            latency: toolLatency,
          };
        } catch (error) {
          const toolLatency = Date.now() - toolStartTime;
          const isTimeout = error instanceof Error && error.message === 'Tool execution timeout';

          toolRegistry.recordToolExecution(
            primaryNode.tool,
            isTimeout ? 'timeout' : 'error',
            toolLatency
          );

          executeSpan.setAttributes({
            'execution.success': false,
            'execution.error': error instanceof Error ? error.message : 'Unknown error',
          });

          // Try fallback if available
          const fallbacks = executionPlan.fallbacks[primaryNode.nodeId];
          if (fallbacks && fallbacks.length > 0 && fallbacks[0]) {
            addSpanEvent('executing_fallback');
            return executeFallback(
              fallbacks[0],
              normalizedInput
            );
          }

          throw error;
        }
      },
      { attributes: { requestId, stage: 'execute' } }
    );

    // Phase 6: Compose response
    const response = await traceAsync(
      TracingStages.COMPOSE,
      async (composeSpan) => {
        const totalLatency = Date.now() - startTime;

        composeSpan.setAttributes({
          'response.latency': totalLatency,
          'response.success': executionResult.success,
        });

        // Create standard response
        const standardRequest = createStandardRequest(normalizedInput, {
          requestId,
          traceId,
          tenantId,
          userId,
          sessionId,
          intent: classification,
        });

        // Create standard response for logging/metrics (but return legacy format)
        createStandardResponse(
          standardRequest,
          executionResult.result,
          {
            toolName: executionResult.tool || 'unknown',
            status: executionResult.success ? 'success' : 'failed',
            latencyMs: totalLatency,
            warnings: classification.ambiguous ?
              ['Intent was ambiguous, best effort routing applied'] : undefined,
          }
        );

        // Return legacy format for backward compatibility
        return {
          ...executionResult.result,
          _metadata: {
            requestId,
            traceId,
            classification: {
              intent: classification.primaryIntent,
              confidence: classification.confidence,
              ambiguous: classification.ambiguous,
            },
            routing: {
              action: policyDecision.action,
              reason: policyDecision.reason,
            },
            execution: {
              planType: executionPlan.planType,
              tool: executionResult.tool,
              latencyMs: totalLatency,
            },
          },
        };
      },
      { attributes: { requestId, stage: 'compose' } }
    );

    // Log completion
    logger.info('CouchLoop V2 request completed', {
      requestId,
      traceId,
      totalLatency: Date.now() - startTime,
      intent: classification.primaryIntent,
      confidence: classification.confidence,
      routingAction: policyDecision.action,
      tool: executionResult.tool,
    });

    return response;

  } catch (error) {
    logger.error('CouchLoop V2 request failed', {
      requestId,
      traceId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    span?.setStatus({
      code: 2, // ERROR
      message: error instanceof Error ? error.message : 'Unknown error',
    });

    // Return error in legacy format
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId,
      traceId,
    };
  } finally {
    span?.end();
  }
}

/**
 * Execute legacy router for backward compatibility.
 * Delegates to the real intent router (intent-router.ts) which has its own
 * populated tool registry from registerTools(). This bridges the gap between
 * the V2 ToolRegistry and the legacy tool Map until they are fully unified.
 */
async function executeLegacyRouter(input: any): Promise<any> {
  try {
    const result = await intentRouterTool.handler({
      intent: input.intent,
      context: input.context,
      session_id: input.metadata?.sessionId,
    });
    return result;
  } catch (error) {
    logger.error('[couchloop-v2] Legacy router fallback failed:', error);
    return {
      success: false,
      routed_to: 'legacy_router',
      error: error instanceof Error ? error.message : 'Legacy router failed',
    };
  }
}

/**
 * Execute fallback tool
 */
async function executeFallback(toolName: string, input: any): Promise<any> {
  const tool = toolRegistry.getTool(toolName);
  if (!tool) {
    return {
      success: false,
      error: `Fallback tool ${toolName} not found`,
    };
  }

  try {
    const result = await tool.handler(input);
    return {
      success: true,
      result,
      tool: toolName,
      fallback: true,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Fallback failed',
      tool: toolName,
    };
  }
}

/**
 * Map intent to action for backward compatibility
 */
function mapIntentToAction(intent: string): string | undefined {
  const actionMap: Record<string, string> = {
    'session_control': 'send',
    'memory_control': 'save',
  };
  return actionMap[intent];
}

/**
 * Export the new couchloop tool definition
 */
export const couchloopV2Tool = {
  definition: {
    name: 'couchloop',
    description: `Universal entry point for CouchLoop. Routes ANY command to the right tool automatically. ALWAYS use for ambiguous or loose commands. Handles:
- Sessions: "end session", "start", "done", "wrap up", "goodbye", "resume", "where should I start", "hi", "hey"
- Status: "how am I doing", "what do you know about me", "show my progress", "my settings", "dashboard"
- Memory: "save", "remember", "checkpoint", "recall", "don't forget", "keep track"
- Code: "review code", "check this", "find bugs", "is this safe", "analyze"
- Packages: "audit dependencies", "outdated", "npm audit", "upgrade packages", "security scan"
- Protection: "backup", "freeze code", "rollback", "undo", "restore"
- Brainstorm: "brainstorm", "think through", "map out feature", "help me design", "I have an idea", "trade-offs"
- Journeys: "I'm stressed", "feeling anxious", "help me", "need to talk"
- Verification: "verify this", "check my response", "is this correct", "does this package exist"

Invoke for ANY ambiguous, loose, or multi-intent command. High-confidence single-intent commands can also call specific tools directly.`,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          description: 'What the user wants to do. Can be a loose natural-language phrase like "end session", "review this code", "I have an idea", or "where should I start".',
        },
        context: {
          type: 'string',
          description: 'Additional content relevant to the intent — code to review, a message body, package names, or any supporting detail that helps route and execute the command.',
        },
        session_id: {
          type: 'string',
          description: 'Active session ID if known. Omit to let the server resolve the current session automatically.',
        },
      },
      required: ['intent'],
    },
  },
  handler: couchloopV2Handler,
};