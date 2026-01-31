/**
 * CouchLoop Behavioral Governance Layer - Configuration
 *
 * Central configuration management for governance rules, thresholds, and behaviors
 */

export interface CriterionConfig {
  enabled: boolean;
  threshold: number;
  weight?: number;
  patterns?: string[];
  metadata?: Record<string, any>;
}

export interface GovernanceConfig {
  enabled: boolean;
  mode: 'enforce' | 'shadow' | 'bypass';
  criteria: {
    hallucination: CriterionConfig;
    inconsistency: CriterionConfig;
    toneDrift: CriterionConfig;
    unsafeReasoning: CriterionConfig;
  };
  interventionThresholds: {
    block: number;    // > 0.9 confidence
    modify: number;   // > 0.7 confidence
    warn: number;     // > 0.5 confidence
  };
  fallbackResponses: {
    crisis: string;
    blocked: string;
    error: string;
    modified: string;
  };
  performance: {
    maxEvaluationTime: number;  // milliseconds
    cacheEnabled: boolean;
    cacheTTL: number;           // seconds
    parallelEvaluation: boolean;
  };
  logging: {
    auditEnabled: boolean;
    verboseLogging: boolean;
    logFailedEvaluations: boolean;
    logPassedEvaluations: boolean;
  };
}

/**
 * Default configuration for governance layer
 */
export const defaultConfig: GovernanceConfig = {
  enabled: true,
  mode: 'enforce',

  criteria: {
    hallucination: {
      enabled: true,
      threshold: 0.7,
      weight: 2.0,
      patterns: [
        'I have (direct|personal) experience',
        'studies (consistently |always )?show',
        "it's a (proven|established) fact that",
        'everyone knows that',
        'scientifically proven',
        '(\\d+)% of (people|studies|research)',
        'according to recent research',
        'experts agree that'
      ]
    },

    inconsistency: {
      enabled: true,
      threshold: 0.7,
      weight: 1.5,
      metadata: {
        lookbackLimit: 10,  // Number of previous messages to check
        semanticSimilarityThreshold: 0.8
      }
    },

    toneDrift: {
      enabled: true,
      threshold: 0.6,
      weight: 1.0,
      patterns: [
        'you must',
        'you should definitely',
        "don't worry about",
        'everything will be (fine|okay|perfect)',
        'you need to',
        "I'm here for you",
        'trust me',
        'believe me',
        'I understand exactly',
        'I know how you feel'
      ]
    },

    unsafeReasoning: {
      enabled: true,
      threshold: 0.5,
      weight: 3.0,
      patterns: [
        'stop taking your medication',
        'you should definitely',
        "don't tell (anyone|your)",
        'this will cure',
        'your (therapist|doctor) is wrong',
        'ignore what they said',
        'you don\'t need (therapy|treatment|help)',
        'harm yourself',
        'end (it all|your life)',
        'nobody cares',
        'give up',
        'not worth living',
        'better off without you'
      ]
    }
  },

  interventionThresholds: {
    block: 0.9,    // Block response if confidence > 0.9
    modify: 0.7,   // Modify response if confidence > 0.7
    warn: 0.5      // Warning threshold
  },

  fallbackResponses: {
    crisis: "I notice this conversation is touching on some serious topics. If you're in crisis, please reach out to a crisis helpline: 988 (Suicide & Crisis Lifeline) or text 'HELLO' to 741741 (Crisis Text Line). Your safety is important.",

    blocked: "I need to pause here. My response might not have been helpful for this conversation. Let's refocus on what would be most supportive for you right now. What would be helpful to explore?",

    error: "I encountered an issue processing this response. Let me try to help you in a different way. What's most important for you to discuss right now?",

    modified: "Let me rephrase that in a way that might be more helpful..."
  },

  performance: {
    maxEvaluationTime: 1000,  // 1 second max
    cacheEnabled: true,
    cacheTTL: 300,            // 5 minutes
    parallelEvaluation: true
  },

  logging: {
    auditEnabled: true,
    verboseLogging: process.env.NODE_ENV === 'development',
    logFailedEvaluations: true,
    logPassedEvaluations: false
  }
};

/**
 * Load configuration from environment or use defaults
 */
export function loadConfig(): GovernanceConfig {
  const config = { ...defaultConfig };

  // Override from environment variables
  if (process.env.GOVERNANCE_ENABLED === 'false') {
    config.enabled = false;
  }

  if (process.env.GOVERNANCE_MODE) {
    config.mode = process.env.GOVERNANCE_MODE as 'enforce' | 'shadow' | 'bypass';
  }

  // Load thresholds from environment
  if (process.env.GOVERNANCE_BLOCK_THRESHOLD) {
    config.interventionThresholds.block = parseFloat(process.env.GOVERNANCE_BLOCK_THRESHOLD);
  }

  if (process.env.GOVERNANCE_MODIFY_THRESHOLD) {
    config.interventionThresholds.modify = parseFloat(process.env.GOVERNANCE_MODIFY_THRESHOLD);
  }

  if (process.env.GOVERNANCE_WARN_THRESHOLD) {
    config.interventionThresholds.warn = parseFloat(process.env.GOVERNANCE_WARN_THRESHOLD);
  }

  // Load criterion-specific configs
  if (process.env.GOVERNANCE_HALLUCINATION_ENABLED === 'false') {
    config.criteria.hallucination.enabled = false;
  }

  if (process.env.GOVERNANCE_INCONSISTENCY_ENABLED === 'false') {
    config.criteria.inconsistency.enabled = false;
  }

  if (process.env.GOVERNANCE_TONE_DRIFT_ENABLED === 'false') {
    config.criteria.toneDrift.enabled = false;
  }

  if (process.env.GOVERNANCE_UNSAFE_REASONING_ENABLED === 'false') {
    config.criteria.unsafeReasoning.enabled = false;
  }

  // Performance settings
  if (process.env.GOVERNANCE_MAX_EVAL_TIME) {
    config.performance.maxEvaluationTime = parseInt(process.env.GOVERNANCE_MAX_EVAL_TIME);
  }

  if (process.env.GOVERNANCE_CACHE_ENABLED === 'false') {
    config.performance.cacheEnabled = false;
  }

  // Logging settings
  if (process.env.GOVERNANCE_AUDIT_ENABLED === 'false') {
    config.logging.auditEnabled = false;
  }

  if (process.env.GOVERNANCE_VERBOSE_LOGGING === 'true') {
    config.logging.verboseLogging = true;
  }

  return config;
}

/**
 * Validate configuration for consistency
 */
export function validateConfig(config: GovernanceConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check thresholds are in valid range
  if (config.interventionThresholds.block < 0 || config.interventionThresholds.block > 1) {
    errors.push('Block threshold must be between 0 and 1');
  }

  if (config.interventionThresholds.modify < 0 || config.interventionThresholds.modify > 1) {
    errors.push('Modify threshold must be between 0 and 1');
  }

  if (config.interventionThresholds.warn < 0 || config.interventionThresholds.warn > 1) {
    errors.push('Warn threshold must be between 0 and 1');
  }

  // Check thresholds are in correct order
  if (config.interventionThresholds.block < config.interventionThresholds.modify) {
    errors.push('Block threshold should be higher than modify threshold');
  }

  if (config.interventionThresholds.modify < config.interventionThresholds.warn) {
    errors.push('Modify threshold should be higher than warn threshold');
  }

  // Check criterion thresholds
  Object.entries(config.criteria).forEach(([name, criterion]) => {
    if (criterion.threshold < 0 || criterion.threshold > 1) {
      errors.push(`${name} threshold must be between 0 and 1`);
    }
  });

  // Check performance settings
  if (config.performance.maxEvaluationTime < 100) {
    errors.push('Max evaluation time should be at least 100ms');
  }

  if (config.performance.cacheTTL < 0) {
    errors.push('Cache TTL must be positive');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Export configuration for a specific environment
 */
export function getConfigForEnvironment(env: 'development' | 'staging' | 'production'): GovernanceConfig {
  const baseConfig = loadConfig();

  switch (env) {
    case 'development':
      return {
        ...baseConfig,
        mode: 'shadow',  // Don't actually intervene in dev
        logging: {
          ...baseConfig.logging,
          verboseLogging: true,
          logPassedEvaluations: true
        }
      };

    case 'staging':
      return {
        ...baseConfig,
        mode: 'enforce',
        interventionThresholds: {
          ...baseConfig.interventionThresholds,
          block: 0.95,  // More conservative in staging
          modify: 0.8,
          warn: 0.6
        }
      };

    case 'production':
      return {
        ...baseConfig,
        mode: 'enforce',
        performance: {
          ...baseConfig.performance,
          maxEvaluationTime: 500,  // Stricter performance requirements
          cacheEnabled: true,
          cacheTTL: 600  // 10 minutes
        },
        logging: {
          ...baseConfig.logging,
          verboseLogging: false,
          logPassedEvaluations: false
        }
      };

    default:
      return baseConfig;
  }
}

export default loadConfig;