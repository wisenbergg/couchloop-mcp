/**
 * Tool Registry
 *
 * Central registry for all MCP tools with metadata, health tracking,
 * and capability management. Replaces the flat tool list with a
 * rich metadata system.
 */

import { logger } from '../../utils/logger.js';
import type { ToolHealth } from '../policy/types.js';

export interface ToolMetadata {
  toolName: string;
  version: string;
  capabilities: string[];
  latencyProfile: {
    p50Ms: number;
    p95Ms: number;
    p99Ms?: number;
  };
  constraints: {
    idempotent: boolean;
    safeParallel: boolean;
    supportsCache: boolean;
    requiresAuth?: boolean;
    maxConcurrency?: number;
  };
  fallbacks?: string[];
  costWeight: number; // 0-1, higher = more expensive
  description?: string;
  category?: 'session' | 'memory' | 'verification' | 'development' | 'protection' | 'conversation';
}

export interface ToolHandler {
  (args: Record<string, unknown>): Promise<unknown>;
}

export interface RegisteredTool {
  metadata: ToolMetadata;
  handler: ToolHandler;
  health: ToolHealth;
}

/**
 * Tool Registry singleton
 */
export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, RegisteredTool>;
  private healthMetrics: Map<string, {
    totalCalls: number;
    successCalls: number;
    timeoutCalls: number;
    errorCalls: number;
    latencies: number[];
    lastUpdated: number;
  }>;

  private constructor() {
    this.tools = new Map();
    this.healthMetrics = new Map();
    this.startHealthMonitoring();
  }

  static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /**
   * Register a new tool
   */
  register(
    metadata: ToolMetadata,
    handler: ToolHandler,
  ): void {
    const existing = this.tools.get(metadata.toolName);
    // Only block re-registration if the existing entry already has a real handler
    // (i.e. not a placeholder). Placeholders are identified by their name containing
    // 'not yet implemented'. This allows setupTools() to replace placeholder handlers
    // with real ones without being blocked by the version guard.
    const isPlaceholder = existing && (
      existing.handler.toString().includes('not yet implemented') ||
      existing.handler.name === 'handler'
    );
    if (existing && !isPlaceholder && existing.metadata.version >= metadata.version) {
      logger.warn(`Tool ${metadata.toolName} already registered with same or newer version`);
      return;
    }

    this.tools.set(metadata.toolName, {
      metadata,
      handler,
      health: this.initializeHealth(metadata.toolName),
    });

    this.healthMetrics.set(metadata.toolName, {
      totalCalls: 0,
      successCalls: 0,
      timeoutCalls: 0,
      errorCalls: 0,
      latencies: [],
      lastUpdated: Date.now(),
    });

    logger.info(`Registered tool: ${metadata.toolName} v${metadata.version}`, {
      capabilities: metadata.capabilities,
      category: metadata.category,
    });
  }

  /**
   * Get a registered tool
   */
  getTool(toolName: string): RegisteredTool | undefined {
    return this.tools.get(toolName);
  }

  /**
   * Get all registered tools
   */
  getAllTools(): Map<string, RegisteredTool> {
    return new Map(this.tools);
  }

  /**
   * Get tools by capability
   */
  getToolsByCapability(capability: string): RegisteredTool[] {
    return Array.from(this.tools.values()).filter(tool =>
      tool.metadata.capabilities.includes(capability)
    );
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category: string): RegisteredTool[] {
    return Array.from(this.tools.values()).filter(tool =>
      tool.metadata.category === category
    );
  }

  /**
   * Update tool health metrics
   */
  recordToolExecution(
    toolName: string,
    result: 'success' | 'timeout' | 'error',
    latencyMs: number,
  ): void {
    const metrics = this.healthMetrics.get(toolName);
    if (!metrics) return;

    metrics.totalCalls++;
    if (result === 'success') metrics.successCalls++;
    else if (result === 'timeout') metrics.timeoutCalls++;
    else metrics.errorCalls++;

    // Keep last 100 latencies for percentile calculation
    metrics.latencies.push(latencyMs);
    if (metrics.latencies.length > 100) {
      metrics.latencies.shift();
    }
    metrics.lastUpdated = Date.now();

    // Update tool health
    const tool = this.tools.get(toolName);
    if (tool) {
      tool.health = this.calculateHealth(toolName, metrics);
    }
  }

  /**
   * Get health map for policy engine
   */
  getHealthMap(): Map<string, ToolHealth> {
    const healthMap = new Map<string, ToolHealth>();
    this.tools.forEach((tool, name) => {
      healthMap.set(name, tool.health);
    });
    return healthMap;
  }

  /**
   * Initialize health for a new tool
   */
  private initializeHealth(toolName: string): ToolHealth {
    return {
      toolName,
      status: 'healthy',
      rollingSuccessRate: 1.0,
      rollingTimeoutRate: 0,
      circuitBreakerState: 'closed',
      averageLatencyMs: 0,
      p95LatencyMs: 0,
    };
  }

  /**
   * Calculate tool health from metrics
   */
  private calculateHealth(
    toolName: string,
    metrics: any // Type from healthMetrics map
  ): ToolHealth {
    const successRate = metrics.totalCalls > 0 ?
      metrics.successCalls / metrics.totalCalls : 1.0;
    const timeoutRate = metrics.totalCalls > 0 ?
      metrics.timeoutCalls / metrics.totalCalls : 0;

    // Calculate latency percentiles
    const sortedLatencies = [...metrics.latencies].sort((a, b) => a - b);
    const p95Index = Math.floor(sortedLatencies.length * 0.95);
    const p95Latency = sortedLatencies[p95Index] || 0;
    const avgLatency = sortedLatencies.length > 0 ?
      sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length : 0;

    // Determine health status
    let status: ToolHealth['status'] = 'healthy';
    if (successRate < 0.8 || timeoutRate > 0.2) {
      status = 'unhealthy';
    } else if (successRate < 0.95 || timeoutRate > 0.05) {
      status = 'degraded';
    }

    // Simple circuit breaker logic
    let circuitBreakerState: ToolHealth['circuitBreakerState'] = 'closed';
    if (metrics.totalCalls >= 5) {
      const recentErrors = metrics.totalCalls - metrics.successCalls;
      if (recentErrors >= 5 || (recentErrors / metrics.totalCalls) > 0.5) {
        circuitBreakerState = 'open';
      }
    }

    return {
      toolName,
      status,
      rollingSuccessRate: successRate,
      rollingTimeoutRate: timeoutRate,
      circuitBreakerState,
      averageLatencyMs: Math.round(avgLatency),
      p95LatencyMs: Math.round(p95Latency),
    };
  }

  /**
   * Start background health monitoring
   */
  private startHealthMonitoring(): void {
    // Reset rolling metrics every 30 minutes
    setInterval(() => {
      const now = Date.now();
      this.healthMetrics.forEach((metrics) => {
        if (now - metrics.lastUpdated > 30 * 60 * 1000) {
          // Reset old metrics
          metrics.totalCalls = Math.floor(metrics.totalCalls * 0.5); // Decay old calls
          metrics.successCalls = Math.floor(metrics.successCalls * 0.5);
          metrics.timeoutCalls = Math.floor(metrics.timeoutCalls * 0.5);
          metrics.errorCalls = Math.floor(metrics.errorCalls * 0.5);
          metrics.lastUpdated = now;
        }
      });
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  /**
   * Export registry metadata for introspection
   */
  exportMetadata(): Record<string, any> {
    const metadata: Record<string, any> = {};
    this.tools.forEach((tool, name) => {
      metadata[name] = {
        ...tool.metadata,
        health: tool.health,
      };
    });
    return metadata;
  }
}

/**
 * Pre-populate registry with tool metadata only.
 * Handlers are registered separately by setupTools() once they are
 * fully initialised and policy-wrapped. Keeping metadata and handlers
 * separate avoids the placeholder-handler problem where the version guard
 * blocks real handler registration.
 */
export function initializeToolRegistry(): void {
  const registry = ToolRegistry.getInstance();

  // Register core tools with metadata
  const toolDefinitions: ToolMetadata[] = [
    {
      toolName: 'conversation',
      version: '2.0.0',
      capabilities: ['session_management', 'crisis_detection', 'memory', 'journeys'],
      latencyProfile: { p50Ms: 1500, p95Ms: 3000 },
      constraints: {
        idempotent: false,
        safeParallel: false,
        supportsCache: false,
        requiresAuth: true,
      },
      costWeight: 0.7,
      category: 'conversation',
    },
    {
      toolName: 'brainstorm',
      version: '2.0.0',
      capabilities: ['ideation', 'architecture_design', 'reflection'],
      latencyProfile: { p50Ms: 1000, p95Ms: 2500 },
      constraints: {
        idempotent: false,
        safeParallel: true,
        supportsCache: false,
      },
      costWeight: 0.6,
      category: 'development',
    },
    {
      toolName: 'verify',
      version: '2.0.0',
      capabilities: ['package_validation', 'code_validation', 'hallucination_detection'],
      latencyProfile: { p50Ms: 600, p95Ms: 1000 },
      constraints: {
        idempotent: true,
        safeParallel: true,
        supportsCache: true,
      },
      fallbacks: ['conversation'],
      costWeight: 0.3,
      category: 'verification',
    },
    {
      toolName: 'status',
      version: '2.0.0',
      capabilities: ['dashboard', 'progress_tracking', 'context_display'],
      latencyProfile: { p50Ms: 200, p95Ms: 500 },
      constraints: {
        idempotent: true,
        safeParallel: true,
        supportsCache: true,
      },
      costWeight: 0.1,
      category: 'session',
    },
    {
      toolName: 'code_review',
      version: '2.0.0',
      capabilities: ['security_scan', 'quality_check', 'ai_error_detection'],
      latencyProfile: { p50Ms: 800, p95Ms: 1500 },
      constraints: {
        idempotent: true,
        safeParallel: true,
        supportsCache: true,
      },
      fallbacks: ['verify'],
      costWeight: 0.4,
      category: 'development',
    },
    {
      toolName: 'package_audit',
      version: '2.0.0',
      capabilities: ['dependency_validation', 'vulnerability_scan', 'version_check'],
      latencyProfile: { p50Ms: 800, p95Ms: 1500 },
      constraints: {
        idempotent: true,
        safeParallel: true,
        supportsCache: true,
      },
      fallbacks: ['verify'],
      costWeight: 0.4,
      category: 'development',
    },
    {
      toolName: 'remember',
      version: '2.0.0',
      capabilities: ['checkpoint_save', 'context_storage', 'insight_capture'],
      latencyProfile: { p50Ms: 300, p95Ms: 500 },
      constraints: {
        idempotent: false,
        safeParallel: false,
        supportsCache: false,
      },
      costWeight: 0.2,
      category: 'memory',
    },
    {
      toolName: 'protect',
      version: '2.0.0',
      capabilities: ['backup', 'rollback', 'code_freeze', 'safety_check'],
      latencyProfile: { p50Ms: 300, p95Ms: 500 },
      constraints: {
        idempotent: false,
        safeParallel: false,
        supportsCache: false,
      },
      costWeight: 0.2,
      category: 'protection',
    },
    {
      toolName: 'couchloop_router',
      version: '2.0.0',
      capabilities: ['intent_resolution', 'ambiguity_handling', 'multi_intent'],
      latencyProfile: { p50Ms: 500, p95Ms: 800 },
      constraints: {
        idempotent: true,
        safeParallel: false,
        supportsCache: false,
      },
      costWeight: 0.5,
      category: 'session',
    },
  ];

  // Note: handlers will be registered when we refactor the existing tools
  // For now, just register metadata
  toolDefinitions.forEach(metadata => {
    registry.register(metadata, async () => {
      // Placeholder handler - will be replaced with actual implementations
      return { message: `${metadata.toolName} handler not yet implemented` };
    });
  });

  logger.info(`Tool registry initialized with ${toolDefinitions.length} tools`);
}