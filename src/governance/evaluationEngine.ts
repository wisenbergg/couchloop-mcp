/**
 * CouchLoop Behavioral Governance Layer - Evaluation Engine
 *
 * Main evaluation pipeline that orchestrates all governance checks
 * for draft LLM responses before delivery to users
 */

import { HallucinationDetector } from './detectors/hallucination.js';
import { InconsistencyChecker } from './detectors/inconsistency.js';
import { ToneDriftMonitor } from './detectors/toneDrift.js';
import { UnsafeReasoningDetector } from './detectors/unsafeReasoning.js';
import { GovernanceConfig, loadConfig } from './config.js';
import { logger } from '../utils/logger.js';

// Core types for governance evaluations
export enum InterventionAction {
  APPROVE = 'approve',
  BLOCK = 'block',
  MODIFY = 'modify',
  FALLBACK = 'fallback'
}

export enum RiskLevel {
  NONE = 'none',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface SessionContext {
  sessionId: string;
  userId?: string;
  journeyId?: string;
  conversationHistory?: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }>;
  currentStep?: number;
  metadata?: Record<string, any>;
}

export interface DetectionResult {
  detected: boolean;
  confidence: number;
  patterns?: string[];
  details?: Record<string, any>;
}

export interface EvaluationResult {
  hallucination: DetectionResult;
  inconsistency: DetectionResult;
  toneDrift: DetectionResult;
  unsafeReasoning: DetectionResult;
  overallRisk: RiskLevel;
  recommendedAction: InterventionAction;
  confidence: number;
  timestamp: Date;
  evaluationId: string;
}

export interface InterceptionResult {
  originalResponse: string;
  evaluationRequired: boolean;
  timestamp: Date;
  sessionId: string;
}

/**
 * Main evaluation engine that coordinates all governance checks
 */
export class EvaluationEngine {
  private hallucinationDetector: HallucinationDetector;
  private inconsistencyChecker: InconsistencyChecker;
  private toneDriftMonitor: ToneDriftMonitor;
  private unsafeReasoningDetector: UnsafeReasoningDetector;
  private config: GovernanceConfig;

  constructor(config?: GovernanceConfig) {
    this.config = config || loadConfig();

    // Initialize all detectors
    this.hallucinationDetector = new HallucinationDetector(this.config.criteria.hallucination);
    this.inconsistencyChecker = new InconsistencyChecker(this.config.criteria.inconsistency);
    this.toneDriftMonitor = new ToneDriftMonitor(this.config.criteria.toneDrift);
    this.unsafeReasoningDetector = new UnsafeReasoningDetector(this.config.criteria.unsafeReasoning);
  }

  /**
   * Main evaluation method - runs all enabled governance checks
   */
  async evaluate(draft: string, context: SessionContext): Promise<EvaluationResult> {
    const evaluationId = this.generateEvaluationId();
    const startTime = Date.now();

    // Run all detectors in parallel for performance
    const [hallucination, inconsistency, toneDrift, unsafeReasoning] = await Promise.all([
      this.config.criteria.hallucination.enabled
        ? this.hallucinationDetector.detect(draft, context)
        : { detected: false, confidence: 0 },

      this.config.criteria.inconsistency.enabled
        ? this.inconsistencyChecker.check(draft, context)
        : { detected: false, confidence: 0 },

      this.config.criteria.toneDrift.enabled
        ? this.toneDriftMonitor.monitor(draft, context)
        : { detected: false, confidence: 0 },

      this.config.criteria.unsafeReasoning.enabled
        ? this.unsafeReasoningDetector.detect(draft, context)
        : { detected: false, confidence: 0 }
    ]);

    // Calculate overall risk level and recommended action
    const { overallRisk, recommendedAction, confidence } = this.aggregateResults(
      hallucination,
      inconsistency,
      toneDrift,
      unsafeReasoning
    );

    const result: EvaluationResult = {
      hallucination,
      inconsistency,
      toneDrift,
      unsafeReasoning,
      overallRisk,
      recommendedAction,
      confidence,
      timestamp: new Date(),
      evaluationId
    };

    // Log evaluation time for performance monitoring
    const evaluationTime = Date.now() - startTime;
    if (evaluationTime > 1000) {
      logger.warn(`[Governance] Evaluation took ${evaluationTime}ms (target: <1000ms)`);
    }

    return result;
  }

  /**
   * Determine if evaluation is required based on context
   */
  shouldEvaluate(response: string, context: SessionContext): boolean {
    // Always evaluate if governance is enabled
    if (!this.config.enabled) {
      return false;
    }

    // Skip evaluation for certain response types
    if (this.isSystemResponse(response)) {
      return false;
    }

    // Always evaluate for crisis-prone sessions
    if (context.metadata?.crisisHistory) {
      return true;
    }

    return true;
  }

  /**
   * Aggregate individual detection results into overall risk assessment
   */
  private aggregateResults(
    hallucination: DetectionResult,
    inconsistency: DetectionResult,
    toneDrift: DetectionResult,
    unsafeReasoning: DetectionResult
  ): { overallRisk: RiskLevel; recommendedAction: InterventionAction; confidence: number } {
    // Weight different criteria based on severity
    const weights = {
      unsafeReasoning: 3.0,
      hallucination: 2.0,
      inconsistency: 1.5,
      toneDrift: 1.0
    };

    // Calculate weighted risk score
    let riskScore = 0;
    let totalWeight = 0;
    let maxConfidence = 0;

    if (unsafeReasoning.detected) {
      riskScore += unsafeReasoning.confidence * weights.unsafeReasoning;
      totalWeight += weights.unsafeReasoning;
      maxConfidence = Math.max(maxConfidence, unsafeReasoning.confidence);
    }

    if (hallucination.detected) {
      riskScore += hallucination.confidence * weights.hallucination;
      totalWeight += weights.hallucination;
      maxConfidence = Math.max(maxConfidence, hallucination.confidence);
    }

    if (inconsistency.detected) {
      riskScore += inconsistency.confidence * weights.inconsistency;
      totalWeight += weights.inconsistency;
      maxConfidence = Math.max(maxConfidence, inconsistency.confidence);
    }

    if (toneDrift.detected) {
      riskScore += toneDrift.confidence * weights.toneDrift;
      totalWeight += weights.toneDrift;
      maxConfidence = Math.max(maxConfidence, toneDrift.confidence);
    }

    // Normalize risk score
    const normalizedRisk = totalWeight > 0 ? riskScore / totalWeight : 0;

    // Determine risk level
    let overallRisk: RiskLevel;
    if (normalizedRisk === 0) {
      overallRisk = RiskLevel.NONE;
    } else if (normalizedRisk < 0.25) {
      overallRisk = RiskLevel.LOW;
    } else if (normalizedRisk < 0.5) {
      overallRisk = RiskLevel.MEDIUM;
    } else if (normalizedRisk < 0.75) {
      overallRisk = RiskLevel.HIGH;
    } else {
      overallRisk = RiskLevel.CRITICAL;
    }

    // Determine recommended action based on thresholds
    let recommendedAction: InterventionAction;
    if (unsafeReasoning.detected && unsafeReasoning.confidence > 0.8) {
      // Always block high-confidence unsafe reasoning
      recommendedAction = InterventionAction.BLOCK;
    } else if (maxConfidence > this.config.interventionThresholds.block) {
      recommendedAction = InterventionAction.BLOCK;
    } else if (maxConfidence > this.config.interventionThresholds.modify) {
      recommendedAction = InterventionAction.MODIFY;
    } else if (maxConfidence > this.config.interventionThresholds.warn) {
      recommendedAction = InterventionAction.MODIFY;
    } else {
      recommendedAction = InterventionAction.APPROVE;
    }

    return {
      overallRisk,
      recommendedAction,
      confidence: maxConfidence
    };
  }

  /**
   * Check if response is a system message that shouldn't be evaluated
   */
  private isSystemResponse(response: string): boolean {
    const systemPatterns = [
      /^Error:/,
      /^System:/,
      /^Loading/,
      /^Please wait/
    ];

    return systemPatterns.some(pattern => pattern.test(response));
  }

  /**
   * Generate unique evaluation ID for audit trail
   */
  private generateEvaluationId(): string {
    return `eval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Update configuration dynamically
   */
  updateConfig(config: Partial<GovernanceConfig>): void {
    this.config = { ...this.config, ...config };

    // Update detector configurations
    if (config.criteria?.hallucination) {
      this.hallucinationDetector.updateConfig(config.criteria.hallucination);
    }
    if (config.criteria?.inconsistency) {
      this.inconsistencyChecker.updateConfig(config.criteria.inconsistency);
    }
    if (config.criteria?.toneDrift) {
      this.toneDriftMonitor.updateConfig(config.criteria.toneDrift);
    }
    if (config.criteria?.unsafeReasoning) {
      this.unsafeReasoningDetector.updateConfig(config.criteria.unsafeReasoning);
    }
  }
}

/**
 * Main governance pipeline that orchestrates evaluation and intervention
 */
export class GovernancePipeline {
  private evaluationEngine: EvaluationEngine;
  private config: GovernanceConfig;

  constructor(config?: GovernanceConfig) {
    this.config = config || loadConfig();
    this.evaluationEngine = new EvaluationEngine(this.config);
  }

  /**
   * Main entry point for governance evaluation
   */
  async evaluate(draftResponse: string, context: SessionContext): Promise<EvaluationResult> {
    // Check if evaluation is required
    if (!this.evaluationEngine.shouldEvaluate(draftResponse, context)) {
      return this.createPassthroughResult();
    }

    // Run evaluation
    return await this.evaluationEngine.evaluate(draftResponse, context);
  }

  /**
   * Determine action based on evaluation results
   */
  determineAction(evaluation: EvaluationResult): InterventionAction {
    return evaluation.recommendedAction;
  }

  /**
   * Create a passthrough result for cases where evaluation is skipped
   */
  private createPassthroughResult(): EvaluationResult {
    return {
      hallucination: { detected: false, confidence: 0 },
      inconsistency: { detected: false, confidence: 0 },
      toneDrift: { detected: false, confidence: 0 },
      unsafeReasoning: { detected: false, confidence: 0 },
      overallRisk: RiskLevel.NONE,
      recommendedAction: InterventionAction.APPROVE,
      confidence: 0,
      timestamp: new Date(),
      evaluationId: `passthrough_${Date.now()}`
    };
  }
}

export default GovernancePipeline;