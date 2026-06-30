import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture what the conversation tool forwards to sendMessage.
const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }));
vi.mock('../../src/tools/sendMessage.js', () => ({ sendMessage: sendMessageMock }));

import { conversationTool } from '../../src/tools/primary-tools.js';

const SESSION_ID = '6aa4ffec-ab17-4023-a018-15e866fd19c8';

describe('conversation "send" forwards a resolved identity to sendMessage', () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    sendMessageMock.mockResolvedValue({ success: true });
  });

  it('passes auth derived from hidden _meta metadata (regression: send used to drop it)', async () => {
    await conversationTool.handler({
      action: 'send',
      message: 'begin standup',
      session_id: SESSION_ID,
      _meta: { user_id: 'stable-user-123' },
    });

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const arg = sendMessageMock.mock.calls[0][0];
    expect(arg.session_id).toBe(SESSION_ID);
    expect(arg.auth, 'send must forward an auth context').toBeTruthy();
    expect(arg.auth.user_id).toBe('stable-user-123');
  });

  it('forwards an explicit auth object too', async () => {
    await conversationTool.handler({
      action: 'send',
      message: 'hi',
      auth: { user_id: 'explicit-user-9' },
    });

    const arg = sendMessageMock.mock.calls[0][0];
    expect(arg.auth?.user_id).toBe('explicit-user-9');
  });
});
