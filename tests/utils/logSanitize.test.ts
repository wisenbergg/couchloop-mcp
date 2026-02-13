import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to test the sanitize function directly without the logger mock from setup.ts
// So we import the exported sanitizeLogValue
vi.unmock('../../src/utils/logger');

// Manually set env to avoid MCP mode silencing output
const originalEnv = { ...process.env };

describe('sanitizeLogValue', () => {
  beforeEach(() => {
    process.env.MCP_MODE = 'false';
    process.env.LOG_LEVEL = 'DEBUG';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // Dynamic import to get the real module (not mocked)
  async function getSanitize() {
    const mod = await import('../../src/utils/logger.js');
    return mod.sanitizeLogValue;
  }

  it('redacts values under sensitive keys', async () => {
    const sanitize = await getSanitize();
    const result = sanitize({
      username: 'alice',
      token: 'abc123',
      api_key: 'secret-key',
      password: 'hunter2',
    });

    expect(result).toEqual({
      username: 'alice',
      token: '[REDACTED]',
      api_key: '[REDACTED]',
      password: '[REDACTED]',
    });
  });

  it('redacts nested sensitive keys', async () => {
    const sanitize = await getSanitize();
    const result = sanitize({
      user: { name: 'bob' },
      auth: { access_token: 'jwt-value', client_id: 'chatgpt' },
    });

    const typed = result as Record<string, unknown>;
    const auth = typed.auth as Record<string, unknown>;
    expect(auth.access_token).toBe('[REDACTED]');
    expect(auth.client_id).toBe('chatgpt');
  });

  it('redacts Bearer tokens in strings', async () => {
    const sanitize = await getSanitize();
    const result = sanitize('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123');
    expect(result).not.toContain('eyJ');
    expect(result).toContain('Bearer [REDACTED]');
  });

  it('redacts standalone JWTs in strings', async () => {
    const sanitize = await getSanitize();
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = sanitize(`Token is ${jwt} for user`);
    expect(result).not.toContain('eyJ');
    expect(result).toContain('[REDACTED]');
  });

  it('passes through safe strings unchanged', async () => {
    const sanitize = await getSanitize();
    expect(sanitize('hello world')).toBe('hello world');
  });

  it('passes through numbers and booleans unchanged', async () => {
    const sanitize = await getSanitize();
    expect(sanitize(42)).toBe(42);
    expect(sanitize(true)).toBe(true);
  });

  it('handles null and undefined', async () => {
    const sanitize = await getSanitize();
    expect(sanitize(null)).toBeNull();
    expect(sanitize(undefined)).toBeUndefined();
  });

  it('sanitizes arrays recursively', async () => {
    const sanitize = await getSanitize();
    const result = sanitize([
      { secret: 'hidden', name: 'visible' },
      'plain text',
    ]);
    expect(result).toEqual([
      { secret: '[REDACTED]', name: 'visible' },
      'plain text',
    ]);
  });

  it('redacts cookie and credential keys', async () => {
    const sanitize = await getSanitize();
    const result = sanitize({
      cookie: 'session=abc',
      credential: 'pass123',
      safe: 'value',
    });
    expect(result).toEqual({
      cookie: '[REDACTED]',
      credential: '[REDACTED]',
      safe: 'value',
    });
  });

  it('handles authorization header key', async () => {
    const sanitize = await getSanitize();
    const result = sanitize({ authorization: 'Bearer xyz' });
    expect(result).toEqual({ authorization: '[REDACTED]' });
  });
});
