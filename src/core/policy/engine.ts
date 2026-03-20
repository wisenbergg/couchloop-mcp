/**
 * Policy Engine
 *
 * Evaluates classification results and applies business rules to
 * determine routing strategy. This replaces hardcoded routing logic
 * with configurable policies.
 */

import { logger } from '../../utils/logger.js';
import type { IntentResult } from '../intent/types.js';
import type {
  PolicyContext,
  PolicyDecision,
  PolicyRule,
  PolicyConfig,
  ToolHealth,
} from './types.js';

const DEFAULT_CONFIG: PolicyConfig = {
  minToolHealthForDirectRoute: 0.95,
  minToolHealthForAnyRoute: 0.80,
  maxLatencyForDirectRouteMs: 1000,
  defaultTimeoutMs: 5000,
  alwaysDirectForCrisis: true,
  requireProtectionCheck: true,
  enableHealthBasedRouting: true,
  enableLatencyBudgets: true,
  enableDegradationModes: true,
};

/**
 * Core policy rules in priority order
 */
const POLICY_RULES: PolicyRule[] = [
  // Rule 1: Crisis override - HIGHEST PRIORITY
  {
    name: 'crisis_override',
    priority: 100,
    condition: (ctx) => ctx.isCrisisDetected === true,
    decide: (_ctx, _classification) => ({
      action: 'direct',
      targetTool: 'conversation', // Always route crisis to conversation tool
      reason: 'Crisis detected - immediate routing required',
      confidence: 1.0,
      maxRetries: 0,
      timeoutMs: 10000, // Extended timeout for crisis
      requireVerification: false,
    }),
  },

  // Rule 2: High-confidence direct execution
  {
    name: 'high_confidence_direct',
    priority: 90,
    condition: (_ctx, classification, health) => {
      if (classification.confidence < 0.90) return false;
      if (classification.multiIntent) return false;

      // Map intent to tool name
      const toolName = mapIntentToTool(classification.primaryIntent);
      const toolHealth = health.get(toolName);

      return (
        toolHealth?.status === 'healthy' &&
        (toolHealth.rollingSuccessRate ?? 0) >= 0.95 &&
        toolHealth.circuitBreakerState === 'closed'
      );
    },
    decide: (_ctx, classification) => ({
      action: 'direct',
      targetTool: mapIntentToTool(classification.primaryIntent),
      reason: `High confidence (${classification.confidence.toFixed(2)}) and healthy tool`,
      confidence: classification.confidence,
      maxRetries: 1,
      timeoutMs: getTimeoutForIntent(classification.primaryIntent),
    }),
  },

  // Rule 3: Multi-intent decomposition
  {
    name: 'multi_intent_decomposition',
    priority: 80,
    condition: (_ctx, classification) => classification.multiIntent === true,
    decide: (_ctx, classification) => ({
      action: 'router',
      reason: `Multiple intents detected: ${classification.decomposition?.join(', ')}`,
      confidence: classification.confidence,
      allowParallel: true,
      timeoutMs: 8000, // Extended timeout for multi-intent
    }),
  },

  // Rule 4: Health-aware rerouting
  {
    name: 'health_aware_reroute',
    priority: 70,
    condition: (_ctx, classification, health) => {
      const toolName = mapIntentToTool(classification.primaryIntent);
      const toolHealth = health.get(toolName);
      return (
        toolHealth?.status === 'unhealthy' ||
        toolHealth?.circuitBreakerState === 'open'
      );
    },
    decide: (_ctx, classification) => {
      const fallbacks = getFallbackTools(classification.primaryIntent);
      if (fallbacks.length > 0) {
        return {
          action: 'fallback',
          targetTool: fallbacks[0],
          fallbackTools: fallbacks.slice(1),
          reason: 'Primary tool unhealthy - using fallback',
          confidence: classification.confidence * 0.8, // Reduced confidence for fallback
          maxRetries: 0,
          timeoutMs: getTimeoutForIntent(classification.primaryIntent),
        };
      }
      return {
        action: 'degrade',
        reason: 'Primary tool unhealthy and no fallback available',
        confidence: classification.confidence * 0.5,
        degradationMode: 'partial',
      };
    },
  },

  // Rule 5: Ambiguous intent routing
  {
    name: 'ambiguous_routing',
    priority: 60,
    condition: (_ctx, classification) => classification.ambiguous === true,
    decide: (_ctx, classification) => ({
      action: 'router',
      reason: `Ambiguous intent - top alternatives: ${classification.alternatives
        .slice(0, 2)
        .map(a => `${a.intent}(${a.confidence.toFixed(2)})`)
        .join(', ')}`,
      confidence: classification.confidence,
      maxRetries: 1,
      timeoutMs: 5000,
    }),
  },

  // Rule 6: Medium confidence with healthy tool
  {
    name: 'medium_confidence_direct',
    priority: 50,
    condition: (_ctx, classification, health) => {
      if (classification.confidence < 0.75 || classification.confidence >= 0.90) return false;

      const toolName = mapIntentToTool(classification.primaryIntent);
      const toolHealth = health.get(toolName);

      return (
        toolHealth?.status !== 'unhealthy' &&
        (toolHealth?.rollingSuccessRate ?? 0) >= 0.90
      );
    },
    decide: (_ctx, classification) => ({
      action: 'direct',
      targetTool: mapIntentToTool(classification.primaryIntent),
      reason: `Medium confidence (${classification.confidence.toFixed(2)}) with healthy tool`,
      confidence: classification.confidence,
      maxRetries: 1,
      timeoutMs: getTimeoutForIntent(classification.primaryIntent),
      requireVerification: true, // Require verification for medium confidence
    }),
  },

  // Rule 7: Low confidence or unknown
  {
    name: 'low_confidence_clarification',
    priority: 40,
    condition: (_ctx, classification) => classification.confidence < 0.55,
    decide: (_ctx, classification) => ({
      action: 'clarify',
      reason: `Low confidence (${classification.confidence.toFixed(2)}) - clarification needed`,
      confidence: classification.confidence,
    }),
  },

  // Rule 8: Safety override for protection
  {
    name: 'protection_required',
    priority: 95,
    condition: (ctx) => ctx.requiresProtection === true,
    decide: (_ctx, _classification) => ({
      action: 'direct',
      targetTool: 'protect',
      reason: 'Protection check required before operation',
      confidence: 1.0,
      maxRetries: 0,
      timeoutMs: 2000,
    }),
  },

  // Rule 9: Deadline-aware simplification
  {
    name: 'deadline_simplification',
    priority: 85,
    condition: (ctx, _classification, health) => {
      if (!ctx.latencyBudgetMs) return false;

      const toolName = mapIntentToTool(_classification.primaryIntent);
      const toolHealth = health.get(toolName);

      return Boolean(
        toolHealth?.p95LatencyMs &&
        toolHealth.p95LatencyMs > ctx.latencyBudgetMs
      );
    },
    decide: (ctx, classification) => ({
      action: 'degrade',
      reason: `Tool latency exceeds budget (${ctx.latencyBudgetMs}ms)`,
      confidence: classification.confidence,
      degradationMode: 'reduced',
      timeoutMs: ctx.latencyBudgetMs,
    }),
  },

  // Default rule - fallback to router
  {
    name: 'default_router',
    priority: 0,
    condition: () => true,
    decide: (_ctx, classification) => ({
      action: 'router',
      reason: 'No specific policy matched - using router',
      confidence: classification.confidence,
      maxRetries: 1,
      timeoutMs: 5000,
    }),
  },
];

/**
 * Map intent class to tool name
 */
function mapIntentToTool(intent: string): string {
  const mapping: Record<string, string> = {
    'session_control': 'conversation',
    'memory_control': 'remember',
    'verify': 'verify',
    'brainstorm': 'brainstorm',
    'package_audit': 'package_audit',
    'code_review': 'code_review',
    'status': 'status',
    'protect': 'protect',
    'conversation_ops': 'conversation',
    'unknown': 'couchloop',
  };
  return mapping[intent] || 'couchloop';
}

/**
 * Get fallback tools for an intent
 */
function getFallbackTools(intent: string): string[] {
  const fallbacks: Record<string, string[]> = {
    'verify': ['conversation'],
    'code_review': ['verify'],
    'package_audit': ['verify'],
    'brainstorm': ['conversation'],
  };
  return fallbacks[intent] || [];
}

/**
 * Get recommended timeout for an intent
 */
function getTimeoutForIntent(intent: string): number {
  const timeouts: Record<string, number> = {
    'status': 500,
    'protect': 500,
    'memory_control': 500,
    'verify': 1000,
    'code_review': 1500,
    'package_audit': 1500,
    'brainstorm': 2500,
    'session_control': 3000,
    'conversation_ops': 3000,
  };
  return timeouts[intent] || 5000;
}

/**
 * Main policy engine evaluation
 */
export class PolicyEngine {
  private config: PolicyConfig;
  private rules: PolicyRule[];

  constructor(config: Partial<PolicyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rules = [...POLICY_RULES].sort((a, b) => b.priority - a.priority);
  }

  /**
   * Evaluate classification and context to determine routing decision
   */
  evaluate(
    context: PolicyContext,
    classification: IntentResult,
    toolHealth: Map<string, ToolHealth>,
  ): PolicyDecision {
    // Apply rules in priority order
    for (const rule of this.rules) {
      if (rule.condition(context, classification, toolHealth)) {
        const decision = rule.decide(context, classification, toolHealth);

        // Log the decision for monitoring
        logger.debug('Policy decision', {
          requestId: context.requestId,
          traceId: context.traceId,
          rule: rule.name,
          action: decision.action,
          targetTool: decision.targetTool,
          reason: decision.reason,
          confidence: decision.confidence,
        });

        return decision;
      }
    }

    // This should never happen due to default rule, but just in case
    return {
      action: 'router',
      reason: 'No policy rule matched',
      confidence: 0,
    };
  }

  /**
   * Update policy configuration
   */
  updateConfig(config: Partial<PolicyConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Policy configuration updated', config);
  }

  /**
   * Add or update a policy rule
   */
  addRule(rule: PolicyRule): void {
    // Remove existing rule with same name if exists
    this.rules = this.rules.filter(r => r.name !== rule.name);
    // Add new rule and resort
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
    logger.info(`Policy rule '${rule.name}' added with priority ${rule.priority}`);
  }
}