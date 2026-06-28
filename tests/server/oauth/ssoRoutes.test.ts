import { describe, it, expect, vi } from 'vitest';
import {
  handleResolved,
  renderConsentPage,
  renderConflictPage,
} from '../../../src/server/oauth/ssoRoutes';

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
