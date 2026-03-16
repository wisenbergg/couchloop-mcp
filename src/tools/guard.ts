/**
 * Guard Tool Adapter
 *
 * Provides a { definition, handler } shape compatible with the primary-tools
 * registration model. Returns a plain GuardResult object rather than the
 * McpServer-native { content: [{ type:'text', text }] } envelope.
 *
 * Uses the actual GovernancePipeline / InterventionEngine instance APIs.
 * The hallucinated-packages corpus is imported via the real filename.
 */

import { z } from 'zod';
import {
  GovernancePipeline,
  InterventionAction,
  type SessionContext,
  type EvaluationResult,
} from '../governance/evaluationEngine.js';
import { InterventionEngine } from '../governance/intervention.js';
import {
  scanPackageList,
  CORPUS_STATS,
  type NamedHallucinationCheckResult,
} from './hallucinated-packages-corpus.js';
import { logger } from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type GuardActionType = 'pass' | 'modified' | 'blocked';

export interface GuardResult {
  action: GuardActionType;
  response: string;
  intervention?: {
    type: string;
    reason: string;
    confidence: number;
    original_response?: string;
  };
  domain_detected: 'dev' | 'clinical' | 'unknown';
  evaluation_id: string;
  elapsed_ms: number;
  mode: 'enforce' | 'shadow' | 'bypass';
  corpus_version: string;
  detector_results?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Input schema
// ─────────────────────────────────────────────────────────────────────────────

const GuardInputSchema = z.object({
  response: z.string().describe('Draft response to evaluate'),
  conversation: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .optional()
    .default([]),
  domain: z.enum(['dev', 'clinical', 'auto']).optional().default('auto'),
  session_id: z.string().optional(),
  mode: z.enum(['enforce', 'shadow', 'bypass']).optional().default('enforce'),
});

export type GuardInput = z.infer<typeof GuardInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Domain detection
// ─────────────────────────────────────────────────────────────────────────────

const DEV_SIGNALS = [
  /\b(npm|yarn|pnpm|pip|cargo|gem)\s+install\b/i,
  /\b(import|require|from)\s+['"][^'"]+['"]/i,
  /\b(function|class|const|let|var|async|await|interface|type)\b/,
  /\b(error|exception|stack\s*trace|undefined|null|NaN)\b/i,
  /\b(git|commit|branch|merge|pull\s*request|PR)\b/i,
  /\b(API|endpoint|REST|GraphQL|webhook|SDK)\b/i,
  /\b(docker|kubernetes|CI\/CD|pipeline|deploy)\b/i,
  /\b(typescript|javascript|python|rust|golang|node\.?js)\b/i,
];

const CLINICAL_SIGNALS = [
  /\b(suicid|self.harm|self.injur|overdose|end\s+my\s+life|want\s+to\s+die)\b/i,
  /\b(depressed|depression|anxiety|anxious|panic|dissociat)\b/i,
  /\b(therapist|psychiatrist|medication|diagnosis|disorder|mental\s+health)\b/i,
  /\b(trauma|PTSD|abuse|grief|loss|overwhelmed|hopeless)\b/i,
  /\b(cutting|burning|starving|purging|binge)\b/i,
  /\b(crisis|hotline|emergency|911|hospital)\b/i,
];

function detectDomain(
  turns: { role: string; content: string }[],
  draft: string,
): 'dev' | 'clinical' | 'unknown' {
  const text = [...turns.map((t) => t.content), draft].join(' ');
  if (CLINICAL_SIGNALS.some((s) => s.test(text))) return 'clinical';
  if (DEV_SIGNALS.filter((s) => s.test(text)).length >= 2) return 'dev';
  return 'unknown';
}

function hasCrisisSignals(turns: { role: string; content: string }[]): boolean {
  const text = turns
    .filter((t) => t.role === 'user')
    .slice(-5)
    .map((t) => t.content)
    .join(' ');
  return CLINICAL_SIGNALS.some((s) => s.test(text));
}

function generateEvaluationId(): string {
  return `eval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Package extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractPackageNames(text: string): string[] {
  const names: string[] = [];
  const installRe =
    /(?:npm|yarn|pnpm)\s+(?:install|add|i)\s+((?:@?[\w][\w.-]*\/[\w.-]+|[\w][\w.-]*)(?:\s+(?:@?[\w][\w.-]*\/[\w.-]+|[\w][\w.-]*))*)/g;
  const importRe =
    /(?:import\s+(?:.*?\s+from\s+)?|require\s*\(\s*)['"](@?[\w][\w.-]*(?:\/[\w.-]+)?)['"]/g;

  let res = installRe.exec(text);
  while (res !== null) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    names.push(
      ...res[1]!
        .split(/\s+/)
        .map((p) => p.trim())
        .filter((p) => Boolean(p) && !p.startsWith('-')),
    );
    res = installRe.exec(text);
  }
  res = importRe.exec(text);
  while (res !== null) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    if (!res[1]!.startsWith('.') && !res[1]!.startsWith('/')) names.push(res[1]!);
    res = importRe.exec(text);
  }
  return [...new Set(names)];
}

function buildBlockedFallback(reason: string, alternative?: string): string {
  const parts = [
    "⚠️ I can't recommend that package — it has been flagged as confirmed malicious or hallucinated.",
    reason,
  ];
  if (alternative) parts.push(`The package you may be looking for is: **${alternative}**`);
  parts.push('Please verify any package name before installing.');
  return parts.join('\n\n');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared governance instances (one per process)
// ─────────────────────────────────────────────────────────────────────────────

const governancePipeline = new GovernancePipeline();
const interventionEngine = new InterventionEngine();

/** Map conversation turns to SessionContext format (requires timestamp). */
function toSessionHistory(
  turns: { role: 'user' | 'assistant'; content: string }[],
): NonNullable<SessionContext['conversationHistory']> {
  const base = Date.now();
  return turns.map((t, i) => ({
    role: t.role,
    content: t.content,
    timestamp: new Date(base - (turns.length - i) * 1000),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Core handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleGuard(args: unknown): Promise<GuardResult> {
  const input = GuardInputSchema.parse(args);
  const { response, conversation = [], domain, session_id, mode } = input;

  const startTime = Date.now();
  const evaluationId = generateEvaluationId();

  if (mode === 'bypass') {
    return {
      action: 'pass',
      response,
      domain_detected: 'unknown',
      evaluation_id: evaluationId,
      elapsed_ms: Date.now() - startTime,
      mode: 'bypass',
      corpus_version: (CORPUS_STATS as { lastUpdated: string }).lastUpdated,
    };
  }

  try {
    const domainDetected: 'dev' | 'clinical' | 'unknown' =
      domain === 'auto' ? detectDomain(conversation, response) : domain;

    let action: GuardActionType = 'pass';
    let finalResponse = response;
    let intervention: GuardResult['intervention'];
    let detectorResults: Record<string, unknown> = {};

    // ── dev / unknown path ───────────────────────────────────────────────────
    if (domainDetected === 'dev' || domainDetected === 'unknown') {
      const packageNames = extractPackageNames(response);
      const flaggedPackages = (scanPackageList as (names: string[]) => NamedHallucinationCheckResult[])(packageNames);

      if (flaggedPackages.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const topFlag = flaggedPackages[0]!;
        detectorResults.hallucination = {
          flagged: true,
          packages: flaggedPackages.map((f) => ({
            name: f.name,
            confidence: f.confidence,
            reason: f.reason,
            source: f.source,
            alternative: f.suggestedAlternative,
          })),
        };

        if (mode === 'enforce') {
          let corrected = response;
          for (const flag of flaggedPackages) {
            if (flag.suggestedAlternative) {
              const re = new RegExp(
                `((?:npm|yarn|pnpm)\\s+(?:install|add|i)\\s+[^\\n]*?)\\b${escapeRegex(flag.name)}\\b`,
                'gi',
              );
              corrected = corrected.replace(
                re,
                (_full, prefix: string) =>
                  `${prefix}${flag.suggestedAlternative} /* ⚠ was: ${flag.name} */`,
              );
            }
          }
          const wasModified = corrected !== response;
          action =
            (topFlag as { source?: string }).source === 'confirmed_malicious'
              ? 'blocked'
              : wasModified
              ? 'modified'
              : 'pass';
          if (action !== 'pass') {
            finalResponse =
              action === 'blocked'
                ? buildBlockedFallback(
                    topFlag.reason,
                    topFlag.suggestedAlternative,
                  )
                : corrected;
            const conf =
              topFlag.confidence === 'high' ? 0.95 : topFlag.confidence === 'medium' ? 0.7 : 0.45;
            intervention = {
              type:
                action === 'blocked'
                  ? 'package_hallucination_blocked'
                  : 'package_hallucination_corrected',
              reason: topFlag.reason,
              confidence: conf,
              original_response: response,
            };
          }
        }
      }

      if (action === 'pass' && domainDetected === 'dev') {
        try {
          const sessionCtx: SessionContext = {
            sessionId: session_id ?? evaluationId,
            conversationHistory: toSessionHistory(conversation),
          };
          const evalResult: EvaluationResult = await governancePipeline.evaluate(
            response,
            sessionCtx,
          );
          detectorResults = { ...detectorResults, risk: evalResult.overallRisk };

          if (
            evalResult.recommendedAction !== InterventionAction.APPROVE &&
            mode === 'enforce'
          ) {
            const iv = await interventionEngine.intervene(
              evalResult.recommendedAction,
              response,
              evalResult,
            );
            if (iv.action !== InterventionAction.APPROVE) {
              action = iv.action === InterventionAction.BLOCK ? 'blocked' : 'modified';
              finalResponse = iv.finalResponse;
              intervention = {
                type: `pipeline_${iv.action}`,
                reason: iv.reason,
                confidence: iv.confidence,
                original_response: response,
              };
            }
          }
        } catch {
          // fail open
        }
      }
    }

    // ── clinical path ────────────────────────────────────────────────────────
    if (domainDetected === 'clinical') {
      const crisisDetected = hasCrisisSignals(conversation);
      detectorResults.crisis_pre_check = { flagged: crisisDetected };
      try {
        const sessionCtx: SessionContext = {
          sessionId: session_id ?? evaluationId,
          conversationHistory: toSessionHistory(conversation),
          metadata: { crisisSignalsDetected: crisisDetected },
        };
        const evalResult: EvaluationResult = await governancePipeline.evaluate(
          response,
          sessionCtx,
        );
        detectorResults = { ...detectorResults, risk: evalResult.overallRisk };

        if (
          evalResult.recommendedAction !== InterventionAction.APPROVE &&
          mode === 'enforce'
        ) {
          const iv = await interventionEngine.intervene(
            evalResult.recommendedAction,
            response,
            evalResult,
          );
          if (iv.action !== InterventionAction.APPROVE) {
            action = iv.action === InterventionAction.BLOCK ? 'blocked' : 'modified';
            finalResponse = iv.finalResponse;
            intervention = {
              type: `clinical_${iv.action}`,
              reason: iv.reason,
              confidence: iv.confidence,
              original_response: response,
            };
          }
        }
      } catch {
        // fail open
      }
    }

    if (mode === 'shadow') {
      action = 'pass';
      finalResponse = response;
    }

    const corpusVersion = (CORPUS_STATS as { lastUpdated: string }).lastUpdated;

    return {
      action,
      response: finalResponse,
      ...(intervention ? { intervention } : {}),
      domain_detected: domainDetected,
      evaluation_id: evaluationId,
      elapsed_ms: Date.now() - startTime,
      mode,
      corpus_version: corpusVersion,
      detector_results: detectorResults,
    };
  } catch (err) {
    logger.error('[guard] Top-level failure — failing open:', err);
    const corpusVersion = (CORPUS_STATS as { lastUpdated: string }).lastUpdated;
    return {
      action: 'pass',
      response,
      domain_detected: 'unknown',
      evaluation_id: evaluationId,
      elapsed_ms: Date.now() - startTime,
      mode,
      corpus_version: corpusVersion,
      detector_results: {
        error: err instanceof Error ? err.message : 'Unknown governance error',
        fail_open: true,
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// { definition, handler } export consumed by primary-tools.ts
// ─────────────────────────────────────────────────────────────────────────────

const corpusStats = CORPUS_STATS as { confirmedMalicious: number; documentedHallucinations: number; lastUpdated: string };

export const guardTool = {
  definition: {
    name: 'guard',
    description: [
      'Per-turn governance layer. Evaluate a draft response before delivering it.',
      '',
      'Actions returned: pass (clean), modified (corrected), blocked (unsafe fallback).',
      'Modes: enforce (default, apply interventions), shadow (log-only), bypass (skip).',
      '',
      `Corpus: ${corpusStats.confirmedMalicious} confirmed malicious, ` +
        `${corpusStats.documentedHallucinations} documented hallucinations, ` +
        `last updated ${corpusStats.lastUpdated}.`,
    ].join('\n'),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        response: { type: 'string', description: 'Draft response to evaluate' },
        conversation: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['user', 'assistant'] },
              content: { type: 'string' },
            },
            required: ['role', 'content'],
          },
          description: 'Recent conversation history',
        },
        domain: {
          type: 'string',
          enum: ['dev', 'clinical', 'auto'],
          description: "Governance domain. 'auto' detects from context.",
        },
        session_id: { type: 'string', description: 'Session ID for audit trail' },
        mode: {
          type: 'string',
          enum: ['enforce', 'shadow', 'bypass'],
          description: 'Governance mode',
        },
      },
      required: ['response'],
    },
  },
  handler: handleGuard,
} as const;
