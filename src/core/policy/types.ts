/**
 * Policy Engine Types
 *
 * Types for the policy engine that evaluates classification results
 * and determines routing strategy based on business rules.
 */

import type { IntentClass, IntentResult } from '../intent/types.js';

export interface PolicyContext {
  // Request context
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  requestId: string;
  traceId: string;

  // Performance context
  latencyBudgetMs?: number;
  priority?: 'low' | 'normal' | 'urgent' | 'admin';

  // Safety context
  isCrisisDetected?: boolean;
  requiresProtection?: boolean;
}

export interface ToolHealth {
  toolName: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  rollingSuccessRate: number; // Last 30 minutes
  rollingTimeoutRate: number;
  circuitBreakerState: 'closed' | 'open' | 'half-open';
  averageLatencyMs: number;
  p95LatencyMs: number;
}

export interface PolicyDecision {
  action: 'direct' | 'router' | 'fallback' | 'degrade' | 'reject' | 'clarify';
  targetTool?: string;
  fallbackTools?: string[];
  reason: string;
  confidence: number;
  maxRetries?: number;
  timeoutMs?: number;
  allowParallel?: boolean;
  requireVerification?: boolean;
  degradationMode?: 'partial' | 'stale' | 'reduced';
}

export interface PolicyRule {
  name: string;
  priority: number; // Higher priority rules are evaluated first
  condition: (context: PolicyContext, classification: IntentResult, health: Map<string, ToolHealth>) => boolean;
  decide: (context: PolicyContext, classification: IntentResult, health: Map<string, ToolHealth>) => PolicyDecision;
}

export interface PolicyConfig {
  // Health thresholds
  minToolHealthForDirectRoute: number; // Default: 0.95
  minToolHealthForAnyRoute: number;    // Default: 0.80

  // Timeout thresholds
  maxLatencyForDirectRouteMs: number;  // Default: 1000
  defaultTimeoutMs: number;            // Default: 5000

  // Safety overrides
  alwaysDirectForCrisis: boolean;      // Default: true
  requireProtectionCheck: boolean;     // Default: true

  // Feature flags
  enableHealthBasedRouting: boolean;
  enableLatencyBudgets: boolean;
  enableDegradationModes: boolean;
}