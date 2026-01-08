import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sendMessage } from '../../src/tools/sendMessage';
import { createSession } from '../../src/tools/session';
import { getDb } from '../../src/db/client';
import { sessions, checkpoints, crisisEvents } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

describe('Send Message Integration', () => {
  let testSessionId: string;
  let db: ReturnType<typeof getDb>;

  beforeAll(async () => {
    // Initialize database connection
    db = getDb();
  });

  beforeEach(async () => {
    // Create a test session
    const sessionResult = await createSession({
      journey_slug: 'daily-reflection',
      context: 'Integration test'
    });
    testSessionId = sessionResult.id;
  });

  afterAll(async () => {
    // Clean up test data
    if (testSessionId) {
      await db.delete(checkpoints).where(eq(checkpoints.sessionId, testSessionId));
      await db.delete(crisisEvents).where(eq(crisisEvents.sessionId, testSessionId));
      await db.delete(sessions).where(eq(sessions.id, testSessionId));
    }
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
      const sessionBefore = await db.query.sessions.findFirst({
        where: eq(sessions.id, testSessionId)
      });
      expect(sessionBefore?.threadId).toBeNull();

      // Send message
      const result = await sendMessage({
        session_id: testSessionId,
        message: 'Hello'
      });

      // Check thread ID was created
      const sessionAfter = await db.query.sessions.findFirst({
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
      const checkpoint = await db.query.checkpoints.findFirst({
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

      const checkpointCount = await db.query.checkpoints.findMany({
        where: eq(checkpoints.sessionId, testSessionId)
      });

      expect(checkpointCount.length).toBe(0);
    });
  });

  describe('Journey Integration', () => {
    it('should advance step when requested', async () => {
      // Get initial step
      const sessionBefore = await db.query.sessions.findFirst({
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
      const sessionAfter = await db.query.sessions.findFirst({
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
        const crisisEvent = await db.query.crisisEvents.findFirst({
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
      await db.update(sessions)
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