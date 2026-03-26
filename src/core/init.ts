/**
 * V2 Orchestration Initialization
 *
 * Initializes tracing and tool registry.
 * Feature flags removed — all V2 features are permanently enabled.
 */

import { logger } from '../utils/logger.js';
import { initializeTracing, shutdownTracing } from './telemetry/tracing.js';
import { initializeToolRegistry } from './registry/registry.js';

/**
 * Initialize V2 orchestration system
 */
export async function initializeV2Orchestration(): Promise<void> {
  logger.info('Initializing orchestration system');

  // Initialize OpenTelemetry tracing
  try {
    initializeTracing({
      serviceName: 'mcp-orchestrator-v2',
      serviceVersion: '2.1.0',
      enableConsoleExporter: process.env.NODE_ENV === 'development',
      exporterUrl: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    });
    logger.info('OpenTelemetry tracing initialized');
  } catch (error) {
    logger.warn('OpenTelemetry initialization failed (non-critical)', error);
  }

  // Initialize tool registry with health tracking
  try {
    initializeToolRegistry();
    logger.info('Tool registry initialized');
  } catch (error) {
    logger.error('Failed to initialize tool registry', error);
    throw error;
  }

  logger.info('Orchestration system initialized');
}

/**
 * Shutdown orchestration system gracefully
 */
export async function shutdownV2Orchestration(): Promise<void> {
  logger.info('Shutting down orchestration system');

  try {
    await shutdownTracing();
    logger.info('Telemetry shutdown complete');
  } catch (error) {
    logger.warn('Error during telemetry shutdown', error);
  }
}