import { describe, it, expect, vi } from 'vitest';

// Control the fake Supabase client returned to the code under test.
const fake: { current: unknown } = { current: null };

vi.mock('../../src/db/supabase-helpers.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/db/supabase-helpers.js')>();
  return {
    ...actual,
    getSupabaseClientAsync: async () => fake.current,
    getSupabaseClient: () => fake.current,
  };
});

// Make external-user resolution trivial: external id == the auth.user_id we pass in.
vi.mock('../../src/types/auth.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/types/auth.js')>();
  return {
    ...actual,
    extractUserFromContext: async (ctx: { user_id?: string } | undefined) => ctx?.user_id ?? 'anon',
  };
});

import { resolveOwnedSession } from '../../src/tools/session-manager';

/** Fake Supabase: users keyed by external_id; sessions with a single owner. */
function fakeSupabase(opts: {
  usersByExternal: Record<string, string>;
  sessionOwner: Record<string, string>;
}) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        maybeSingle: () => {
          if (table === 'users') {
            const id = opts.usersByExternal[filters.external_id as string];
            return Promise.resolve({ data: id ? { id } : null, error: null });
          }
          if (table === 'sessions') {
            const owner = opts.sessionOwner[filters.id as string];
            const ownedByCaller = owner !== undefined && owner === filters.user_id;
            return Promise.resolve({
              data: ownedByCaller ? { id: filters.id, user_id: owner } : null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
}

describe('resolveOwnedSession — per-user isolation (RLS is service-role bypassed)', () => {
  it("returns null when the session belongs to a DIFFERENT user", async () => {
    fake.current = fakeSupabase({
      usersByExternal: { extA: 'userA', extB: 'userB' },
      sessionOwner: { sessB: 'userB' },
    });
    // User A asks for user B's session id → must NOT get it.
    const result = await resolveOwnedSession('sessB', { user_id: 'extA' });
    expect(result).toBeNull();
  });

  it('returns the session for its rightful owner', async () => {
    fake.current = fakeSupabase({
      usersByExternal: { extB: 'userB' },
      sessionOwner: { sessB: 'userB' },
    });
    const result = await resolveOwnedSession('sessB', { user_id: 'extB' });
    expect(result).toMatchObject({ id: 'sessB', user_id: 'userB' });
  });

  it('returns null when the caller has no user record', async () => {
    fake.current = fakeSupabase({
      usersByExternal: {},
      sessionOwner: { sessB: 'userB' },
    });
    const result = await resolveOwnedSession('sessB', { user_id: 'ghost' });
    expect(result).toBeNull();
  });
});
