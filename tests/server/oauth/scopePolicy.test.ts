import { describe, expect, it } from 'vitest';
import {
  normalizeAllowedScopes,
  resolveGrantedScope,
  sanitizeScopeTokens,
  splitScopeString,
} from '../../../src/server/oauth/scopePolicy';

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
