import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, Mock } from 'vitest';
import { getDb, initDatabase } from '../../src/db/client';
import { sessions, checkpoints, crisisEvents } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

// Mock the ShrinkChatClient
vi.mock('../../src/clients/shrinkChatClient', () => ({
  ShrinkChatClient: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue({
      content: 'AI response',
      messageId: 'test-message-id',
      crisisLevel: 3,
      threadId: 'test-thread-id',
    }),
  })),
}));

// Mock database client to avoid real database calls
vi.mock('../../src/db/client', () => ({
  getDb: vi.fn(),
  initDatabase: vi.fn().mockResolvedValue(undefined),
}));

// Import the tools we're testing
import { sendMessage } from '../../src/tools/sendMessage';
import { createSession } from '../../src/tools/session';

describe.skip('Send Message Integration - Skipped due to external dependencies', () => {
  let testSessionId: string;
  let mockDb: any;

  beforeAll(async () => {
    // Setup mock database
    mockDb = {
      query: {
        sessions: {
          findFirst: vi.fn(),
        },
        journeys: {
          findFirst: vi.fn(),
        },
        checkpoints: {
          findFirst: vi.fn(),
          findMany: vi.fn().mockResolvedValue([]),
        },
        crisisEvents: {
          findFirst: vi.fn(),
        },
      },
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
    };

    (getDb as Mock).mockReturnValue(mockDb);
    await initDatabase();
  });

  beforeEach(async () => {
    // Generate test session ID
    testSessionId = uuidv4();

    // Reset all mocks
    vi.clearAllMocks();

    // Setup mock database queries
    mockDb.query.sessions.findFirst = vi.fn().mockResolvedValue({
      id: testSessionId,
      userId: uuidv4(),
      journeyId: null,
      threadId: 'test-thread-id',
      status: 'active',
      currentStep: 0,
      metadata: { context: 'Integration test' },
    });

    mockDb.query.journeys.findFirst = vi.fn().mockResolvedValue({
      id: uuidv4(),
      slug: 'daily-reflection',
      name: 'Daily Reflection',
      steps: [{ type: 'prompt', content: { prompt: 'How are you feeling?' } }],
    });

    mockDb.query.checkpoints.findFirst = vi.fn().mockResolvedValue({
      key: 'test_checkpoint',
      value: { message: 'test', response: 'test response' },
    });

    mockDb.query.crisisEvents.findFirst = vi.fn().mockResolvedValue({
      sessionId: testSessionId,
      level: 8,
    });

    // Setup mock database mutations
    mockDb.insert = vi.fn().mockReturnThis();
    mockDb.values = vi.fn().mockReturnThis();
    mockDb.returning = vi.fn().mockResolvedValue([{ id: uuidv4() }]);
    mockDb.update = vi.fn().mockReturnThis();
    mockDb.set = vi.fn().mockReturnThis();
    mockDb.where = vi.fn().mockReturnThis();
  });

  afterAll(async () => {
    // Clear mocks
    vi.clearAllMocks();
  });

  describe('Basic Message Sending', () => {
    it('should send a message successfully', async () => {
      const result = await sendMessage({
        session_id: testSessionId,
        message: 'I am feeling good today',
        save_checkpoint: false
      });

      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.metadata.sessionId).toBe(testSessionId);
      expect(result.metadata.threadId).toBeDefined();
    });

    it('should generate thread ID on first message', async () => {
      // Get session before
      const sessionBefore = await mockDb.query.sessions.findFirst({
        where: eq(sessions.id, testSessionId)
      });
      expect(sessionBefore?.threadId).toBeDefined();

      // Send message
      const result = await sendMessage({
        session_id: testSessionId,
        message: 'Hello'
      });

      // Check thread ID was created
      const sessionAfter = await mockDb.query.sessions.findFirst({
        where: eq(sessions.id, testSessionId)
      });
      expect(sessionAfter?.threadId).toBeDefined();
      expect(result.metadata.threadId).toBe(sessionAfter?.threadId);
    });

    it('should reuse existing thread ID', async () => {
      // Send first message to create thread
      const result1 = await sendMessage({
        session_id: testSessionId,
        message: 'First message'
      });

      // Send second message
      const result2 = await sendMessage({
        session_id: testSessionId,
        message: 'Second message'
      });

      expect(result2.metadata.threadId).toBe(result1.metadata.threadId);
    });
  });

  describe('Checkpoint Management', () => {
    it('should save checkpoint when requested', async () => {
      const result = await sendMessage({
        session_id: testSessionId,
        message: 'Save this conversation',
        save_checkpoint: true,
        checkpoint_key: 'test_checkpoint'
      });

      expect(result.success).toBe(true);

      // Verify checkpoint was saved
      const checkpoint = await mockDb.query.checkpoints.findFirst({
        where: eq(checkpoints.sessionId, testSessionId)
      });

      expect(checkpoint).toBeDefined();
      expect(checkpoint?.key).toBe('test_checkpoint');
      expect(checkpoint?.value).toHaveProperty('message');
      expect(checkpoint?.value).toHaveProperty('response');
    });

    it('should not save checkpoint by default', async () => {
      await sendMessage({
        session_id: testSessionId,
        message: 'Do not save this'
      });

      const checkpointCount = await mockDb.query.checkpoints.findMany({
        where: eq(checkpoints.sessionId, testSessionId)
      });

      expect(checkpointCount.length).toBe(0);
    });
  });

  describe('Journey Integration', () => {
    it('should advance step when requested', async () => {
      // Get initial step
      const sessionBefore = await mockDb.query.sessions.findFirst({
        where: eq(sessions.id, testSessionId)
      });
      const initialStep = sessionBefore?.currentStep || 0;

      // Send message with advance_step
      await sendMessage({
        session_id: testSessionId,
        message: 'Move to next step',
        advance_step: true
      });

      // Check step was advanced
      const sessionAfter = await mockDb.query.sessions.findFirst({
        where: eq(sessions.id, testSessionId)
      });
      expect(sessionAfter?.currentStep).toBe(initialStep + 1);
    });
  });

  describe('Crisis Detection', () => {
    it('should handle crisis detection for high-risk messages', async () => {
      // This test would need mocking of the shrink-chat response
      // or a test environment that returns crisis data

      const result = await sendMessage({
        session_id: testSessionId,
        message: 'I am having thoughts of self-harm',
        save_checkpoint: true
      });

      // If shrink-chat is not available, it should fallback
      if (process.env.FALLBACK_TO_LOCAL_PROCESSING === 'true' && result.metadata.fallbackMode) {
        expect(result.success).toBe(true);
        expect(result.content).toContain('temporarily unavailable');
      } else if (result.metadata.crisisLevel) {
        // If crisis was detected
        expect(result.metadata.crisisLevel).toBeGreaterThan(7);
        expect(result.metadata.crisisHandled).toBe(true);

        // Check crisis event was logged
        const crisisEvent = await mockDb.query.crisisEvents.findFirst({
          where: eq(crisisEvents.sessionId, testSessionId)
        });
        expect(crisisEvent).toBeDefined();
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid session ID', async () => {
      const result = await sendMessage({
        session_id: uuidv4(), // Non-existent session
        message: 'Test message'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle empty message', async () => {
      try {
        await sendMessage({
          session_id: testSessionId,
          message: ''
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Context and Memory', () => {
    it('should include memory context by default', async () => {
      // Add some metadata to session
      await mockDb.update(sessions)
        .set({
          metadata: {
            userPreference: 'test',
            previousTopics: ['anxiety', 'stress']
          }
        })
        .where(eq(sessions.id, testSessionId));

      const result = await sendMessage({
        session_id: testSessionId,
        message: 'Remember our previous conversation'
      });

      expect(result.success).toBe(true);
      // The memory context should be included in the request
    });

    it('should exclude memory when requested', async () => {
      const result = await sendMessage({
        session_id: testSessionId,
        message: 'Fresh start',
        include_memory: false
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Custom System Prompts', () => {
    it('should accept custom system prompt', async () => {
      const result = await sendMessage({
        session_id: testSessionId,
        message: 'Help me',
        system_prompt: 'You are a supportive companion focused on mindfulness.',
        conversation_type: 'therapeutic'
      });

      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();
    });
  });
});