/**
 * V2 Orchestration Initialization
 *
 * Initializes all V2 components with production settings.
 * This is the entry point for the new modular architecture.
 */

import { logger } from '../utils/logger.js';
import { initializeTracing, shutdownTracing } from './telemetry/tracing.js';
import { initializeToolRegistry } from './registry/registry.js';
import { featureFlags } from './feature-flags.js';

/**
 * Initialize V2 orchestration system
 */
export async function initializeV2Orchestration(): Promise<void> {
  logger.info('🚀 Initializing V2 Orchestration System');

  // Force V2 to 100% rollout
  featureFlags.updateRollout({
    v2: 100,              // 100% V2 traffic
    directRoute: 100,     // All high-confidence goes direct
    parallelExecution: 100, // Full parallel execution enabled
  });

  // Enable all V2 features
  featureFlags.setOverride('useV2Classifier', true);
  featureFlags.setOverride('useV2PolicyEngine', true);
  featureFlags.setOverride('useV2Planner', true);
  featureFlags.setOverride('useV2Executor', true);
  featureFlags.setOverride('useV2Telemetry', true);
  featureFlags.setOverride('directRouteEnabled', true);
  featureFlags.setOverride('multiIntentEnabled', true);
  featureFlags.setOverride('ambiguityDetectionEnabled', true);
  featureFlags.setOverride('parallelExecutionEnabled', true);
  featureFlags.setOverride('fallbackExecutionEnabled', true);
  featureFlags.setOverride('circuitBreakerEnabled', true);
  featureFlags.setOverride('cachingEnabled', true);
  featureFlags.setOverride('crisisOverrideEnabled', true);
  featureFlags.setOverride('protectionCheckEnabled', true);
  featureFlags.setOverride('degradationModesEnabled', true);

  logger.info('✅ Feature flags set for 100% V2 rollout');

  // Initialize OpenTelemetry tracing
  try {
    initializeTracing({
      serviceName: 'mcp-orchestrator-v2',
      serviceVersion: '2.0.0',
      enableConsoleExporter: process.env.NODE_ENV === 'development',
      exporterUrl: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    });
    logger.info('✅ OpenTelemetry tracing initialized');
  } catch (error) {
    logger.warn('OpenTelemetry initialization failed (non-critical)', error);
  }

  // Initialize tool registry with all tools
  try {
    initializeToolRegistry();
    logger.info('✅ Tool registry initialized with health tracking');
  } catch (error) {
    logger.error('Failed to initialize tool registry', error);
    throw error;
  }

  // Log V2 configuration
  logger.info('V2 Orchestration Configuration:', {
    rollout: '100%',
    directRouting: 'enabled',
    parallelExecution: 'enabled',
    circuitBreakers: 'enabled',
    caching: 'enabled',
    telemetry: 'enabled',
    features: featureFlags.getAllFlags(),
  });

  logger.info('🎉 V2 Orchestration System fully initialized at 100% rollout!');
}

/**
 * Shutdown V2 orchestration system gracefully
 */
export async function shutdownV2Orchestration(): Promise<void> {
  logger.info('Shutting down V2 Orchestration System...');

  try {
    await shutdownTracing();
    logger.info('✅ Telemetry shutdown complete');
  } catch (error) {
    logger.warn('Error during telemetry shutdown', error);
  }

  logger.info('V2 Orchestration System shutdown complete');
}

// Export feature flags for runtime adjustments
export { featureFlags };