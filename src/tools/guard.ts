/**
 * CouchLoop Guard — Invisible Conversation Governance
 *
 * Silent governance layer that evaluates AI responses before delivery.
 * Unlike `verify` (user-facing), guard runs invisibly in the background
 * to gate-check responses through the full governance pipeline:
 * evaluation, risk assessment, and intervention.
 */

import { z } from 'zod';
import {
  GovernancePipeline,
  InterventionAction,
  RiskLevel,
  type SessionContext,
  type EvaluationResult,
} from '../governance/evaluationEngine.js';
import { InterventionEngine } from '../governance/intervention.js';
import { loadConfig } from '../governance/config.js';
import { logger } from '../utils/logger.js';

// ============================================================
// INPUT SCHEMA
// ============================================================

const GuardInputSchema = z.object({
  response: z.string().describe('The AI-generated response to evaluate before delivery'),
  session_id: z.string().optional().describe('Session ID for conversation context'),
  context: z.record(z.any()).optional().describe('Additional context metadata'),
  mode: z.enum(['enforce', 'shadow', 'bypass']).optional().describe(
    'Override governance mode: enforce (block/modify), shadow (log only), bypass (skip)'
  ),
});

export type GuardInput = z.infer<typeof GuardInputSchema>;

// ============================================================
// TOOL DEFINITION
// ============================================================

export const guardTool = {
  definition: {
    name: 'guard',
    description:
      'Invisible governance layer — evaluates AI responses for hallucinations, unsafe reasoning, tone drift, and inconsistencies. Runs silently before delivery. Returns the final (possibly modified) response with an audit trail. Use this to gate-check any AI output before presenting it to a user.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        response: {
          type: 'string',
          description: 'The AI-generated response to evaluate',
        },
        session_id: {
          type: 'string',
          description: 'Session ID for conversation history lookups',
        },
        context: {
          type: 'object',
          description: 'Additional context (userId, journeyId, metadata)',
        },
        mode: {
          type: 'string',
          enum: ['enforce', 'shadow', 'bypass'],
          description:
            'Governance mode override — enforce (default): block/modify unsafe content; shadow: evaluate but always pass through; bypass: skip evaluation entirely',
        },
      },
      required: ['response'],
    },
  },

  handler: handleGuard,
};

// ============================================================
// HANDLER
// ============================================================

export async function handleGuard(args: unknown) {
  const startTime = Date.now();

  try {
    const input = GuardInputSchema.parse(args);

    // Fast-path: bypass mode skips everything
    if (input.mode === 'bypass') {
      return buildResult({
        allowed: true,
        action: InterventionAction.APPROVE,
        risk_level: RiskLevel.NONE,
        confidence: 1,
        final_response: input.response,
        elapsed_ms: Date.now() - startTime,
      });
    }

    // Load config and optionally override mode
    const config = loadConfig();
    if (input.mode) {
      config.mode = input.mode;
    }

    // Build session context
    const sessionContext: SessionContext = {
      sessionId: input.session_id || `guard_${Date.now()}`,
      metadata: input.context,
    };

    // --- Step 1: Evaluate ---
    const pipeline = new GovernancePipeline(config);
    const evaluation = await pipeline.evaluate(input.response, sessionContext);
    const action = pipeline.determineAction(evaluation);

    // Shadow mode: log but always pass through
    if (config.mode === 'shadow') {
      logger.info('[Guard/shadow] Evaluation complete', {
        action,
        risk: evaluation.overallRisk,
        confidence: evaluation.confidence,
      });
      return buildResult({
        allowed: true,
        action,
        risk_level: evaluation.overallRisk,
        confidence: evaluation.confidence,
        final_response: input.response,
        evaluation,
        shadow: true,
        elapsed_ms: Date.now() - startTime,
      });
    }

    // --- Step 2: Intervene (enforce mode) ---
    if (action === InterventionAction.APPROVE) {
      return buildResult({
        allowed: true,
        action,
        risk_level: evaluation.overallRisk,
        confidence: evaluation.confidence,
        final_response: input.response,
        evaluation,
        elapsed_ms: Date.now() - startTime,
      });
    }

    const interventionEngine = new InterventionEngine(config);
    const intervention = await interventionEngine.intervene(action, input.response, evaluation);

    return buildResult({
      allowed: action !== InterventionAction.BLOCK,
      action,
      risk_level: evaluation.overallRisk,
      confidence: evaluation.confidence,
      final_response: intervention.finalResponse,
      modified: intervention.modified,
      modifications: intervention.modifications,
      reason: intervention.reason,
      evaluation,
      elapsed_ms: Date.now() - startTime,
    });
  } catch (error) {
    logger.error('[Guard] Evaluation failed', error);

    // Fail-open: return the original response so the user isn't blocked
    const input = (() => {
      try {
        return GuardInputSchema.parse(args);
      } catch {
        return null;
      }
    })();

    return {
      success: false,
      allowed: true,
      action: InterventionAction.APPROVE,
      risk_level: RiskLevel.NONE,
      confidence: 0,
      final_response: input?.response ?? '',
      error: error instanceof Error ? error.message : 'Unknown guard error',
      elapsed_ms: Date.now() - startTime,
    };
  }
}

// ============================================================
// HELPERS
// ============================================================

interface GuardResult {
  allowed: boolean;
  action: InterventionAction;
  risk_level: RiskLevel;
  confidence: number;
  final_response: string;
  modified?: boolean;
  modifications?: Array<{
    type: string;
    original: string;
    modified: string;
    reason: string;
  }>;
  reason?: string;
  evaluation?: EvaluationResult;
  shadow?: boolean;
  elapsed_ms: number;
}

function buildResult(r: GuardResult) {
  return {
    success: true,
    allowed: r.allowed,
    action: r.action,
    risk_level: r.risk_level,
    confidence: r.confidence,
    final_response: r.final_response,
    ...(r.modified !== undefined && { modified: r.modified }),
    ...(r.modifications && { modifications: r.modifications }),
    ...(r.reason && { reason: r.reason }),
    ...(r.shadow && { shadow: true }),
    audit: {
      evaluation_id: r.evaluation?.evaluationId ?? null,
      timestamp: r.evaluation?.timestamp ?? new Date(),
      elapsed_ms: r.elapsed_ms,
      detectors: r.evaluation
        ? {
            hallucination: {
              detected: r.evaluation.hallucination.detected,
              confidence: r.evaluation.hallucination.confidence,
            },
            inconsistency: {
              detected: r.evaluation.inconsistency.detected,
              confidence: r.evaluation.inconsistency.confidence,
            },
            toneDrift: {
              detected: r.evaluation.toneDrift.detected,
              confidence: r.evaluation.toneDrift.confidence,
            },
            unsafeReasoning: {
              detected: r.evaluation.unsafeReasoning.detected,
              confidence: r.evaluation.unsafeReasoning.confidence,
            },
          }
        : null,
    },
  };
}
