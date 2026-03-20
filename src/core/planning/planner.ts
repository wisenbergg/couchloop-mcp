/**
 * Execution Planner
 *
 * Transforms routing decisions into executable DAGs.
 * Identifies parallelizable operations and manages dependencies.
 */

import { logger } from '../../utils/logger.js';
import type { IntentResult } from '../intent/types.js';
import type { PolicyDecision } from '../policy/types.js';

export type PlanType = 'single' | 'fanout' | 'chain' | 'hybrid_dag';

export interface PlanNode {
  nodeId: string;
  tool: string;
  dependsOn: string[];
  deadlineMs: number;
  retryPolicy: 'none' | 'fast_retry' | 'standard' | 'resilient';
  optional?: boolean;
  input?: Record<string, unknown>;
}

export interface ExecutionPlan {
  planId: string;
  planType: PlanType;
  nodes: PlanNode[];
  globalDeadlineMs: number;
  fallbacks: Record<string, string[]>; // nodeId -> fallback tool names
}

export interface PlannerConfig {
  maxParallelNodes: number;     // Default: 4
  plannerOverheadMs: number;    // Default: 300
  compositionBudgetMs: number;  // Default: 400
  enableOptimization: boolean;  // Default: true
}

const DEFAULT_CONFIG: PlannerConfig = {
  maxParallelNodes: 4,
  plannerOverheadMs: 300,
  compositionBudgetMs: 400,
  enableOptimization: true,
};

/**
 * Main execution planner class
 */
export class ExecutionPlanner {
  private config: PlannerConfig;

  constructor(config: Partial<PlannerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create an execution plan from intent and policy decision
   */
  createPlan(
    intent: IntentResult,
    decision: PolicyDecision,
    globalDeadlineMs: number = 5000,
  ): ExecutionPlan {
    const planId = this.generatePlanId();

    // Handle multi-intent decomposition
    if (intent.multiIntent && intent.decomposition) {
      return this.createMultiIntentPlan(
        planId,
        intent.decomposition,
        decision,
        globalDeadlineMs,
      );
    }

    // Handle single intent based on decision action
    switch (decision.action) {
      case 'direct':
        if (!decision.targetTool) {
          throw new Error('Direct routing requires a target tool');
        }
        return this.createSingleNodePlan(
          planId,
          decision.targetTool,
          decision,
          globalDeadlineMs,
        );

      case 'fallback':
        if (!decision.targetTool) {
          throw new Error('Fallback routing requires a target tool');
        }
        return this.createFallbackChainPlan(
          planId,
          decision.targetTool,
          decision.fallbackTools || [],
          globalDeadlineMs,
        );

      case 'router':
        // Router itself becomes a single node in the plan
        return this.createSingleNodePlan(
          planId,
          'couchloop_router',
          decision,
          globalDeadlineMs,
        );

      case 'degrade':
        return this.createDegradedPlan(
          planId,
          intent.primaryIntent,
          decision,
          globalDeadlineMs,
        );

      default:
        // Clarification or rejection - minimal plan
        return {
          planId,
          planType: 'single',
          nodes: [],
          globalDeadlineMs,
          fallbacks: {},
        };
    }
  }

  /**
   * Create a simple single-node plan
   */
  private createSingleNodePlan(
    planId: string,
    tool: string,
    decision: PolicyDecision,
    globalDeadlineMs: number,
  ): ExecutionPlan {
    const executionBudget = this.calculateExecutionBudget(globalDeadlineMs);

    return {
      planId,
      planType: 'single',
      nodes: [{
        nodeId: 'n1',
        tool,
        dependsOn: [],
        deadlineMs: decision.timeoutMs || executionBudget,
        retryPolicy: this.determineRetryPolicy(decision.maxRetries || 0),
      }],
      globalDeadlineMs,
      fallbacks: decision.fallbackTools ? {
        'n1': decision.fallbackTools,
      } : {},
    };
  }

  /**
   * Create a multi-intent parallel execution plan
   */
  private createMultiIntentPlan(
    planId: string,
    intents: string[],
    decision: PolicyDecision,
    globalDeadlineMs: number,
  ): ExecutionPlan {
    const executionBudget = this.calculateExecutionBudget(globalDeadlineMs);
    const perNodeBudget = Math.floor(executionBudget / Math.min(intents.length, this.config.maxParallelNodes));

    // Create parallel nodes for each intent
    const nodes: PlanNode[] = intents.slice(0, this.config.maxParallelNodes).map((intent, idx) => ({
      nodeId: `n${idx + 1}`,
      tool: this.mapIntentToTool(intent),
      dependsOn: [],
      deadlineMs: perNodeBudget,
      retryPolicy: 'standard',
    }));

    // If there are more intents than max parallel, chain them
    if (intents.length > this.config.maxParallelNodes) {
      for (let i = this.config.maxParallelNodes; i < intents.length; i++) {
        nodes.push({
          nodeId: `n${i + 1}`,
          tool: this.mapIntentToTool(intents[i]),
          dependsOn: [`n${i - this.config.maxParallelNodes + 1}`],
          deadlineMs: perNodeBudget,
          retryPolicy: 'standard',
        });
      }
    }

    // Add composition node if multiple results
    if (nodes.length > 1) {
      const leafNodes = nodes.filter(n =>
        !nodes.some(other => other.dependsOn.includes(n.nodeId))
      );
      nodes.push({
        nodeId: `n${nodes.length + 1}`,
        tool: 'conversation_ops',
        dependsOn: leafNodes.map(n => n.nodeId),
        deadlineMs: this.config.compositionBudgetMs,
        retryPolicy: 'none',
      });
    }

    return {
      planId,
      planType: nodes.length === 1 ? 'single' :
               nodes.every(n => n.dependsOn.length === 0) ? 'fanout' : 'hybrid_dag',
      nodes,
      globalDeadlineMs,
      fallbacks: {},
    };
  }

  /**
   * Create a fallback chain plan
   */
  private createFallbackChainPlan(
    planId: string,
    primaryTool: string,
    fallbackTools: string[],
    globalDeadlineMs: number,
  ): ExecutionPlan {
    const executionBudget = this.calculateExecutionBudget(globalDeadlineMs);

    // Primary node with fallbacks configured
    const primaryNode: PlanNode = {
      nodeId: 'n1',
      tool: primaryTool,
      dependsOn: [],
      deadlineMs: Math.floor(executionBudget * 0.7), // 70% for primary
      retryPolicy: 'fast_retry',
    };

    return {
      planId,
      planType: 'single',
      nodes: [primaryNode],
      globalDeadlineMs,
      fallbacks: {
        'n1': fallbackTools,
      },
    };
  }

  /**
   * Create a degraded execution plan
   */
  private createDegradedPlan(
    planId: string,
    intent: string,
    decision: PolicyDecision,
    globalDeadlineMs: number,
  ): ExecutionPlan {
    const executionBudget = this.calculateExecutionBudget(globalDeadlineMs);

    // Simplified plan for degraded mode
    const nodes: PlanNode[] = [];

    if (decision.degradationMode === 'partial') {
      // Execute only critical part
      nodes.push({
        nodeId: 'n1',
        tool: this.mapIntentToTool(intent),
        dependsOn: [],
        deadlineMs: executionBudget,
        retryPolicy: 'none',
        optional: false,
      });
    } else if (decision.degradationMode === 'stale') {
      // Use cache-only mode (special node type)
      nodes.push({
        nodeId: 'n1',
        tool: 'cache_lookup',
        dependsOn: [],
        deadlineMs: 100, // Very fast cache lookup
        retryPolicy: 'none',
        input: { intent, staleAllowed: true },
      });
    }

    return {
      planId,
      planType: 'single',
      nodes,
      globalDeadlineMs,
      fallbacks: {},
    };
  }

  /**
   * Optimize an execution plan for better performance
   */
  optimizePlan(plan: ExecutionPlan): ExecutionPlan {
    if (!this.config.enableOptimization) return plan;

    const optimized = { ...plan };

    // Optimization 1: Identify and merge redundant nodes
    optimized.nodes = this.mergeRedundantNodes(plan.nodes);

    // Optimization 2: Reorder independent nodes by expected latency
    optimized.nodes = this.reorderByLatency(optimized.nodes);

    // Optimization 3: Adjust deadlines based on criticality
    optimized.nodes = this.adjustDeadlines(optimized.nodes, plan.globalDeadlineMs);

    logger.debug('Plan optimized', {
      planId: plan.planId,
      originalNodes: plan.nodes.length,
      optimizedNodes: optimized.nodes.length,
    });

    return optimized;
  }

  // Helper methods

  private generatePlanId(): string {
    return `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateExecutionBudget(globalDeadlineMs: number): number {
    return Math.max(
      100, // Minimum execution time
      globalDeadlineMs - this.config.plannerOverheadMs - this.config.compositionBudgetMs
    );
  }

  private determineRetryPolicy(maxRetries: number): PlanNode['retryPolicy'] {
    if (maxRetries === 0) return 'none';
    if (maxRetries === 1) return 'standard';
    return 'resilient';
  }

  private mapIntentToTool(intent: string): string {
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
    };
    return mapping[intent] || 'couchloop_router';
  }

  private mergeRedundantNodes(nodes: PlanNode[]): PlanNode[] {
    // Simple deduplication based on tool and dependencies
    const seen = new Set<string>();
    return nodes.filter(node => {
      const key = `${node.tool}:${node.dependsOn.join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private reorderByLatency(nodes: PlanNode[]): PlanNode[] {
    // Reorder independent nodes to run faster ones first
    const independentNodes = nodes.filter(n => n.dependsOn.length === 0);
    const dependentNodes = nodes.filter(n => n.dependsOn.length > 0);

    // Sort independent nodes by expected latency (based on tool type)
    independentNodes.sort((a, b) =>
      this.getExpectedLatency(a.tool) - this.getExpectedLatency(b.tool)
    );

    return [...independentNodes, ...dependentNodes];
  }

  private getExpectedLatency(tool: string): number {
    const latencies: Record<string, number> = {
      'status': 300,
      'protect': 400,
      'cache_lookup': 50,
      'remember': 500,
      'verify': 800,
      'code_review': 1200,
      'package_audit': 1200,
      'brainstorm': 2000,
      'conversation': 2500,
      'couchloop_router': 800,
    };
    return latencies[tool] || 1000;
  }

  private adjustDeadlines(nodes: PlanNode[], globalDeadlineMs: number): PlanNode[] {
    // Dynamically adjust deadlines based on node criticality
    const totalExpectedLatency = nodes.reduce((sum, node) =>
      sum + this.getExpectedLatency(node.tool), 0
    );

    if (totalExpectedLatency <= globalDeadlineMs) {
      // We have enough time, no adjustment needed
      return nodes;
    }

    // Reduce timeouts proportionally
    const scaleFactor = globalDeadlineMs / totalExpectedLatency;
    return nodes.map(node => ({
      ...node,
      deadlineMs: Math.max(100, Math.floor(node.deadlineMs * scaleFactor)),
    }));
  }
}