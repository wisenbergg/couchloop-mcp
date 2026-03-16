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
  const sanitized = sanitizeUniversalResponse(raw);
  trace.sanitized = true;

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
    ...(handlerError ? { error: handlerError } : {}),
  });

  return normalized;
}
