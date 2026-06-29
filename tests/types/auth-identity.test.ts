import { describe, it, expect } from 'vitest';
import { extractUserFromContext } from '../../src/types/auth';

describe('extractUserFromContext — cross-client identity', () => {
  it('same oauth_user_id resolves to the SAME identity across different MCP clients', async () => {
    const onChatGPT = await extractUserFromContext({
      oauth_authenticated: true,
      oauth_user_id: 'user-U1',
      oauth_client_id: 'chatgpt-client',
    });
    const onClaude = await extractUserFromContext({
      oauth_authenticated: true,
      oauth_user_id: 'user-U1',
      oauth_client_id: 'claude-client',
    });
    expect(onChatGPT).toBe(onClaude); // cross-client: one human, one identity
    expect(onChatGPT).toMatch(/^oauth_[0-9a-f]{24}$/);
  });

  it('different oauth_user_id resolves to different identities', async () => {
    const a = await extractUserFromContext({
      oauth_authenticated: true,
      oauth_user_id: 'user-U1',
      oauth_client_id: 'chatgpt-client',
    });
    const b = await extractUserFromContext({
      oauth_authenticated: true,
      oauth_user_id: 'user-U2',
      oauth_client_id: 'chatgpt-client',
    });
    expect(a).not.toBe(b);
  });
});
