import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSupabaseClientMock,
  throwOnErrorMock,
  getUserContextMock,
} = vi.hoisted(() => ({
  getSupabaseClientMock: vi.fn(),
  throwOnErrorMock: vi.fn((result: { data: unknown; error: { message: string } | null }) => {
    if (result.error) {
      throw new Error(result.error.message);
    }
    return result.data;
  }),
  getUserContextMock: vi.fn(),
}));

vi.mock('../../src/db/supabase-helpers.js', () => ({
  getSupabaseClient: getSupabaseClientMock,
  throwOnError: throwOnErrorMock,
}));

vi.mock('../../src/workflows/engine.js', () => ({
  WorkflowEngine: class {
    async getSessionProgress() {
      return { currentStep: 1, totalSteps: 1, percentComplete: 100 };
    }
  },
}));

vi.mock('../../src/tools/preserve-context.js', () => ({
  checkContextStatus: vi.fn().mockResolvedValue({ data: {} }),
  retrieveContext: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/tools/protect-files.js', () => ({
  getProtectionStatus: vi.fn().mockResolvedValue({ codeFreezeEnabled: false, protectedFiles: 0 }),
  listBackups: vi.fn().mockResolvedValue({ backups: [] }),
}));

vi.mock('../../src/tools/insight.js', () => ({
  getUserContext: getUserContextMock,
}));

import { handleStatus } from '../../src/tools/status.js';

function buildUserLookupClient(userId: string | null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: userId ? { id: userId } : null,
            error: null,
          }),
        })),
      })),
    })),
  };
}

describe('status tool identity section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserContextMock.mockResolvedValue({ preferences: {} });
  });

  it('returns workspace-scoped identity with upgrade guidance for unauthenticated users', async () => {
    getSupabaseClientMock.mockReturnValue(buildUserLookupClient(null));

    const result = await handleStatus({
      check: 'all',
      auth: {
        client_id: 'chatgpt',
        thread_id: 'thread-1',
      },
    }) as Record<string, unknown>;

    expect(result.success).toBe(true);
    const identity = result.identity as Record<string, unknown>;
    expect(identity.scope).toBe('workspace_scoped');
    expect(identity.continuity).toBe('workspace-scoped-only');
    expect(identity.upgrade).toBeDefined();

    const signals = identity.signals as Record<string, unknown>;
    expect(signals.has_oauth_auth).toBe(false);
    expect(signals.has_thread_id).toBe(true);
    expect(signals.has_conversation_id).toBe(false);
  });

  it('returns oauth-portable identity without upgrade prompt for authenticated users', async () => {
    getSupabaseClientMock.mockReturnValue(buildUserLookupClient('user-123'));
    getUserContextMock.mockResolvedValue({
      preferences: { timezone: 'UTC', preferredJourneyLength: 'short' },
    });

    const result = await handleStatus({
      check: 'preferences',
      auth: {
        oauth_authenticated: true,
        oauth_user_id: 'internal-user-1',
        oauth_client_id: 'chatgpt',
      },
    }) as Record<string, unknown>;

    expect(result.success).toBe(true);
    const identity = result.identity as Record<string, unknown>;
    expect(identity.scope).toBe('oauth_portable');
    expect(identity.continuity).toBe('cross-workspace-and-session');
    expect(identity.upgrade).toBeUndefined();

    const signals = identity.signals as Record<string, unknown>;
    expect(signals.has_oauth_auth).toBe(true);
  });
});
