/**
 * Feature Flags Configuration
 *
 * Controls the gradual rollout of V2 orchestration features.
 * Allows for safe migration from monolithic couchloop to modular system.
 */

import { logger } from '../utils/logger.js';

export interface FeatureFlags {
  // Core V2 features
  useV2Classifier: boolean;
  useV2PolicyEngine: boolean;
  useV2Planner: boolean;
  useV2Executor: boolean;
  useV2Telemetry: boolean;

  // Routing features
  directRouteEnabled: boolean;
  multiIntentEnabled: boolean;
  ambiguityDetectionEnabled: boolean;

  // Execution features
  parallelExecutionEnabled: boolean;
  fallbackExecutionEnabled: boolean;
  circuitBreakerEnabled: boolean;

  // Performance features
  cachingEnabled: boolean;
  speculativeExecutionEnabled: boolean;
  adaptiveTimeoutsEnabled: boolean;

  // Safety features
  crisisOverrideEnabled: boolean;
  protectionCheckEnabled: boolean;
  degradationModesEnabled: boolean;

  // Rollout percentages (0-100)
  v2RolloutPercentage: number;
  directRoutePercentage: number;
  parallelExecutionPercentage: number;
}

/**
 * Default feature flag values
 */
const DEFAULT_FLAGS: FeatureFlags = {
  // Start with core features enabled
  useV2Classifier: true,
  useV2PolicyEngine: true,
  useV2Planner: true,
  useV2Executor: false, // Start with legacy executor
  useV2Telemetry: true,

  // Routing features
  directRouteEnabled: true,
  multiIntentEnabled: true,
  ambiguityDetectionEnabled: true,

  // Execution features - start conservative
  parallelExecutionEnabled: false,
  fallbackExecutionEnabled: true,
  circuitBreakerEnabled: true,

  // Performance features - start disabled
  cachingEnabled: false,
  speculativeExecutionEnabled: false,
  adaptiveTimeoutsEnabled: false,

  // Safety features - always enabled
  crisisOverrideEnabled: true,
  protectionCheckEnabled: true,
  degradationModesEnabled: true,

  // Gradual rollout percentages
  v2RolloutPercentage: 10, // Start with 10% of traffic
  directRoutePercentage: 50, // 50% of high-confidence can go direct
  parallelExecutionPercentage: 0, // Start with no parallel execution
};

/**
 * Feature flag manager singleton
 */
export class FeatureFlagManager {
  private static instance: FeatureFlagManager;
  private flags: FeatureFlags;
  private overrides: Map<string, any>;

  private constructor() {
    this.flags = this.loadFlags();
    this.overrides = new Map();
    this.startPeriodicRefresh();
  }

  static getInstance(): FeatureFlagManager {
    if (!FeatureFlagManager.instance) {
      FeatureFlagManager.instance = new FeatureFlagManager();
    }
    return FeatureFlagManager.instance;
  }

  /**
   * Load flags from environment variables and config
   */
  private loadFlags(): FeatureFlags {
    const flags: FeatureFlags = { ...DEFAULT_FLAGS };

    // Override from environment variables
    const envOverrides: Partial<FeatureFlags> = {
      useV2Classifier: this.parseEnvBoolean('FF_USE_V2_CLASSIFIER'),
      useV2PolicyEngine: this.parseEnvBoolean('FF_USE_V2_POLICY'),
      useV2Planner: this.parseEnvBoolean('FF_USE_V2_PLANNER'),
      useV2Executor: this.parseEnvBoolean('FF_USE_V2_EXECUTOR'),
      useV2Telemetry: this.parseEnvBoolean('FF_USE_V2_TELEMETRY'),
      directRouteEnabled: this.parseEnvBoolean('FF_DIRECT_ROUTE'),
      parallelExecutionEnabled: this.parseEnvBoolean('FF_PARALLEL_EXECUTION'),
      cachingEnabled: this.parseEnvBoolean('FF_CACHING'),
      v2RolloutPercentage: this.parseEnvNumber('FF_V2_ROLLOUT_PCT'),
      directRoutePercentage: this.parseEnvNumber('FF_DIRECT_ROUTE_PCT'),
      parallelExecutionPercentage: this.parseEnvNumber('FF_PARALLEL_EXEC_PCT'),
    };

    // Apply env overrides
    Object.entries(envOverrides).forEach(([key, value]) => {
      if (value !== undefined) {
        (flags as any)[key] = value;
      }
    });

    logger.info('Feature flags loaded', {
      v2Enabled: flags.useV2Classifier && flags.useV2PolicyEngine,
      v2RolloutPct: flags.v2RolloutPercentage,
      directRoute: flags.directRouteEnabled,
      parallel: flags.parallelExecutionEnabled,
    });

    return flags;
  }

  /**
   * Get a specific feature flag value
   */
  getFlag<K extends keyof FeatureFlags>(key: K): FeatureFlags[K] {
    // Check for runtime override first
    if (this.overrides.has(key)) {
      return this.overrides.get(key);
    }
    return this.flags[key];
  }

  /**
   * Check if a request should use V2 based on rollout percentage
   */
  shouldUseV2(requestId?: string): boolean {
    const rolloutPct = this.getFlag('v2RolloutPercentage');

    // Use request ID for consistent hashing if provided
    if (requestId) {
      const hash = this.simpleHash(requestId);
      return (hash % 100) < rolloutPct;
    }

    // Random rollout if no request ID
    return Math.random() * 100 < rolloutPct;
  }

  /**
   * Check if direct routing should be used
   */
  shouldUseDirectRoute(confidence: number): boolean {
    if (!this.getFlag('directRouteEnabled')) {
      return false;
    }

    // High confidence required for direct route
    if (confidence < 0.90) {
      return false;
    }

    const directPct = this.getFlag('directRoutePercentage');
    return Math.random() * 100 < directPct;
  }

  /**
   * Check if parallel execution should be used
   */
  shouldUseParallelExecution(): boolean {
    if (!this.getFlag('parallelExecutionEnabled')) {
      return false;
    }

    const parallelPct = this.getFlag('parallelExecutionPercentage');
    return Math.random() * 100 < parallelPct;
  }

  /**
   * Set a runtime override for a flag
   */
  setOverride<K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]): void {
    this.overrides.set(key, value);
    logger.info(`Feature flag override set: ${key} = ${value}`);
  }

  /**
   * Clear a runtime override
   */
  clearOverride(key: keyof FeatureFlags): void {
    this.overrides.delete(key);
    logger.info(`Feature flag override cleared: ${key}`);
  }

  /**
   * Update rollout percentages
   */
  updateRollout(updates: {
    v2?: number;
    directRoute?: number;
    parallelExecution?: number;
  }): void {
    if (updates.v2 !== undefined) {
      this.flags.v2RolloutPercentage = Math.max(0, Math.min(100, updates.v2));
    }
    if (updates.directRoute !== undefined) {
      this.flags.directRoutePercentage = Math.max(0, Math.min(100, updates.directRoute));
    }
    if (updates.parallelExecution !== undefined) {
      this.flags.parallelExecutionPercentage = Math.max(0, Math.min(100, updates.parallelExecution));
    }

    logger.info('Rollout percentages updated', {
      v2: this.flags.v2RolloutPercentage,
      directRoute: this.flags.directRoutePercentage,
      parallelExecution: this.flags.parallelExecutionPercentage,
    });
  }

  /**
   * Get all current flag values
   */
  getAllFlags(): FeatureFlags {
    const current = { ...this.flags };
    // Apply overrides
    this.overrides.forEach((value, key) => {
      (current as any)[key] = value;
    });
    return current;
  }

  /**
   * Export flags for monitoring
   */
  exportMetrics(): Record<string, any> {
    return {
      flags: this.getAllFlags(),
      overrides: Array.from(this.overrides.keys()),
      timestamp: new Date().toISOString(),
    };
  }

  // Helper methods

  private parseEnvBoolean(key: string): boolean | undefined {
    const value = process.env[key];
    if (value === undefined) return undefined;
    return value === 'true' || value === '1';
  }

  private parseEnvNumber(key: string): number | undefined {
    const value = process.env[key];
    if (value === undefined) return undefined;
    const num = parseInt(value, 10);
    return isNaN(num) ? undefined : num;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Periodically refresh flags from external source (if configured)
   */
  private startPeriodicRefresh(): void {
    // Refresh every 5 minutes if external config is available
    if (process.env.FF_CONFIG_URL) {
      setInterval(() => {
        this.refreshFromRemote().catch(err => {
          logger.error('Failed to refresh feature flags', err);
        });
      }, 5 * 60 * 1000);
    }
  }

  private async refreshFromRemote(): Promise<void> {
    // This would fetch from a remote config service
    // For now, just reload from environment
    this.flags = this.loadFlags();
  }
}

// Export singleton instance
export const featureFlags = FeatureFlagManager.getInstance();