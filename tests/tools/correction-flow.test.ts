import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createCorrection,
  confirmIssue,
  approveFix,
  dismissCorrection,
  getMostRecentPendingCorrection,
  clearAllCorrections,
  CorrectionState,
} from '../../src/tools/correction-flow';

// Mock handleSmartContext to avoid DB calls
vi.mock('../../src/tools/smart-context', () => ({
  handleSmartContext: vi.fn().mockResolvedValue({ success: true }),
}));

describe('CorrectionFlow', () => {
  const SESSION_A = 'session-a';
  const SESSION_B = 'session-b';
  const AUTH_A = { user_id: 'user-a' };

  beforeEach(() => {
    clearAllCorrections();
  });

  describe('createCorrection', () => {
    it('creates entry in PENDING_ACKNOWLEDGMENT state', () => {
      const correction = createCorrection(
        ['issue 1'], ['fix 1'], 'bad code', SESSION_A, undefined, AUTH_A,
      );

      expect(correction.state).toBe(CorrectionState.PENDING_ACKNOWLEDGMENT);
      expect(correction.session_id).toBe(SESSION_A);
      expect(correction.issues_detected).toEqual(['issue 1']);
      expect(correction.proposed_fixes).toEqual(['fix 1']);
      expect(correction.user_confirmed_issue).toBe(false);
      expect(correction.user_approved_fix).toBe(false);
      expect(correction.saved_to_memory).toBe(false);
      expect(correction.auth).toEqual(AUTH_A);
    });

    it('truncates verified_content to 500 chars', () => {
      const longContent = 'x'.repeat(1000);
      const correction = createCorrection(['issue'], ['fix'], longContent, SESSION_A);
      expect(correction.verified_content.length).toBeLessThanOrEqual(500);
    });
  });

  describe('confirmIssue', () => {
    it('transitions to PENDING_FIX_APPROVAL and saves to memory', async () => {
      const correction = createCorrection(['issue'], ['fix'], 'code', SESSION_A, undefined, AUTH_A);
      const confirmed = await confirmIssue(correction.id, SESSION_A);

      expect(confirmed.state).toBe(CorrectionState.PENDING_FIX_APPROVAL);
      expect(confirmed.user_confirmed_issue).toBe(true);
      expect(confirmed.saved_to_memory).toBe(true);
    });

    it('rejects wrong session_id', async () => {
      const correction = createCorrection(['issue'], ['fix'], 'code', SESSION_A);
      await expect(confirmIssue(correction.id, SESSION_B))
        .rejects.toThrow('does not belong to this session');
    });

    it('rejects if not in PENDING_ACKNOWLEDGMENT state', async () => {
      const correction = createCorrection(['issue'], ['fix'], 'code', SESSION_A);
      await confirmIssue(correction.id, SESSION_A); // → PENDING_FIX_APPROVAL

      await expect(confirmIssue(correction.id, SESSION_A))
        .rejects.toThrow('expected pending_acknowledgment');
    });

    it('sets memory_save_error when handleSmartContext fails', async () => {
      const { handleSmartContext } = await import('../../src/tools/smart-context');
      (handleSmartContext as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB down'));

      const correction = createCorrection(['issue'], ['fix'], 'code', SESSION_A);
      const confirmed = await confirmIssue(correction.id, SESSION_A);

      expect(confirmed.saved_to_memory).toBe(false);
      expect(confirmed.memory_save_error).toBe('DB down');
    });
  });

  describe('approveFix', () => {
    it('transitions to APPLIED after confirm', async () => {
      const correction = createCorrection(['issue'], ['fix'], 'code', SESSION_A);
      await confirmIssue(correction.id, SESSION_A);
      const applied = approveFix(correction.id, SESSION_A);

      expect(applied.state).toBe(CorrectionState.APPLIED);
      expect(applied.user_approved_fix).toBe(true);
    });

    it('rejects wrong session_id', async () => {
      const correction = createCorrection(['issue'], ['fix'], 'code', SESSION_A);
      await confirmIssue(correction.id, SESSION_A);

      expect(() => approveFix(correction.id, SESSION_B))
        .toThrow('does not belong to this session');
    });

    it('rejects if confirm was not called first', () => {
      const correction = createCorrection(['issue'], ['fix'], 'code', SESSION_A);

      expect(() => approveFix(correction.id, SESSION_A))
        .toThrow('Did you call confirm first');
    });
  });

  describe('dismissCorrection', () => {
    it('dismisses from PENDING_ACKNOWLEDGMENT', () => {
      const correction = createCorrection(['issue'], ['fix'], 'code', SESSION_A);
      const dismissed = dismissCorrection(correction.id, SESSION_A);

      expect(dismissed.state).toBe(CorrectionState.DISMISSED);
    });

    it('dismisses from PENDING_FIX_APPROVAL', async () => {
      const correction = createCorrection(['issue'], ['fix'], 'code', SESSION_A);
      await confirmIssue(correction.id, SESSION_A);
      const dismissed = dismissCorrection(correction.id, SESSION_A);

      expect(dismissed.state).toBe(CorrectionState.DISMISSED);
    });

    it('rejects dismissing an APPLIED correction', async () => {
      const correction = createCorrection(['issue'], ['fix'], 'code', SESSION_A);
      await confirmIssue(correction.id, SESSION_A);
      approveFix(correction.id, SESSION_A);

      expect(() => dismissCorrection(correction.id, SESSION_A))
        .toThrow('already in terminal state applied');
    });

    it('rejects dismissing an already DISMISSED correction', () => {
      const correction = createCorrection(['issue'], ['fix'], 'code', SESSION_A);
      dismissCorrection(correction.id, SESSION_A);

      expect(() => dismissCorrection(correction.id, SESSION_A))
        .toThrow('already in terminal state dismissed');
    });

    it('rejects wrong session_id', () => {
      const correction = createCorrection(['issue'], ['fix'], 'code', SESSION_A);

      expect(() => dismissCorrection(correction.id, SESSION_B))
        .toThrow('does not belong to this session');
    });
  });

  describe('getMostRecentPendingCorrection', () => {
    it('returns only corrections for the given session', () => {
      createCorrection(['a'], ['fix-a'], 'code-a', SESSION_A);
      createCorrection(['b'], ['fix-b'], 'code-b', SESSION_B);

      const pendingA = getMostRecentPendingCorrection(SESSION_A);
      const pendingB = getMostRecentPendingCorrection(SESSION_B);

      expect(pendingA?.issues_detected).toEqual(['a']);
      expect(pendingB?.issues_detected).toEqual(['b']);
    });

    it('returns undefined when no pending corrections exist', () => {
      expect(getMostRecentPendingCorrection('nonexistent-session')).toBeUndefined();
    });

    it('filters by expectedState', async () => {
      const c1 = createCorrection(['issue1'], ['fix1'], 'code1', SESSION_A);
      const c2 = createCorrection(['issue2'], ['fix2'], 'code2', SESSION_A);
      await confirmIssue(c2.id, SESSION_A); // c2 → PENDING_FIX_APPROVAL

      // Filter PENDING_ACKNOWLEDGMENT: returns c1 (only one still in that state)
      const ack = getMostRecentPendingCorrection(SESSION_A, CorrectionState.PENDING_ACKNOWLEDGMENT);
      expect(ack?.id).toBe(c1.id);

      // Filter PENDING_FIX_APPROVAL: returns c2 (only one in that state)
      const fix = getMostRecentPendingCorrection(SESSION_A, CorrectionState.PENDING_FIX_APPROVAL);
      expect(fix?.id).toBe(c2.id);

      // Without filter: returns either (both are non-terminal)
      const any = getMostRecentPendingCorrection(SESSION_A);
      expect(any).toBeDefined();
      expect([c1.id, c2.id]).toContain(any?.id);
    });

    it('does not return terminal state corrections', async () => {
      const correction = createCorrection(['issue'], ['fix'], 'code', SESSION_A);
      dismissCorrection(correction.id, SESSION_A);

      expect(getMostRecentPendingCorrection(SESSION_A)).toBeUndefined();
    });
  });
});
