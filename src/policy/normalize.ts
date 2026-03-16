/**
 * Policy Layer — Result Normaliser
 *
 * Converts raw tool handler output into the shared NormalizedToolResponse
 * envelope. Handles:
 *
 * - Guard MCP-native output { content: [{ type: 'text', text }] } → unwrap
 * - Guard GuardResult plain objects (already returned by src/tools/guard.ts)
 * - Protect blocked / requires_approval shapes
 * - Composite partial results (code_review, package_audit)
 * - Error objects
 */

import type { NormalizedToolResponse, PublicToolName, PolicyDecisionTrace } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Guard output detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when the value looks like the MCP-native content envelope
 * that registerGuardTool used to emit:
 *   { content: [{ type: 'text', text: '<JSON>' }] }
 */
function isMcpNativeGuardEnvelope(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.content) || v.content.length === 0) return false;
  const first = v.content[0] as Record<string, unknown>;
  return first.type === 'text' && typeof first.text === 'string';
}

function unwrapMcpNativeGuard(value: unknown): Record<string, unknown> {
  const v = value as Record<string, unknown>;
  const content = v.content as Array<Record<string, unknown>>;
  const first = content[0];
  if (!first) return {};
  try {
    return JSON.parse(first.text as string) as Record<string, unknown>;
  } catch {
    return { raw: first.text };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shape classifiers
// ─────────────────────────────────────────────────────────────────────────────

function isBlockedProtect(result: Record<string, unknown>): boolean {
  return result.success === false && result.allowed === false && Array.isArray(result.violations);
}

function isApprovalRequired(result: Record<string, unknown>): boolean {
  return result.success === false && result.requires_approval === true;
}

function isPartialSuccess(result: Record<string, unknown>): boolean {
  return result.success === true && result.partial === true;
}

function isPlainError(result: Record<string, unknown>): boolean {
  return result.success === false && typeof result.error === 'string';
}

// ─────────────────────────────────────────────────────────────────────────────
// Normaliser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise a raw handler result + verify info into NormalizedToolResponse.
 *
 * @param toolName   Tool that produced the result
 * @param raw        The original typed result from the handler (used as .result)
 * @param sanitized  The sanitized/clean copy (used for flag derivation only)
 * @param verifyInfo Optional result from internalVerifyAdapter
 * @param trace      Partial trace accumulated so far. NOTE: intentionally mutated
 *                   in-place so wrapper.ts and policyLogger see the same object.
 */
export function normalizeToolResult<TResult = unknown>(
  toolName: PublicToolName,
  raw: TResult,
  sanitized: Record<string, unknown>,
  verifyInfo: { triggered: boolean; passed?: boolean; output?: unknown },
  trace: PolicyDecisionTrace,
): NormalizedToolResponse<TResult> {
  // NOTE: `trace` is intentionally mutated so the same object is shared with
  // wrapper.ts and policyLogger — consumers should treat it as write-once.
  trace.normalizedShape = true;

  let unwrapped: Record<string, unknown>;
  let guardNormalized = false;

  // ── Unwrap guard MCP-native envelope (legacy path) ───────────────────────
  // Use `sanitized` for shape detection (it's always a plain object).
  if (toolName === 'guard' && isMcpNativeGuardEnvelope(raw)) {
    unwrapped = unwrapMcpNativeGuard(raw);
    guardNormalized = true;
  } else {
    // Use sanitized for flag derivation; it's always a plain object.
    unwrapped = sanitized;
  }

  trace.guardNormalized = guardNormalized;

  // ── Determine top-level flags ─────────────────────────────────────────────
  const isBlocked = isBlockedProtect(unwrapped);
  const needsApproval = isApprovalRequired(unwrapped);
  const isPartial = isPartialSuccess(unwrapped);
  const isError = isPlainError(unwrapped);

  const success =
    !isBlocked &&
    !needsApproval &&
    !isError &&
    (typeof unwrapped.success === 'boolean' ? unwrapped.success : true);

  // ── Verify integration ────────────────────────────────────────────────────
  // If verify was triggered and found issues, force success=false so the
  // caller knows the content needs review before presenting.
  const effectiveSuccess =
    success && verifyInfo.triggered && verifyInfo.passed === false ? false : success;

  const base: NormalizedToolResponse<TResult> = {
    success: effectiveSuccess,
    tool: toolName,
    // Always return the original typed `raw` result so callers get the correct
    // domain shape. For the guard MCP-native legacy path, use the unwrapped form.
    result: (guardNormalized ? (unwrapped as unknown as TResult) : raw),
    policy_trace: trace,
  };

  if (isBlocked) base.blocked = true;
  if (needsApproval) base.requires_approval = true;
  if (isPartial) base.partial = true;
  if (isError) base.error = unwrapped.error as string;

  if (verifyInfo.triggered) {
    base.verify_result = verifyInfo.output;
  }

  return base;
}
