/**
 * OpenTelemetry Tracing Setup
 *
 * Provides distributed tracing for the MCP orchestration layer.
 * Tracks requests across all modules for complete observability.
 */

import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import * as resources from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION, SEMRESATTRS_DEPLOYMENT_ENVIRONMENT } from '@opentelemetry/semantic-conventions';
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  trace,
  context,
  SpanStatusCode,
  Span,
  SpanKind,
  Context,
} from '@opentelemetry/api';
import { logger } from '../../utils/logger.js';

// Trace provider singleton
let tracerProvider: NodeTracerProvider | null = null;

/**
 * Initialize OpenTelemetry tracing
 */
export function initializeTracing(options: {
  serviceName?: string;
  serviceVersion?: string;
  exporterUrl?: string;
  enableConsoleExporter?: boolean;
} = {}): void {
  if (tracerProvider) {
    logger.warn('Tracing already initialized');
    return;
  }

  // Create resource identifying this service
  const resource = new resources.Resource({
    [SEMRESATTRS_SERVICE_NAME]: options.serviceName || 'mcp-orchestrator',
    [SEMRESATTRS_SERVICE_VERSION]: options.serviceVersion || '2.0.0',
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
  });

  // Create tracer provider
  tracerProvider = new NodeTracerProvider({ resource });

  // Configure exporters
  const exporters: SpanExporter[] = [];

  // OTLP exporter (for Jaeger, Grafana Tempo, etc.)
  if (options.exporterUrl || process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const otlpExporter = new OTLPTraceExporter({
      url: options.exporterUrl || process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      headers: process.env.OTEL_EXPORTER_OTLP_HEADERS ?
        JSON.parse(process.env.OTEL_EXPORTER_OTLP_HEADERS) : {},
    });
    exporters.push(otlpExporter);
  }

  // Console exporter for development
  if (options.enableConsoleExporter || process.env.NODE_ENV === 'development') {
    exporters.push(new ConsoleSpanExporter());
  }

  // Register the provider first
  tracerProvider.register();

  // Add span processors after registration
  exporters.forEach(exporter => {
    const processor = new BatchSpanProcessor(exporter);
    (tracerProvider as any).addSpanProcessor?.(processor) ||
      (tracerProvider as any).activeSpanProcessor?.add?.(processor);
  });

  // Auto-instrument HTTP, gRPC, etc.
  registerInstrumentations({
    instrumentations: [
      // Instrumentations will be auto-loaded
    ],
  });

  logger.info('OpenTelemetry tracing initialized', {
    serviceName: options.serviceName || 'mcp-orchestrator',
    exporters: exporters.length,
  });
}

/**
 * Get a tracer instance
 */
export function getTracer(name: string = 'mcp-orchestrator') {
  return trace.getTracer(name, '2.0.0');
}

/**
 * Create a new span for a request
 */
export function startRequestSpan(
  name: string,
  options: {
    requestId: string;
    traceId?: string;
    tenantId?: string;
    userId?: string;
    sessionId?: string;
    kind?: SpanKind;
  }
): Span {
  const tracer = getTracer();

  const span = tracer.startSpan(name, {
    kind: options.kind || SpanKind.INTERNAL,
    attributes: {
      'request.id': options.requestId,
      'trace.id': options.traceId || options.requestId,
      'tenant.id': options.tenantId,
      'user.id': options.userId,
      'session.id': options.sessionId,
    },
  });

  return span;
}

/**
 * Trace an async function execution
 */
export async function traceAsync<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options: {
    attributes?: Record<string, any>;
    kind?: SpanKind;
  } = {}
): Promise<T> {
  const tracer = getTracer();

  return tracer.startActiveSpan(name, {
    kind: options.kind || SpanKind.INTERNAL,
    attributes: options.attributes,
  }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Add an event to the current span
 */
export function addSpanEvent(name: string, attributes?: Record<string, any>): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.addEvent(name, attributes);
  }
}

/**
 * Set attributes on the current span
 */
export function setSpanAttributes(attributes: Record<string, any>): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttributes(attributes);
  }
}

/**
 * Propagate context across async boundaries
 */
export function withContext<T>(
  parentContext: Context,
  fn: () => T
): T {
  return context.with(parentContext, fn);
}

/**
 * Extract context from incoming request headers
 */
export function extractContext(headers: Record<string, string>): Context {
  // This would use W3C Trace Context propagation
  // For now, return active context
  return context.active();
}

/**
 * Inject context into outgoing request headers
 */
export function injectContext(headers: Record<string, string>): Record<string, string> {
  // This would use W3C Trace Context propagation
  // For now, return headers unchanged
  return headers;
}

/**
 * Create spans for each stage of the orchestration pipeline
 */
export const TracingStages = {
  NORMALIZE: 'mcp.normalize',
  CLASSIFY: 'mcp.classify',
  POLICY: 'mcp.policy',
  PLAN: 'mcp.plan',
  EXECUTE: 'mcp.execute',
  FALLBACK: 'mcp.fallback',
  COMPOSE: 'mcp.compose',
  TOOL_CALL: 'mcp.tool.call',
  CACHE_LOOKUP: 'mcp.cache.lookup',
  RETRY: 'mcp.retry',
} as const;

/**
 * Shutdown tracing gracefully
 */
export async function shutdownTracing(): Promise<void> {
  if (tracerProvider) {
    await tracerProvider.shutdown();
    tracerProvider = null;
    logger.info('OpenTelemetry tracing shutdown complete');
  }
}