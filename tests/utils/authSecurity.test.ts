import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { mkdirSync } from 'fs';

// Mock the file system and logger for auth tests
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

const mockedMkdirSync = vi.mocked(mkdirSync);

describe('extractUserFromContext — SHA-256 anonymization', () => {
  beforeEach(() => {
    vi.resetModules();
    mockedMkdirSync.mockReset();
  });

  async function getExtractUser() {
    const mod = await import('../../src/types/auth.js');
    return mod.extractUserFromContext;
  }

  /** Force getOrCreateLocalIdentity to return '' by making mkdirSync throw */
  function disableLocalIdentity() {
    mockedMkdirSync.mockImplementation(() => {
      throw new Error('fs disabled in test');
    });
  }

  it('uses server-verified OAuth identity only for portable IDs (Priority 1)', async () => {
    const extractUser = await getExtractUser();
    const result = await extractUser({
      oauth_authenticated: true,
      oauth_client_id: 'chatgpt',
      oauth_user_id: 'internal-user-123',
      token: 'ignored-by-hash',
    });

    // Cross-client: the identity is keyed off the OAuth user id ONLY (not client_id),
    // so the same human is one identity across MCP clients.
    const expectedHash = createHash('sha256')
      .update('internal-user-123')
      .digest('hex')
      .substring(0, 24);
    expect(result).toBe('oauth_' + expectedHash);
    expect(result).not.toContain('internal-user-123');
  });

  it('does not treat unverified user_id/client_id as portable identity', async () => {
    const extractUser = await getExtractUser();
    const result = await extractUser({
      client_id: 'chatgpt',
      user_id: 'user-abc-123',
      conversation_id: 'conv-123',
    });

    const expectedHash = createHash('sha256')
      .update('chatgpt:conv:conv-123')
      .digest('hex')
      .substring(0, 28);
    expect(result).toBe('conv_' + expectedHash);
  });

  it('hashes thread identity for workspace-scoped continuity (Priority 2)', async () => {
    const extractUser = await getExtractUser();
    const result = await extractUser({
      client_id: 'chatgpt',
      thread_id: 'thread-abc',
    });

    const expectedHash = createHash('sha256')
      .update('chatgpt:thread:thread-abc')
      .digest('hex')
      .substring(0, 24);
    expect(result).toBe('thread_' + expectedHash);
  });

  it('produces deterministic IDs for the same input', async () => {
    const extractUser = await getExtractUser();
    const ctx = { client_id: 'chatgpt', thread_id: 'thread-x' };

    const result1 = await extractUser(ctx);
    const result2 = await extractUser(ctx);
    expect(result1).toBe(result2);
  });

  it('produces different IDs for different inputs', async () => {
    const extractUser = await getExtractUser();

    const result1 = await extractUser({ client_id: 'a', thread_id: 'thread-1' });
    const result2 = await extractUser({ client_id: 'a', thread_id: 'thread-2' });
    expect(result1).not.toBe(result2);
  });

  it('creates a local identity when no auth context and fs works (Priority 4)', async () => {
    // mkdirSync is a no-op (default mock), writeFileSync is a no-op
    // existsSync returns false → creates new local identity
    const extractUser = await getExtractUser();
    const result = await extractUser();
    expect(result).toMatch(/^local_[0-9a-f]{24}$/);
  });

  it('hashes conversation IDs with SHA-256 (Priority 3)', async () => {
    disableLocalIdentity();
    const extractUser = await getExtractUser();
    const result = await extractUser({
      client_id: 'chatgpt',
      conversation_id: 'conv-456',
    });

    const expectedHash = createHash('sha256')
      .update('chatgpt:conv:conv-456')
      .digest('hex')
      .substring(0, 28);
    expect(result).toBe('conv_' + expectedHash);
  });

  it('does not elevate token-only context to oauth_* identity', async () => {
    disableLocalIdentity();
    const extractUser = await getExtractUser();
    const result = await extractUser({ token: 'raw-token-only' });
    expect(result.startsWith('oauth_')).toBe(false);
  });

  it('falls back to ephemeral ID when no context and fs fails', async () => {
    disableLocalIdentity();
    const extractUser = await getExtractUser();
    const result = await extractUser();
    expect(result).toMatch(/^ephemeral_/);
  });
});

describe('resolveAuthContextFromArgs', () => {
  async function getResolve() {
    const mod = await import('../../src/types/auth.js');
    return mod.resolveAuthContextFromArgs;
  }

  it('does not ingest meta.sub as user_id', async () => {
    const resolve = await getResolve();
    const result = resolve({ _meta: { sub: 'portable-subject' } });
    expect(result?.user_id).toBeUndefined();
  });

  it('keeps explicit oauth verification flags from auth object', async () => {
    const resolve = await getResolve();
    const result = resolve({
      auth: {
        oauth_authenticated: true,
        oauth_user_id: 'u-1',
        oauth_client_id: 'chatgpt',
      },
    });

    expect(result).toMatchObject({
      oauth_authenticated: true,
      oauth_user_id: 'u-1',
      oauth_client_id: 'chatgpt',
    });
  });
});

describe('getIdentityScope', () => {
  async function getScope() {
    const mod = await import('../../src/types/auth.js');
    return mod.getIdentityScope;
  }

  it('classifies oauth_ as oauth_portable', async () => {
    const getIdentityScope = await getScope();
    expect(getIdentityScope('oauth_abc123')).toBe('oauth_portable');
  });

  it('classifies thread_ and conv_ as workspace_scoped', async () => {
    const getIdentityScope = await getScope();
    expect(getIdentityScope('thread_abc123')).toBe('workspace_scoped');
    expect(getIdentityScope('conv_abc123')).toBe('workspace_scoped');
  });
});

describe('getUserTier', () => {
  async function getTier() {
    const mod = await import('../../src/types/auth.js');
    return mod.getUserTier;
  }

  it('detects pro tier from oauth_ prefix', async () => {
    const getUserTier = await getTier();
    expect(getUserTier('oauth_abc123')).toBe('pro');
  });

  it('detects free tier from local_ prefix', async () => {
    const getUserTier = await getTier();
    expect(getUserTier('local_abc123')).toBe('free');
  });

  it('detects ephemeral tier', async () => {
    const getUserTier = await getTier();
    expect(getUserTier('ephemeral_abc123')).toBe('ephemeral');
  });

  it('defaults unknown prefixes to free', async () => {
    const getUserTier = await getTier();
    expect(getUserTier('chatgpt_abc123')).toBe('free');
  });
});
