import { describe, it, expect, beforeAll } from 'vitest';
import { SSO_SENTINEL_CLIENT_ID, subjectHashFor } from '../../../src/server/oauth/ssoIdentity';

describe('sso identity primitives', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
  });

  it('sentinel is the reserved literal', () => {
    expect(SSO_SENTINEL_CLIENT_ID).toBe('__sso__');
  });

  it('subjectHashFor is deterministic, keyed, and hides the raw id', () => {
    const a = subjectHashFor('supabase-user-123');
    const b = subjectHashFor('supabase-user-123');
    const c = subjectHashFor('supabase-user-999');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toContain('supabase-user-123');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
