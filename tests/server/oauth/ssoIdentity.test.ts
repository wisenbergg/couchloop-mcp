import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SSO_SENTINEL_CLIENT_ID,
  subjectHashFor,
  anonHasData,
  resolveSupabaseIdentity,
  isReservedClientId,
  type IdentityStore,
} from '../../../src/server/oauth/ssoIdentity';

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

describe('reserved client id guard', () => {
  it('flags the sentinel', () => {
    expect(isReservedClientId('__sso__')).toBe(true);
    expect(isReservedClientId('mcp_123')).toBe(false);
  });
});

describe('resolveSupabaseIdentity', () => {
  const HASH = 'deadbeef';

  it('MISS + empty anon → silent adopt onto the anon user', async () => {
    const db = fakeDb({ existing: null });
    const r = await resolveSupabaseIdentity(db, HASH, 'anonA', 'mcp_x', { anonHasData: false });
    expect(r).toEqual({ status: 'resolved', userId: 'anonA' });
    expect(db.links).toContainEqual({
      client_id: '__sso__', issuer: 'supabase', subject_hash: HASH, user_id: 'anonA',
    });
  });

  it('MISS + anon has data + no consent → needs_merge_confirmation', async () => {
    const db = fakeDb({ existing: null });
    const r = await resolveSupabaseIdentity(db, HASH, 'anonA', 'mcp_x', { anonHasData: true });
    expect(r).toEqual({ status: 'needs_merge_confirmation' });
  });

  it('MISS + consent=adopt → adopts the anon user', async () => {
    const db = fakeDb({ existing: null });
    const r = await resolveSupabaseIdentity(db, HASH, 'anonA', 'mcp_x', { anonHasData: true, consent: 'adopt' });
    expect(r).toEqual({ status: 'resolved', userId: 'anonA' });
  });

  it('MISS + consent=decline → canonical SSO user, anon untouched', async () => {
    const db = fakeDb({ existing: null });
    const r = await resolveSupabaseIdentity(db, HASH, 'anonA', 'mcp_x', { anonHasData: true, consent: 'decline' });
    expect(r).toEqual({ status: 'resolved', userId: 'sso:deadbeef' });
    expect(db.links.some((l) => l.user_id === 'anonA')).toBe(false);
  });

  it('null candidate → canonical SSO user, never adopts null', async () => {
    const db = fakeDb({ existing: null });
    const r = await resolveSupabaseIdentity(db, HASH, null, 'mcp_x', { anonHasData: false });
    expect(r).toEqual({ status: 'resolved', userId: 'sso:deadbeef' });
  });

  it('HIT + differing anon with data → conflict + orphan row', async () => {
    const db = fakeDb({ existing: 'ssoUser' });
    const r = await resolveSupabaseIdentity(db, HASH, 'anonA', 'mcp_x', { anonHasData: true });
    expect(r).toEqual({ status: 'conflict', anonUserId: 'anonA', ssoUserId: 'ssoUser' });
    expect(db.orphans).toContainEqual({ anon_user_id: 'anonA', sso_user_id: 'ssoUser', client_id: 'mcp_x' });
  });

  it('consent=adopt that LOSES the race → resolved to existing + orphan recorded', async () => {
    const db = fakeDb({ existing: null, raceWinner: 'ssoUser' });
    const r = await resolveSupabaseIdentity(db, HASH, 'anonA', 'mcp_x', { anonHasData: true, consent: 'adopt' });
    expect(r).toEqual({ status: 'resolved', userId: 'ssoUser' });
    expect(db.orphans).toContainEqual({ anon_user_id: 'anonA', sso_user_id: 'ssoUser', client_id: 'mcp_x' });
  });
});

// In-memory IdentityStore for resolver tests.
interface FakeDb extends IdentityStore {
  links: Array<Record<string, string>>;
  orphans: Array<Record<string, string>>;
}
function fakeDb(opts: { existing: string | null; raceWinner?: string }): FakeDb {
  return {
    links: [],
    orphans: [],
    async findSsoLink() {
      return opts.existing;
    },
    async getOrCreateUser(externalId: string) {
      return externalId; // 'sso:<hash>' echoes back
    },
    async insertSsoLinkIfAbsent(hash: string, userId: string) {
      const winner = opts.raceWinner ?? userId;
      this.links.push({ client_id: '__sso__', issuer: 'supabase', subject_hash: hash, user_id: winner });
      return winner;
    },
    async insertOrphanIfAbsent(anon: string, sso: string, clientId: string) {
      this.orphans.push({ anon_user_id: anon, sso_user_id: sso, client_id: clientId });
    },
  };
}

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
