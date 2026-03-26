/**
 * Policy Layer — runToolWithPolicy
 *
 * Mandatory execution wrapper applied to every public tool handler.
 * Implements the contract lifecycle step:
 *
 *   validate (done by Zod before handler)
 *     → execute
 *     → sanitize
 *     → verify-if-required
 *     → normalize
 *     → log
 *
 * Usage:
 *   const result = await runToolWithPolicy(
 *     { toolName: 'code_review', routedVia: 'direct', startedAt: Date.now() },
 *     args,
 *     handleComprehensiveCodeReview,
 *   );
 */

import type {
  PolicyContext,
  PolicyDecisionTrace,
  NormalizedToolResponse,
} from './types.js';
import { sanitizeUniversalResponse } from './sanitize.js';
import { deriveVerifyMode } from './classifiers.js';
import { internalVerifyAdapter } from './verify-adapter.js';
import { normalizeToolResult } from './normalize.js';
import { policyLogger } from './logger.js';
import { handleGuard } from '../tools/guard.js';
import type { GuardResult } from '../tools/guard.js';

/** Tools that must NOT be auto-guarded (self-guard loop prevention) */
const GUARD_EXEMPT_TOOLS = new Set(['guard', 'memory']);

/** Skip guard for responses larger than this (avoid serialization cost) */
const GUARD_MAX_RESPONSE_BYTES = 50_000;

export async function runToolWithPolicy<TArgs, TResult>(
  ctx: PolicyContext,
  args: TArgs,
  handler: (args: TArgs) => Promise<TResult>,
): Promise<NormalizedToolResponse<TResult>> {
  const trace: PolicyDecisionTrace = {
    sanitized: false,
    verifyTriggered: false,
    verifyMode: null,
    normalizedShape: false,
  };

  let raw: TResult;
  let handlerError: string | undefined;

  // ── 1. Execute ────────────────────────────────────────────────────────────
  try {
    raw = await handler(args);
  } catch (err) {
    handlerError = err instanceof Error ? err.message : String(err);
    raw = {
      success: false,
      error: handlerError,
      // Strip stack traces from the error that surfaces to the client
      ...(process.env.NODE_ENV === 'development' && err instanceof Error
        ? { stack: err.stack }
        : {}),
    } as unknown as TResult;
  }

  // ── 2. Sanitize ───────────────────────────────────────────────────────────
  let sanitized = sanitizeUniversalResponse(raw);
  trace.sanitized = true;

  // ── 2b. Auto-guard ────────────────────────────────────────────────────────
  // Run guard on every tool response except guard itself and the router.
  // Fail-open: if guard throws, log and continue (never block on infra error).
  let guardResult: GuardResult | undefined;

  if (!GUARD_EXEMPT_TOOLS.has(ctx.toolName) && !handlerError) {
    try {
      const responseText = typeof sanitized === 'string'
        ? sanitized
        : JSON.stringify(sanitized);

      // Skip guard for large responses — serialization + guard call cost not worth it
      if (responseText.length <= GUARD_MAX_RESPONSE_BYTES) {
        guardResult = await handleGuard({
          response: responseText,
          domain: 'auto',
          mode: 'enforce',
          ...(ctx.sessionId ? { session_id: ctx.sessionId } : {}),
        });

        trace.guardTriggered = true;
        trace.guardAction = guardResult.action;
        trace.guardDomain = guardResult.domain_detected;

        // If guard blocked the response, replace BOTH raw and sanitized
        if (guardResult.action === 'blocked') {
          const blocked = {
            success: false,
            error: 'Response blocked by governance guard',
            guard_intervention: guardResult.intervention,
          } as unknown as TResult;
          raw = blocked;
          // Fully replace sanitized to prevent original content leaking via normalizeToolResult
          sanitized = sanitizeUniversalResponse(blocked);
        }
      } else {
        trace.guardTriggered = false;
        trace.guardSkippedLargeResponse = true;
      }
    } catch (guardErr) {
      // Fail-open: log but do not block the response
      trace.guardTriggered = true;
      trace.guardError = true;
      console.error('[policy/guard] Auto-guard error (fail-open):', guardErr);
    }
  }

  // ── 3. Determine if verify should run ────────────────────────────────────
  const verifyMode = deriveVerifyMode(ctx.toolName, sanitized);
  trace.verifyMode = verifyMode;

  // ── 4. Run internal verify if mode is set ─────────────────────────────────
  let verifyInfo: { triggered: boolean; passed?: boolean; output?: unknown } = {
    triggered: false,
  };

  if (verifyMode !== null && !handlerError) {
    trace.verifyTriggered = true;
    const verifyResult = await internalVerifyAdapter(sanitized, verifyMode);
    trace.verifyPassed = verifyResult.passed;
    if (verifyResult.verifyError) trace.verifyError = true;
    verifyInfo = {
      triggered: true,
      passed: verifyResult.passed,
      output: verifyResult.verify_output,
    };
  }

  // ── 5. Normalize ──────────────────────────────────────────────────────────
  // Pass `raw` (original typed result) as the result value so the caller gets
  // the correctly-typed domain object. Pass `sanitized` separately for flag
  // derivation inside normalizeToolResult so it sees clean data.
  const normalized = normalizeToolResult<TResult>(
    ctx.toolName,
    raw,
    sanitized,
    verifyInfo,
    trace,
  );

  if (handlerError) normalized.error = handlerError;

  // Attach guard result summary if guard ran
  if (guardResult) {
    normalized.guard_result = {
      action: guardResult.action,
      domain_detected: guardResult.domain_detected,
      elapsed_ms: guardResult.elapsed_ms,
      ...(guardResult.intervention ? { intervention: guardResult.intervention } : {}),
    };
    // A blocked response is also marked at the envelope level
    if (guardResult.action === 'blocked') {
      normalized.blocked = true;
    }
  }

  // ── 6. Log (one event per call) ───────────────────────────────────────────
  const durationMs = Date.now() - ctx.startedAt;
  policyLogger.log({
    level: handlerError ? 'error' : normalized.blocked ? 'warn' : 'info',
    tool: ctx.toolName,
    routedVia: ctx.routedVia,
    sessionId: ctx.sessionId,
    durationMs,
    verifyTriggered: trace.verifyTriggered,
    verifyPassed: trace.verifyPassed,
    verifyError: trace.verifyError,
    sanitized: trace.sanitized,
    blocked: normalized.blocked ?? false,
    partial: normalized.partial ?? false,
    guardNormalized: trace.guardNormalized ?? false,
    guardTriggered: trace.guardTriggered,
    guardAction: trace.guardAction,
    guardError: trace.guardError,
    ...(handlerError ? { error: handlerError } : {}),
  });

  return normalized;
}
