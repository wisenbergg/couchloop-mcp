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

  it('hashes OAuth tokens with SHA-256 (Priority 1)', async () => {
    const extractUser = await getExtractUser();
    const token = 'my-secret-oauth-token';
    const result = await extractUser({ token });

    // Should produce a deterministic SHA-256 prefix
    const expectedHash = createHash('sha256').update(token).digest('hex').substring(0, 24);
    expect(result).toBe('oauth_' + expectedHash);
    // Must NOT contain the raw token
    expect(result).not.toContain(token);
  });

  it('hashes client_id + user_id with SHA-256 (Priority 2)', async () => {
    const extractUser = await getExtractUser();
    const result = await extractUser({
      client_id: 'chatgpt',
      user_id: 'user-abc-123',
    });

    const expectedHash = createHash('sha256')
      .update('chatgpt:user-abc-123')
      .digest('hex')
      .substring(0, 24);
    expect(result).toBe('chatgpt_' + expectedHash);
    // Must NOT contain the raw user_id
    expect(result).not.toContain('user-abc-123');
  });

  it('produces deterministic IDs for the same input', async () => {
    const extractUser = await getExtractUser();
    const ctx = { client_id: 'claude', user_id: 'user-xyz' };

    const result1 = await extractUser(ctx);
    const result2 = await extractUser(ctx);
    expect(result1).toBe(result2);
  });

  it('produces different IDs for different inputs', async () => {
    const extractUser = await getExtractUser();

    const result1 = await extractUser({ client_id: 'a', user_id: 'user1' });
    const result2 = await extractUser({ client_id: 'a', user_id: 'user2' });
    expect(result1).not.toBe(result2);
  });

  it('creates a local identity when no auth context and fs works (Priority 3)', async () => {
    // mkdirSync is a no-op (default mock), writeFileSync is a no-op
    // existsSync returns false → creates new local identity
    const extractUser = await getExtractUser();
    const result = await extractUser();
    expect(result).toMatch(/^local_[0-9a-f]{24}$/);
  });

  it('hashes conversation IDs with SHA-256 (Priority 4)', async () => {
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

  it('falls back to ephemeral ID when no context and fs fails', async () => {
    disableLocalIdentity();
    const extractUser = await getExtractUser();
    const result = await extractUser();
    expect(result).toMatch(/^ephemeral_/);
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
