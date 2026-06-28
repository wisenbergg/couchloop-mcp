import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SSO_SENTINEL_CLIENT_ID, subjectHashFor, anonHasData } from '../../../src/server/oauth/ssoIdentity';

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

describe('anonHasData', () => {
  it('is true when a session row exists', async () => {
    const supabase = fakeSupabase({ sessions: 1, insights: 0 });
    expect(await anonHasData(supabase, 'u1')).toBe(true);
  });
  it('is true when an insights row exists', async () => {
    const supabase = fakeSupabase({ sessions: 0, insights: 1 });
    expect(await anonHasData(supabase, 'u1')).toBe(true);
  });
  it('is false when the user owns nothing', async () => {
    const supabase = fakeSupabase({ sessions: 0, insights: 0 });
    expect(await anonHasData(supabase, 'u1')).toBe(false);
  });
});

// Minimal stub: each table query resolves to { data, error } with `count` rows.
function fakeSupabase(counts: Record<string, number>): SupabaseClient {
  const client = {
    from(table: string) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        limit() {
          return Promise.resolve({ data: counts[table] > 0 ? [{ id: 'x' }] : [], error: null });
        },
      };
    },
  };
  return client as unknown as SupabaseClient;
}
