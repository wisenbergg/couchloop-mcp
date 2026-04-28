/**
 * Tests for the memory tool's session-scoping invariants.
 *
 * Bug history:
 *   - `list` and `recall` used to scope by the auto-created session id, so
 *     a fresh implicit session always returned 0 insights even when the user
 *     had insights saved on prior sessions.
 *   - Fixed: only narrow by session_id when the caller explicitly provides one.
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// IMPORTANT: mock collaborators BEFORE importing the module under test.
vi.mock('../../src/tools/insight.js', () => ({
  recallInsights: vi.fn(),
  getInsights: vi.fn(),
}));

vi.mock('../../src/tools/checkpoint.js', () => ({
  getCheckpoints: vi.fn(),
}));

vi.mock('../../src/tools/session-manager.js', () => ({
  getOrCreateSession: vi.fn(),
  endSession: vi.fn(),
  startStaleSessionSweep: vi.fn(),
}));

vi.mock('../../src/tools/smart-context.js', () => ({
  handleSmartContext: vi.fn(),
}));

vi.mock('../../src/policy/index.js', () => ({
  runToolWithPolicy: vi.fn((_ctx, args, handler) => handler(args)),
}));

vi.mock('../../src/db/supabase-helpers.js', () => ({
  getSupabaseClientAsync: vi.fn().mockResolvedValue({}),
}));

import { memoryTool } from '../../src/tools/primary-tools.js';
import { recallInsights, getInsights } from '../../src/tools/insight.js';
import { getCheckpoints } from '../../src/tools/checkpoint.js';
import { getOrCreateSession } from '../../src/tools/session-manager.js';
import { handleSmartContext } from '../../src/tools/smart-context.js';

const AUTO_SESSION = 'auto-session-aaaaaaaaaaaaaaaaaaaa';
const EXPLICIT_SESSION = 'caller-session-bbbbbbbbbbbbbbbbbb';

beforeEach(() => {
  vi.clearAllMocks();

  (getOrCreateSession as Mock).mockResolvedValue({
    sessionId: AUTO_SESSION,
    session: { id: AUTO_SESSION, status: 'active' },
    isNew: true,
  });

  (recallInsights as Mock).mockResolvedValue({ insights: [], count: 0 });
  (getInsights as Mock).mockResolvedValue({ insights: [], count: 0 });
  (getCheckpoints as Mock).mockResolvedValue({ checkpoints: [] });
  (handleSmartContext as Mock).mockResolvedValue({ success: true });
});

describe('memoryTool — list', () => {
  it('does NOT scope to the auto-created session when no session_id is supplied', async () => {
    await memoryTool.handler({ action: 'list' });

    expect(getInsights).toHaveBeenCalledTimes(1);
    const callArgs = (getInsights as Mock).mock.calls[0][0];
    expect(callArgs.session_id).toBeUndefined();
    expect(callArgs.limit).toBe(20);
  });

  it('honors an explicit session_id when supplied', async () => {
    await memoryTool.handler({ action: 'list', session_id: EXPLICIT_SESSION });

    expect(getInsights).toHaveBeenCalledTimes(1);
    const callArgs = (getInsights as Mock).mock.calls[0][0];
    expect(callArgs.session_id).toBe(EXPLICIT_SESSION);
  });

  it('does not attach session_context / onboarding_hint to list responses', async () => {
    (getInsights as Mock).mockResolvedValue({
      insights: [{ content: 'old note', tags: [], created_at: '2025-01-01' }],
      count: 1,
    });

    const result = await memoryTool.handler({ action: 'list' }) as Record<string, unknown>;
    expect(result.session_context).toBeUndefined();
    expect(result.count).toBe(1);
  });
});

describe('memoryTool — recall', () => {
  it('does NOT scope insights to the auto-created session when no session_id is supplied', async () => {
    await memoryTool.handler({ action: 'recall' });

    expect(recallInsights).toHaveBeenCalledTimes(1);
    const callArgs = (recallInsights as Mock).mock.calls[0][0];
    expect(callArgs.session_id).toBeUndefined();
  });

  it('does NOT fetch checkpoints when no session_id is supplied', async () => {
    await memoryTool.handler({ action: 'recall' });
    expect(getCheckpoints).not.toHaveBeenCalled();
  });

  it('scopes both insights and checkpoints to an explicit session_id', async () => {
    await memoryTool.handler({ action: 'recall', session_id: EXPLICIT_SESSION });

    const recallArgs = (recallInsights as Mock).mock.calls[0][0];
    expect(recallArgs.session_id).toBe(EXPLICIT_SESSION);
    expect(getCheckpoints).toHaveBeenCalledTimes(1);
    const cpArgs = (getCheckpoints as Mock).mock.calls[0][0];
    expect(cpArgs.session_id).toBe(EXPLICIT_SESSION);
  });

  it('forwards a content query string for ilike matching', async () => {
    await memoryTool.handler({ action: 'recall', content: 'crisis' });
    const recallArgs = (recallInsights as Mock).mock.calls[0][0];
    expect(recallArgs.query).toBe('crisis');
  });
});

describe('memoryTool — save', () => {
  it('attaches previous_context on a new session when prior insights exist', async () => {
    (recallInsights as Mock).mockResolvedValue({
      insights: [{ content: 'prior decision', tags: ['decision'], created_at: '2025-01-01' }],
      count: 1,
    });

    const result = await memoryTool.handler({
      action: 'save',
      content: 'Today we shipped the fix',
    }) as Record<string, unknown>;

    const ctx = result.session_context as Record<string, unknown> | undefined;
    expect(ctx).toBeDefined();
    expect(ctx?.new_session).toBe(true);
    expect(ctx?.previous_context).toBeDefined();
    expect(ctx?.onboarding_hint).toBeUndefined();
  });

  it('shows onboarding_hint only when truly new with no prior insights', async () => {
    (recallInsights as Mock).mockResolvedValue({ insights: [], count: 0 });

    const result = await memoryTool.handler({
      action: 'save',
      content: 'first save',
    }) as Record<string, unknown>;

    const ctx = result.session_context as Record<string, unknown> | undefined;
    expect(ctx?.onboarding_hint).toBeDefined();
  });

  it('does not auto-recall when isNew=false', async () => {
    (getOrCreateSession as Mock).mockResolvedValue({
      sessionId: AUTO_SESSION,
      session: { id: AUTO_SESSION, status: 'active' },
      isNew: false,
    });

    const result = await memoryTool.handler({
      action: 'save',
      content: 'returning save',
    }) as Record<string, unknown>;

    expect(result.session_context).toBeUndefined();
    // Auto-recall block should not have run
    expect(recallInsights).not.toHaveBeenCalled();
  });
});

describe('memoryTool — auth resolution', () => {
  it('passes resolved auth context through to recallInsights', async () => {
    await memoryTool.handler({
      action: 'recall',
      auth: { user_id: 'u1', client_id: 'chatgpt' },
    });

    const args = (recallInsights as Mock).mock.calls[0][0];
    expect(args.auth).toMatchObject({ user_id: 'u1', client_id: 'chatgpt' });
  });
});
