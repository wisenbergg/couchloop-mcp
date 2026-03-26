/**
 * Policy Layer — Shared Types
 *
 * Used by wrapper.ts, normalize.ts, verify-adapter.ts, logger.ts, and classifiers.ts.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tool identity
// ─────────────────────────────────────────────────────────────────────────────

export type PublicToolName =
  | 'memory'
  | 'conversation'
  | 'review'
  | 'status'
  // Internal-only (auto-triggered by policy wrapper, not user-facing)
  | 'guard'
  // Legacy names kept for type compatibility during migration
  | 'couchloop'
  | 'verify'
  | 'brainstorm'
  | 'code_review'
  | 'package_audit'
  | 'remember'
  | 'protect';

// ─────────────────────────────────────────────────────────────────────────────
// Verify / Guard mode
// ─────────────────────────────────────────────────────────────────────────────

/** null means verify is not triggered for this response */
export type VerifyMode = 'code' | 'packages' | 'all' | null;

export type GuardMode = 'enforce' | 'shadow' | 'bypass';

// ─────────────────────────────────────────────────────────────────────────────
// Policy execution context (created per request)
// ─────────────────────────────────────────────────────────────────────────────

export interface PolicyContext {
  toolName: PublicToolName;
  /** 'direct' = MCP client called the tool explicitly
   *  'couchloop' = couchloop intent router delegated to this tool */
  routedVia: 'direct' | 'couchloop';
  sessionId?: string;
  startedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit trace attached to every normalised response
// ─────────────────────────────────────────────────────────────────────────────

export interface PolicyDecisionTrace {
  sanitized: boolean;
  verifyTriggered: boolean;
  verifyMode: VerifyMode;
  /** undefined when verifyTriggered=false */
  verifyPassed?: boolean;
  /** true when verify was triggered but threw an internal error (not a content failure) */
  verifyError?: boolean;
  normalizedShape: boolean;
  /** true when guard MCP-native content envelope was unwrapped */
  guardNormalized?: boolean;
  /** true when guard was auto-triggered by the policy wrapper */
  guardTriggered?: boolean;
  /** guard decision: pass / modified / blocked */
  guardAction?: 'pass' | 'modified' | 'blocked';
  /** domain detected by guard (dev / clinical / unknown) */
  guardDomain?: string;
  /** true when guard itself threw an error (fail-open) */
  guardError?: boolean;
  /** true when guard was skipped due to response size exceeding threshold */
  guardSkippedLargeResponse?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalised response envelope — all public tools return this shape
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalizedToolResponse<TResult = unknown> {
  success: boolean;
  tool: PublicToolName;
  result: TResult;
  /** true for composite tools (code_review, package_audit) when at least one
   *  sub-check failed but the overall operation completed */
  partial?: boolean;
  /** true when protect denied the operation */
  blocked?: boolean;
  /** true when protect requires human approval */
  requires_approval?: boolean;
  /** present when verify was auto-triggered */
  verify_result?: unknown;
  /** present when guard was auto-triggered */
  guard_result?: {
    action: 'pass' | 'modified' | 'blocked';
    domain_detected: string;
    elapsed_ms: number;
    intervention?: { type: string; reason: string; confidence: number };
  };
  policy_trace: PolicyDecisionTrace;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy log event (one per wrapped call)
// ─────────────────────────────────────────────────────────────────────────────

export interface PolicyLogEvent {
  level: 'info' | 'warn' | 'error';
  tool: PublicToolName;
  routedVia: 'direct' | 'couchloop';
  sessionId?: string;
  durationMs: number;
  verifyTriggered: boolean;
  verifyPassed?: boolean;
  /** true when verify itself threw — distinguishes adapter crash from content failure */
  verifyError?: boolean;
  sanitized: boolean;
  blocked: boolean;
  partial: boolean;
  guardNormalized: boolean;
  guardTriggered?: boolean;
  guardAction?: 'pass' | 'modified' | 'blocked';
  guardError?: boolean;
  error?: string;
}
