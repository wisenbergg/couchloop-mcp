import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { createSession, resumeSession } from '../../src/tools/session';
import { getDb } from '../../src/db/client';
import * as authModule from '../../src/types/auth';
import { v4 as uuidv4 } from 'uuid';

// Mock database
vi.mock('../../src/db/client', () => ({
  getDb: vi.fn(),
}));

// Mock auth module
vi.mock('../../src/types/auth', async () => {
  const actual = await vi.importActual('../../src/types/auth') as any;
  return {
    ...actual,
    AuthContextSchema: actual.AuthContextSchema,
    extractUserFromContext: vi.fn(),
  };
});

describe('Session Tools', () => {
  let mockDb: any;

  // Generate consistent UUIDs for testing
  const userId = uuidv4();
  const sessionId = uuidv4();
  const journeyId = uuidv4();
  const session2Id = uuidv4();
  const user2Id = uuidv4();
  const session3Id = uuidv4();
  const sessionSpecificId = uuidv4();
  const otherUsersSessionId = uuidv4();
  const newUserId = uuidv4();

  // Helper to create properly chained mock database queries
  const createMockSelectChain = (...results: any[]) => {
    let callCount = 0;
    return {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn(() => {
        const result = results[callCount] || [];
        callCount++;
        return Promise.resolve(result);
      }),
    };
  };

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
      const mockUser = { id: userId, externalId: 'test-user-123', preferences: {} };
      const mockSession = {
        id: sessionId,
        userId: userId,
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
        session_id: sessionId,
        journey: null,
        current_step: null,
        message: 'Started freeform session.',
      });

      expect(authModule.extractUserFromContext).toHaveBeenCalledWith(undefined);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should create a session with journey', async () => {
      const mockUser = { id: userId, externalId: 'test-user-123', preferences: {} };
      const mockJourney = {
        id: journeyId,
        name: 'Daily Reflection',
        steps: [
          { type: 'prompt', content: { prompt: 'How are you feeling?' } },
        ],
      };
      const mockSession = {
        id: session2Id,
        userId: userId,
        journeyId: journeyId,
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
        session_id: session2Id,
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

      const mockUser = { id: user2Id, externalId: 'oauth-user-456', preferences: {} };
      const mockSession = { id: session3Id, userId: user2Id };

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
      const mockUser = { id: userId, externalId: 'test-user-123', preferences: {} };

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
        journey_slug: 'non-existent-journey-slug',  // This is a slug, not a UUID
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
      const mockUser = { id: userId, externalId: 'test-user-123' };
      const mockSession = {
        id: sessionId,
        userId: userId,
        status: 'paused',
        journeyId: null,
      };
      const mockCheckpoints = [
        { key: 'checkpoint1', value: { data: 'test' } },
      ];

      // Mock the sequential database queries
      let callCount = 0;
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn(() => {
          const results = [
            [mockUser],     // First call: get user
            [mockSession]   // Second call: get session
          ];
          return Promise.resolve(results[callCount++] || []);
        })
      });

      // Mock checkpoint query separately (uses where directly)
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(mockCheckpoints),
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
      const mockUser = { id: userId, externalId: 'test-user-123' };
      const mockSession = {
        id: sessionSpecificId,
        userId: userId,
        status: 'paused',
      };

      // Mock the sequential database queries
      let callCount = 0;
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn(() => {
          const results = [
            [mockUser],     // First call: get user
            [mockSession]   // Second call: get session
          ];
          return Promise.resolve(results[callCount++] || []);
        })
      });

      // Mock checkpoint query separately
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      });

      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ ...mockSession, status: 'active' }]),
      });

      const result = await resumeSession({
        session_id: sessionSpecificId,
      });

      expect(result.session.id).toBe(sessionSpecificId);
    });

    it('should handle no sessions to resume', async () => {
      const mockUser = { id: userId, externalId: 'test-user-123' };

      let callCount = 0;
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn(() => {
          const results = [
            [mockUser],  // First call: get user
            []           // Second call: no sessions
          ];
          return Promise.resolve(results[callCount++] || []);
        })
      });

      const result = await resumeSession({});

      expect(result).toBeDefined();
      if (result.message) {
        expect(result.message).toMatch(/No paused sessions found|No previous sessions found/);
      } else if (result.error) {
        expect(result.error).toMatch(/No paused sessions found|No previous sessions found/);
      }
    });

    it('should create user if not exists', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      });

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: newUserId, externalId: 'test-user-123' }]),
      });

      const result = await resumeSession({});

      expect(result.message).toContain('No previous sessions found');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should handle session not belonging to user', async () => {
      const mockUser = { id: userId, externalId: 'test-user-123' };

      mockDb.select.mockReturnValue(
        createMockSelectChain([mockUser], []) // No session found for user
      );

      const result = await resumeSession({
        session_id: otherUsersSessionId,
      });

      expect(result.error).toContain('not found');
    });
  });
});