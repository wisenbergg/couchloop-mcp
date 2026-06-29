import { describe, expect, it } from 'vitest';
import {
  normalizeAllowedScopes,
  resolveGrantedScope,
  sanitizeScopeTokens,
  splitScopeString,
} from '../../../src/server/oauth/scopePolicy';

describe('scopePolicy — clamp (no reject) for noisy MCP clients', () => {
  it('a malformed requested scope still clamps to a non-empty granted set (no invalid_scope)', () => {
    // Real-world: Claude Desktop sent scope as a URL-encoded blob, stored garbage in
    // oauth_clients.scopes. Both the malformed request and the garbage allowlist must
    // still yield a usable grant so the handler does NOT 400.
    const r = resolveGrantedScope(
      'read+write&state=mcp-startup-123"', // malformed requested scope
      ['read+write&state=mcp-startup-123"'], // garbage allowed scopes
    );
    expect(r.granted.length).toBeGreaterThan(0); // handler only rejects when this is 0
    expect(r.grantedScope).toBe('read write'); // falls back to sanitized defaults
  });

  it('excess valid scopes clamp to the allowed subset (no inflation, no reject)', () => {
    const r = resolveGrantedScope('read write crisis memory', ['read', 'write']);
    expect(r.granted).toEqual(['read', 'write']); // crisis/memory dropped, not rejected
  });
});

describe('scopePolicy helpers', () => {
  it('splits and sanitizes valid scope tokens', () => {
    expect(splitScopeString('read write memory')).toEqual(['read', 'write', 'memory']);
    expect(sanitizeScopeTokens(['read', 'read', 'write', 'bad scope'])).toEqual(['read', 'write']);
  });

  it('drops malformed allowed scope entries from storage', () => {
    const raw = ['read+write&state=mcp-startup-123"', 'read write', 'memory'];
    expect(normalizeAllowedScopes(raw)).toEqual(['read', 'write', 'memory']);
  });

  it('rejects requested scopes outside the client allowlist', () => {
    const resolved = resolveGrantedScope('read crisis', ['read', 'write']);
    expect(resolved.granted).toEqual(['read']);
    expect(resolved.invalidRequested).toEqual(['crisis']);
    expect(resolved.hasMalformedRequested).toBe(false);
  });

  it('falls back to safe defaults when stored scopes are malformed', () => {
    const resolved = resolveGrantedScope(undefined, ['read+write&state=bad']);
    expect(resolved.granted).toEqual(['read', 'write']);
    expect(resolved.invalidRequested).toEqual([]);
    expect(resolved.hasMalformedRequested).toBe(false);
  });

  it('flags malformed requested scope tokens', () => {
    const resolved = resolveGrantedScope('read+write&state=bad', ['read', 'write']);
    expect(resolved.hasMalformedRequested).toBe(true);
  });
});
