import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request } from 'express';
import {
  handleResolved,
  renderConsentPage,
  renderConflictPage,
  ssoRouter,
  ssoCallbackBaseUrl,
  emailSendLimited,
} from '../../../src/server/oauth/ssoRoutes';

describe('emailSendLimited (magic-link throttle)', () => {
  it('allows 5 sends per IP then limits, with its own 1-hour window', () => {
    const ip = `1.2.3.${Math.floor(Math.random() * 1000)}`; // unique IP per run
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(emailSendLimited(ip, t0 + i).limited).toBe(false);
    }
    const sixth = emailSendLimited(ip, t0 + 5);
    expect(sixth.limited).toBe(true);
    expect(sixth.retryAfter).toBeGreaterThan(3000); // ~1h remaining, not the 60s start window
  });

  it('resets after the window elapses', () => {
    const ip = `9.9.9.${Math.floor(Math.random() * 1000)}`;
    const t0 = 5_000_000;
    expect(emailSendLimited(ip, t0).limited).toBe(false);
    // jump past the 1-hour window
    expect(emailSendLimited(ip, t0 + 60 * 60_000 + 1).limited).toBe(false);
  });
});

describe('ssoCallbackBaseUrl (host-poisoning hardening)', () => {
  const original = process.env.OAUTH_PUBLIC_BASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.OAUTH_PUBLIC_BASE_URL;
    else process.env.OAUTH_PUBLIC_BASE_URL = original;
  });

  it('prefers the configured origin and ignores a poisoned forwarded Host', () => {
    process.env.OAUTH_PUBLIC_BASE_URL = 'https://mcp.couchloop.com/';
    const req = {
      headers: { 'x-forwarded-host': 'evil.example.com', 'x-forwarded-proto': 'https' },
      get: () => 'evil.example.com',
      protocol: 'https',
    } as unknown as Request;
    expect(ssoCallbackBaseUrl(req)).toBe('https://mcp.couchloop.com'); // trailing slash trimmed, attacker host ignored
  });

  it('falls back to the request host only when no origin is configured (dev)', () => {
    delete process.env.OAUTH_PUBLIC_BASE_URL;
    const req = {
      headers: {},
      get: () => 'localhost:3001',
      protocol: 'http',
    } as unknown as Request;
    expect(ssoCallbackBaseUrl(req)).toBe('http://localhost:3001');
  });
});

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

describe('ssoRouter wiring (regression)', () => {
  it('registers exactly the three SSO routes with the expected methods', () => {
    const router = ssoRouter();
    const layers = (router.stack as RouteLayer[]).filter((l) => l.route);
    const routes = layers.map((l) => ({ path: l.route!.path, methods: Object.keys(l.route!.methods) }));

    expect(routes).toContainEqual({ path: '/oauth/sso/start', methods: ['get'] });
    expect(routes).toContainEqual({ path: '/auth/callback', methods: ['get'] });
    expect(routes).toContainEqual({ path: '/auth/consent', methods: ['post'] });
    expect(routes).toHaveLength(3);
  });
});

describe('sso route helpers', () => {
  it('handleResolved mints a code and builds the client redirect with state', async () => {
    const generateAuthCode = vi.fn().mockResolvedValue('CODE123');
    const url = await handleResolved(
      { client_id: 'c', redirect_uri: 'https://app/cb', state: 's1', scope: 'read write' },
      'userZ',
      generateAuthCode,
    );
    expect(generateAuthCode).toHaveBeenCalledWith('c', 'userZ', 'https://app/cb', 'read write', undefined, undefined);
    expect(url).toBe('https://app/cb?code=CODE123&state=s1');
  });

  it('consent page embeds the nonce as a hidden field', () => {
    expect(renderConsentPage('nonceABC')).toContain('name="n" value="nonceABC"');
  });

  it('conflict page embeds the nonce and a continue action', () => {
    const html = renderConflictPage('nonceXYZ');
    expect(html).toContain('name="n" value="nonceXYZ"');
    expect(html).toMatch(/continue/i);
  });
});
