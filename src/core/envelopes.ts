/**
 * Standard Request/Response Envelopes
 *
 * Unified envelope format for all tool requests and responses.
 * Replaces ad-hoc tool interfaces with standardized contracts.
 */

import type { IntentResult } from './intent/types.js';

/**
 * Standard request envelope for all tool invocations
 */
export interface StandardRequest<TInput = unknown> {
  // Identification
  requestId: string;
  timestampUtc: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId: string;

  // Intent classification (if routed through classifier)
  intent?: {
    name: string;
    confidence: number;
    alternatives: Array<{
      name: string;
      confidence: number;
    }>;
  };

  // Actual input data
  input: TInput;

  // Policy directives
  policy: {
    deadlineMs: number;
    allowParallel: boolean;
    allowFallback: boolean;
    maxRetries: number;
    degradeOnTimeout: boolean;
  };

  // Execution metadata
  execution: {
    priority: 'low' | 'normal' | 'urgent' | 'admin';
    origin: 'client_direct' | 'router' | 'fallback';
    plannerVersion: string;
  };
}

/**
 * Standard response envelope for all tool outputs
 */
export interface StandardResponse<TOutput = unknown> {
  // Request tracking
  requestId: string;
  traceId: string;
  toolName: string;

  // Execution status
  status: 'success' | 'partial' | 'timeout' | 'failed' | 'rejected';
  latencyMs: number;

  // Cache information
  cache: {
    hit: boolean;
    key?: string;
  };

  // Retry information
  retries: number;

  // Actual result
  result?: {
    summary?: string;
    data: TOutput;
    warnings?: string[];
  };

  // Fallback information
  fallback?: {
    used: boolean;
    strategy?: string;
  };

  // Observability metadata
  observability: {
    toolVersion: string;
    host: string;
    queueWaitMs: number;
  };

  // Error information
  error?: StandardError;
}

/**
 * Standard error schema
 */
export interface StandardError {
  code: string;
  message: string;
  retryable: boolean;
  category: 'validation' | 'timeout' | 'auth' | 'rate_limit' | 'internal' | 'upstream';
  details?: Record<string, unknown>;
}

/**
 * Helper to create a standard request envelope
 */
export function createStandardRequest<T>(
  input: T,
  options: {
    requestId: string;
    traceId: string;
    tenantId?: string;
    userId?: string;
    sessionId?: string;
    priority?: 'low' | 'normal' | 'urgent' | 'admin';
    deadlineMs?: number;
    origin?: 'client_direct' | 'router' | 'fallback';
    intent?: IntentResult;
  }
): StandardRequest<T> {
  return {
    requestId: options.requestId,
    timestampUtc: new Date().toISOString(),
    tenantId: options.tenantId,
    userId: options.userId,
    sessionId: options.sessionId,
    traceId: options.traceId,
    intent: options.intent ? {
      name: options.intent.primaryIntent,
      confidence: options.intent.confidence,
      alternatives: options.intent.alternatives.map(a => ({
        name: a.intent,
        confidence: a.confidence,
      })),
    } : undefined,
    input,
    policy: {
      deadlineMs: options.deadlineMs || 5000,
      allowParallel: true,
      allowFallback: true,
      maxRetries: 1,
      degradeOnTimeout: true,
    },
    execution: {
      priority: options.priority || 'normal',
      origin: options.origin || 'client_direct',
      plannerVersion: 'v2.0.0',
    },
  };
}

/**
 * Helper to create a standard response envelope
 */
export function createStandardResponse<T>(
  request: StandardRequest,
  result: T | undefined,
  options: {
    toolName: string;
    status: 'success' | 'partial' | 'timeout' | 'failed' | 'rejected';
    latencyMs: number;
    cacheHit?: boolean;
    retries?: number;
    error?: StandardError;
    warnings?: string[];
    fallbackUsed?: boolean;
    queueWaitMs?: number;
  }
): StandardResponse<T> {
  return {
    requestId: request.requestId,
    traceId: request.traceId,
    toolName: options.toolName,
    status: options.status,
    latencyMs: options.latencyMs,
    cache: {
      hit: options.cacheHit || false,
    },
    retries: options.retries || 0,
    result: result ? {
      data: result,
      warnings: options.warnings,
    } : undefined,
    fallback: options.fallbackUsed ? {
      used: true,
      strategy: 'primary_timeout',
    } : undefined,
    observability: {
      toolVersion: '2.0.0',
      host: process.env.HOSTNAME || 'mcp-node-1',
      queueWaitMs: options.queueWaitMs || 0,
    },
    error: options.error,
  };
}

/**
 * Helper to create a standard error
 */
export function createStandardError(
  code: string,
  message: string,
  options: {
    retryable?: boolean;
    category?: StandardError['category'];
    details?: Record<string, unknown>;
  } = {}
): StandardError {
  return {
    code,
    message,
    retryable: options.retryable ?? false,
    category: options.category ?? 'internal',
    details: options.details,
  };
}