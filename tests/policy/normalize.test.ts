import { describe, it, expect } from 'vitest';
import { normalizeToolResult } from '../../src/policy/normalize.js';
import type { PolicyDecisionTrace } from '../../src/policy/types.js';

// Minimal valid trace used across tests
function makeTrace(overrides: Partial<PolicyDecisionTrace> = {}): PolicyDecisionTrace {
  return {
    sanitized: true,
    verifyTriggered: false,
    normalizedShape: false,
    ...overrides,
  };
}

const NO_VERIFY = { triggered: false };
const VERIFY_PASSED = { triggered: true, passed: true, output: { verified: true } };
const VERIFY_FAILED = { triggered: true, passed: false, output: { verified: false, issues: ['hallucinated package'] } };

// ─────────────────────────────────────────────────────────────────────────────
// Basic shape
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeToolResult — basic shape', () => {
  it('returns success=true for a clean result', () => {
    const raw = { success: true, data: 'hello' };
    const sanitized = { success: true, data: 'hello' };
    const out = normalizeToolResult('brainstorm', raw, sanitized, NO_VERIFY, makeTrace());
    expect(out.success).toBe(true);
    expect(out.tool).toBe('brainstorm');
    expect(out.result).toBe(raw);         // original typed object, not sanitized copy
  });

  it('always returns the original typed raw as .result (no erasure)', () => {
    const raw = { success: true, items: [1, 2, 3] };
    const sanitized = { success: true };  // different/stripped
    const out = normalizeToolResult('code_review', raw, sanitized, NO_VERIFY, makeTrace());
    expect(out.result).toBe(raw);
    expect((out.result as typeof raw).items).toEqual([1, 2, 3]);
  });

  it('sets trace.normalizedShape to true', () => {
    const trace = makeTrace();
    normalizeToolResult('brainstorm', {}, {}, NO_VERIFY, trace);
    expect(trace.normalizedShape).toBe(true);
  });

  it('includes policy_trace in the output', () => {
    const trace = makeTrace();
    const out = normalizeToolResult('brainstorm', {}, {}, NO_VERIFY, trace);
    expect(out.policy_trace).toBe(trace);  // same reference (mutated in-place)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Verify integration
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeToolResult — verify integration', () => {
  it('verify not triggered → no verify_result field', () => {
    const out = normalizeToolResult('brainstorm', { success: true }, { success: true }, NO_VERIFY, makeTrace());
    expect(out).not.toHaveProperty('verify_result');
  });

  it('verify triggered and passed → success=true, verify_result present', () => {
    const out = normalizeToolResult('code_review', { success: true }, { success: true }, VERIFY_PASSED, makeTrace());
    expect(out.success).toBe(true);
    expect(out.verify_result).toEqual({ verified: true });
  });

  it('verify triggered and failed → success=false, verify_result present', () => {
    const out = normalizeToolResult('package_audit', { success: true }, { success: true }, VERIFY_FAILED, makeTrace());
    expect(out.success).toBe(false);
    expect(out.verify_result).toBeDefined();
  });

  it('verify failed on already-failed result → success stays false', () => {
    const raw = { success: false, error: 'handler error' };
    const out = normalizeToolResult('brainstorm', raw, raw, VERIFY_FAILED, makeTrace());
    expect(out.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Blocked / approval / partial / error flags
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeToolResult — flag derivation', () => {
  it('blocked protect result → blocked=true, success=false', () => {
    const blocked = { success: false, allowed: false, violations: ['path outside root'] };
    const out = normalizeToolResult('protect', blocked, blocked, NO_VERIFY, makeTrace());
    expect(out.blocked).toBe(true);
    expect(out.success).toBe(false);
  });

  it('requires_approval result → requires_approval=true', () => {
    const approval = { success: false, requires_approval: true };
    const out = normalizeToolResult('protect', approval, approval, NO_VERIFY, makeTrace());
    expect(out.requires_approval).toBe(true);
  });

  it('partial success → partial=true', () => {
    const partial = { success: true, partial: true, completed: 3, total: 5 };
    const out = normalizeToolResult('code_review', partial, partial, NO_VERIFY, makeTrace());
    expect(out.partial).toBe(true);
    expect(out.success).toBe(true);
  });

  it('plain error result → error field populated', () => {
    const errResult = { success: false, error: 'something went wrong' };
    const out = normalizeToolResult('brainstorm', errResult, errResult, NO_VERIFY, makeTrace());
    expect(out.error).toBe('something went wrong');
    expect(out.success).toBe(false);
  });

  it('no special shape → success defaults to true when success field absent', () => {
    const plain = { data: 'ok' };
    const out = normalizeToolResult('brainstorm', plain, plain, NO_VERIFY, makeTrace());
    expect(out.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Guard MCP-native envelope unwrapping
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeToolResult — guard MCP-native envelope', () => {
  it('unwraps a guard MCP content envelope and sets guardNormalized=true', () => {
    const payload = { action: 'pass', score: 0.9 };
    const envelope = { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    const trace = makeTrace();
    const out = normalizeToolResult('guard', envelope, {}, NO_VERIFY, trace);
    expect(trace.guardNormalized).toBe(true);
    // result should be the unwrapped payload
    expect((out.result as typeof payload).action).toBe('pass');
  });

  it('handles malformed JSON inside guard envelope gracefully', () => {
    const envelope = { content: [{ type: 'text', text: 'not-json{{' }] };
    const trace = makeTrace();
    const out = normalizeToolResult('guard', envelope, {}, NO_VERIFY, trace);
    expect(trace.guardNormalized).toBe(true);
    expect(out.result).toHaveProperty('raw', 'not-json{{');
  });

  it('non-guard tool with content array → NOT treated as guard envelope', () => {
    const result = { content: [{ type: 'text', text: 'some text' }] };
    const trace = makeTrace();
    normalizeToolResult('brainstorm', result, result, NO_VERIFY, trace);
    expect(trace.guardNormalized).toBeFalsy();
  });
});
