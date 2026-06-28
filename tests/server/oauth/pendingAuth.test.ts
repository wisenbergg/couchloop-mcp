import { describe, it, expect } from 'vitest';
import { newNonce, buildPendingRow } from '../../../src/server/oauth/pendingAuth';

describe('pendingAuth helpers', () => {
  it('newNonce is 64 hex chars and unique', () => {
    const a = newNonce();
    const b = newNonce();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('buildPendingRow sets a 10-minute expiry and carries params', () => {
    const now = new Date('2026-06-27T00:00:00Z');
    const row = buildPendingRow('nonce1', { client_id: 'c', redirect_uri: 'https://x' }, 'anonA', true, now);
    expect(row.nonce).toBe('nonce1');
    expect(row.anon_user_id).toBe('anonA');
    expect(row.anon_has_data).toBe(true);
    expect(new Date(row.expires_at).getTime() - now.getTime()).toBe(10 * 60 * 1000);
  });
});
