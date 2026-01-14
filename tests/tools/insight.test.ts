import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { saveInsight, getInsights, getUserContext } from '../../src/tools/insight';
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

describe('Insight Tools', () => {
  let mockDb: any;

  // Generate consistent UUIDs for testing
  const userId = uuidv4();
  const user2Id = uuidv4();
  const sessionId = uuidv4();
  const session2Id = uuidv4();
  const insightId = uuidv4();
  const insight2Id = uuidv4();
  const insight3Id = uuidv4();
  const newUserId = uuidv4();
  const nonExistentSessionId = uuidv4(); // For testing session not found

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

  describe('saveInsight', () => {
    it('should save an insight without session', async () => {
      const mockUser = { id: userId, externalId: 'test-user-123' };
      const mockInsight = {
        id: insightId,
        userId: userId,
        content: 'Test insight',
        tags: ['reflection'],
      };

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockUser]),
        }),
        returning: vi.fn().mockResolvedValue([mockInsight]),
      });

      const result = await saveInsight({
        content: 'Test insight',
        tags: ['reflection'],
      });

      expect(result).toMatchObject({
        insight_id: insightId,
        message: 'Insight captured successfully.',
      });
    });

    it('should save an insight with session', async () => {
      const mockUser = { id: userId, externalId: 'test-user-123' };
      const mockSession = { id: sessionId, userId: userId };
      const mockInsight = {
        id: insight2Id,
        userId: userId,
        sessionId: sessionId,
        content: 'Session insight',
      };

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockUser]),
        }),
        returning: vi.fn().mockResolvedValue([mockInsight]),
      });

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockSession]),
      });

      const result = await saveInsight({
        content: 'Session insight',
        session_id: sessionId,
      });

      expect(result).toMatchObject({
        insight_id: insight2Id,
        message: 'Insight captured successfully.',
      });
    });

    it('should handle session not found', async () => {
      const mockUser = { id: userId, externalId: 'test-user-123' };

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

      const result = await saveInsight({
        content: 'Test',
        session_id: nonExistentSessionId,
      });

      expect(result.error).toContain('not found');
    });

    it('should use auth context when provided', async () => {
      const mockAuth = { user_id: 'oauth-user-456' };
      const mockUser = { id: user2Id, externalId: 'oauth-user-456' };
      const mockInsight = { id: insight3Id };

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockUser]),
        }),
        returning: vi.fn().mockResolvedValue([mockInsight]),
      });

      (authModule.extractUserFromContext as Mock).mockResolvedValue('oauth-user-456');

      await saveInsight({
        content: 'Auth test',
        auth: mockAuth,
      });

      expect(authModule.extractUserFromContext).toHaveBeenCalledWith(mockAuth);
    });

    it('should handle validation errors', async () => {
      const result = await saveInsight({
        // Missing required 'content' field
        tags: ['test'],
      });

      expect(result.error).toBeDefined();
    });
  });

  describe('getInsights', () => {
    it('should get all insights for a user', async () => {
      const mockUser = { id: userId, externalId: 'test-user-123' };
      const mockInsights = [
        { id: insightId, content: 'Insight 1', createdAt: new Date() },
        { id: insight2Id, content: 'Insight 2', createdAt: new Date() },
      ];

      mockDb.select.mockReturnValue(
        createMockSelectChain([mockUser], mockInsights)
      );

      const result = await getInsights({});

      expect(result).toMatchObject({
        insights: mockInsights,
        count: 2,
      });
    });

    it('should filter insights by session', async () => {
      const mockUser = { id: userId, externalId: 'test-user-123' };
      const mockInsights = [
        { id: insightId, sessionId: sessionId, content: 'Session insight' },
      ];

      mockDb.select.mockReturnValue(
        createMockSelectChain([mockUser], mockInsights)
      );

      const result = await getInsights({
        session_id: sessionId,
      });

      expect(result.count).toBe(1);
      expect(result.insights[0].sessionId).toBe(sessionId);
    });

    it('should respect limit parameter', async () => {
      const mockUser = { id: userId, externalId: 'test-user-123' };
      const mockInsights = new Array(5).fill(null).map((_, i) => ({
        id: `insight-${i}`,
        content: `Insight ${i}`,
      }));

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn((limitVal) => {
          expect(limitVal).toBe(5);
          return Promise.resolve(mockInsights.slice(0, limitVal));
        }),
      });

      await getInsights({ limit: 5 });
    });

    it('should return empty array for new user', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      });

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: newUserId, externalId: 'test-user-123' }]),
      });

      const result = await getInsights({});

      expect(result).toMatchObject({
        insights: [],
        count: 0,
      });
    });
  });

  describe('getUserContext', () => {
    it('should get complete user context', async () => {
      const mockUser = { id: userId, externalId: 'test-user-123', preferences: {} };
      const mockInsights = [
        { id: insightId, content: 'Recent insight' },
      ];
      const mockSessions = [
        { id: sessionId, status: 'completed' },
      ];
      const mockActiveSession = {
        id: session2Id,
        status: 'active',
      };

      mockDb.select.mockReturnValue(
        createMockSelectChain([mockUser], mockInsights, mockSessions, [mockActiveSession])
      );

      const result = await getUserContext({
        include_recent_insights: true,
        include_session_history: true,
      });

      expect(result).toMatchObject({
        user: expect.objectContaining({
          id: userId,
          preferences: {}
        }),
        recent_insights: mockInsights,
        recent_sessions: mockSessions,
        active_session: mockActiveSession,
      });
    });

    it('should exclude insights when requested', async () => {
      const mockUser = { id: userId, externalId: 'test-user-123' };

      mockDb.select.mockReturnValue(
        createMockSelectChain([mockUser], [], [], []) // sessions, active session
      );

      const result = await getUserContext({
        include_recent_insights: false,
        include_session_history: true,
      });

      expect(result.recent_insights).toEqual([]);
      expect(result.recent_sessions).toBeDefined();
    });

    it('should exclude session history when requested', async () => {
      const mockUser = { id: userId, externalId: 'test-user-123' };

      mockDb.select.mockReturnValue(
        createMockSelectChain([mockUser], [], []) // insights, active session
      );

      const result = await getUserContext({
        include_recent_insights: true,
        include_session_history: false,
      });

      expect(result.recent_sessions).toEqual([]);
      expect(result.recent_insights).toBeDefined();
    });

    it('should create new user if not exists', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      });

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{
          id: newUserId,
          externalId: 'test-user-123',
          preferences: {},
        }]),
      });

      const result = await getUserContext({});

      expect(result.user).toBeDefined();
      expect(result.recent_insights).toEqual([]);
      expect(result.recent_sessions).toEqual([]);
      expect(result.active_session).toBeNull();
    });
  });
});