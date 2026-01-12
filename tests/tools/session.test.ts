import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { createSession, resumeSession } from '../../src/tools/session';
import { getDb } from '../../src/db/client';
import * as authModule from '../../src/types/auth';

// Mock database
vi.mock('../../src/db/client', () => ({
  getDb: vi.fn(),
}));

// Mock auth module
vi.mock('../../src/types/auth', () => ({
  extractUserFromContext: vi.fn(),
}));

describe('Session Tools', () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      insert: vi.fn(),
      select: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    (getDb as Mock).mockReturnValue(mockDb);
    (authModule.extractUserFromContext as Mock).mockResolvedValue('test-user-123');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createSession', () => {
    it('should create a new session without journey', async () => {
      const mockUser = { id: 'user-1', externalId: 'test-user-123', preferences: {} };
      const mockSession = {
        id: 'session-1',
        userId: 'user-1',
        status: 'active',
        currentStep: 0,
        metadata: { context: 'Test context' },
      };

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockUser]),
        }),
        returning: vi.fn().mockResolvedValue([mockSession]),
      });

      const result = await createSession({
        context: 'Test context',
      });

      expect(result).toMatchObject({
        session_id: 'session-1',
        journey: null,
        current_step: null,
        message: 'Started freeform session.',
      });

      expect(authModule.extractUserFromContext).toHaveBeenCalledWith(undefined);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should create a session with journey', async () => {
      const mockUser = { id: 'user-1', externalId: 'test-user-123', preferences: {} };
      const mockJourney = {
        id: 'journey-1',
        name: 'Daily Reflection',
        steps: [
          { type: 'prompt', content: { prompt: 'How are you feeling?' } },
        ],
      };
      const mockSession = {
        id: 'session-2',
        userId: 'user-1',
        journeyId: 'journey-1',
        status: 'active',
        currentStep: 0,
        metadata: { context: 'Journey session' },
      };

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockUser]),
        }),
        returning: vi.fn().mockResolvedValue([mockSession]),
      });

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockJourney]),
      });

      const result = await createSession({
        journey_slug: 'daily-reflection',
        context: 'Journey session',
      });

      expect(result).toMatchObject({
        session_id: 'session-2',
        journey: mockJourney,
        current_step: mockJourney.steps[0],
        message: expect.stringContaining('Daily Reflection'),
      });
    });

    it('should use auth context when provided', async () => {
      const mockAuth = {
        token: 'test-token',
        user_id: 'oauth-user-456',
      };

      const mockUser = { id: 'user-2', externalId: 'oauth-user-456', preferences: {} };
      const mockSession = { id: 'session-3', userId: 'user-2' };

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockUser]),
        }),
        returning: vi.fn().mockResolvedValue([mockSession]),
      });

      (authModule.extractUserFromContext as Mock).mockResolvedValue('oauth-user-456');

      await createSession({
        context: 'Auth test',
        auth: mockAuth,
      });

      expect(authModule.extractUserFromContext).toHaveBeenCalledWith(mockAuth);
    });

    it('should handle journey not found error', async () => {
      const mockUser = { id: 'user-1', externalId: 'test-user-123', preferences: {} };

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockUser]),
        }),
      });

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      });

      const result = await createSession({
        journey_slug: 'non-existent',
      });

      expect(result.error).toContain('not found');
    });

    it('should handle validation errors', async () => {
      const result = await createSession({
        journey_slug: 123, // Invalid type
      });

      expect(result.error).toBeDefined();
    });
  });

  describe('resumeSession', () => {
    it('should resume most recent session when no ID provided', async () => {
      const mockUser = { id: 'user-1', externalId: 'test-user-123' };
      const mockSession = {
        id: 'session-1',
        userId: 'user-1',
        status: 'paused',
        journeyId: null,
      };
      const mockCheckpoints = [
        { key: 'checkpoint1', value: { data: 'test' } },
      ];

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValueOnce([mockUser])
          .mockResolvedValueOnce([mockSession])
          .mockResolvedValueOnce(mockCheckpoints),
      });

      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ ...mockSession, status: 'active' }]),
      });

      const result = await resumeSession({});

      expect(result).toMatchObject({
        session: expect.objectContaining({ status: 'active' }),
        journey: null,
        checkpoints: mockCheckpoints,
        message: expect.stringContaining('Resumed session'),
      });
    });

    it('should resume specific session by ID', async () => {
      const mockUser = { id: 'user-1', externalId: 'test-user-123' };
      const mockSession = {
        id: 'session-specific',
        userId: 'user-1',
        status: 'paused',
      };

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValueOnce([mockUser])
          .mockResolvedValueOnce([mockSession])
          .mockResolvedValueOnce([]),
      });

      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ ...mockSession, status: 'active' }]),
      });

      const result = await resumeSession({
        session_id: 'session-specific',
      });

      expect(result.session.id).toBe('session-specific');
    });

    it('should handle no sessions to resume', async () => {
      const mockUser = { id: 'user-1', externalId: 'test-user-123' };

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValueOnce([mockUser])
          .mockResolvedValueOnce([]),
      });

      const result = await resumeSession({});

      expect(result.message).toContain('No paused sessions found');
    });

    it('should create user if not exists', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      });

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 'new-user', externalId: 'test-user-123' }]),
      });

      const result = await resumeSession({});

      expect(result.message).toContain('No previous sessions found');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should handle session not belonging to user', async () => {
      const mockUser = { id: 'user-1', externalId: 'test-user-123' };

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValueOnce([mockUser])
          .mockResolvedValueOnce([]), // No session found for user
      });

      const result = await resumeSession({
        session_id: 'other-users-session',
      });

      expect(result.error).toContain('not found');
    });
  });
});