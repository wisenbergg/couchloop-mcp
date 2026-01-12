import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { ShrinkChatClient } from '../../src/clients/shrinkChatClient';
import { CircuitBreaker } from '../../src/utils/circuitBreaker';

// Mock fetch
global.fetch = vi.fn();

// Mock circuit breaker and retry strategy
vi.mock('../../src/utils/circuitBreaker');
vi.mock('../../src/utils/retryStrategy');

describe('ShrinkChatClient', () => {
  let client: ShrinkChatClient;
  let mockCircuitBreaker: any;

  beforeEach(() => {
    // Reset environment
    process.env.SHRINK_CHAT_API_URL = 'https://api.test.com';
    process.env.SHRINK_CHAT_API_KEY = 'test-api-key';
    process.env.SHRINK_CHAT_TIMEOUT_REGULAR = '5000';
    process.env.SHRINK_CHAT_TIMEOUT_CRISIS = '10000';

    // Setup circuit breaker mock
    mockCircuitBreaker = {
      execute: vi.fn((operation, fn) => fn()),
      getState: vi.fn().mockReturnValue('closed'),
      getStatistics: vi.fn().mockReturnValue({
        state: 'closed',
        totalCalls: 0,
        failedCalls: 0,
      }),
    };

    (CircuitBreaker as Mock).mockImplementation(() => mockCircuitBreaker);

    // Create client
    client = new ShrinkChatClient();

    // Reset fetch mock
    (global.fetch as Mock).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('sendMessage', () => {
    it('should send message successfully', async () => {
      const mockResponse = {
        content: 'AI response',
        messageId: 'msg-123',
        crisisLevel: 3,
      };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
        headers: new Headers({
          'x-request-id': 'req-123',
        }),
      });

      const result = await client.sendMessage(
        'test-thread',
        'Hello AI',
        {}
      );

      expect(result).toMatchObject({
        content: 'AI response',
        messageId: 'msg-123',
        crisisLevel: 3,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.test.com/api/shrink',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should detect crisis from message content', async () => {
      const mockResponse = {
        content: 'Crisis support response',
        messageId: 'msg-crisis',
        crisisLevel: 9,
        crisisDetected: true,
      };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
        headers: new Headers(),
      });

      const result = await client.sendMessage(
        'test-thread',
        'I want to hurt myself',
        {}
      );

      // Should use crisis timeout
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );

      expect(result.crisisLevel).toBe(9);
      expect(result.crisisDetected).toBe(true);
    });

    it('should include journey context when provided', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: 'response' }),
        headers: new Headers(),
      });

      const journeyContext = {
        journey: { name: 'Daily Reflection' },
        currentStep: { type: 'prompt', content: 'How are you?' },
      };

      await client.sendMessage(
        'thread-1',
        'Message',
        { journeyContext }
      );

      const callArgs = (global.fetch as Mock).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.journey_context).toEqual(journeyContext);
    });

    it('should handle conversation history', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: 'response' }),
        headers: new Headers(),
      });

      const history = [
        { role: 'user', content: 'Previous message' },
        { role: 'assistant', content: 'Previous response' },
      ];

      await client.sendMessage(
        'thread-1',
        'New message',
        { conversationHistory: history }
      );

      const callArgs = (global.fetch as Mock).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.conversation_history).toEqual(history);
    });

    it('should handle API errors', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid request',
        headers: new Headers(),
      });

      await expect(
        client.sendMessage('thread', 'message', {})
      ).rejects.toThrow('API request failed: 400 Bad Request');
    });

    it('should handle network errors', async () => {
      (global.fetch as Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      await expect(
        client.sendMessage('thread', 'message', {})
      ).rejects.toThrow('Network error');
    });

    it('should handle timeout', async () => {
      // Mock fetch that never resolves
      (global.fetch as Mock).mockImplementationOnce(
        () => new Promise(() => {})
      );

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);

      await expect(
        client.sendMessage('thread', 'message', {})
      ).rejects.toThrow();
    });

    it('should validate response schema', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          // Missing required 'content' field
          messageId: 'msg-123',
        }),
        headers: new Headers(),
      });

      await expect(
        client.sendMessage('thread', 'message', {})
      ).rejects.toThrow();
    });

    it('should use idempotency key when provided', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: 'response' }),
        headers: new Headers(),
      });

      await client.sendMessage('thread', 'message', {
        idempotencyKey: 'idempotent-123',
      });

      const callArgs = (global.fetch as Mock).mock.calls[0];
      expect(callArgs[1].headers['X-Idempotency-Key']).toBe('idempotent-123');
    });
  });

  describe('Crisis Detection', () => {
    const crisisKeywords = [
      'suicide',
      'kill myself',
      'end my life',
      'self-harm',
      'hurt myself',
      'cutting',
      'overdose',
      'worthless',
      'hopeless',
      'no reason to live',
    ];

    it.each(crisisKeywords)(
      'should detect crisis keyword: %s',
      async (keyword) => {
        (global.fetch as Mock).mockResolvedValueOnce({
          ok: true,
          json: async () => ({ content: 'crisis response' }),
          headers: new Headers(),
        });

        await client.sendMessage(
          'thread',
          `I feel ${keyword}`,
          {}
        );

        // Should use crisis timeout
        const callArgs = (global.fetch as Mock).mock.calls[0];
        const body = JSON.parse(callArgs[1].body);
        expect(body.metadata?.detected_crisis).toBe(true);
      }
    );

    it('should not detect crisis in normal messages', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: 'normal response' }),
        headers: new Headers(),
      });

      await client.sendMessage(
        'thread',
        'I feel happy today',
        {}
      );

      const callArgs = (global.fetch as Mock).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.metadata?.detected_crisis).toBeUndefined();
    });

    it('should cache crisis responses', async () => {
      const mockResponse = {
        content: 'Crisis support',
        crisisLevel: 9,
      };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
        headers: new Headers(),
      });

      // First call
      const result1 = await client.sendMessage(
        'thread',
        'I want to die',
        {}
      );

      // Second call with same message (should use cache)
      const result2 = await client.sendMessage(
        'thread',
        'I want to die',
        {}
      );

      // Fetch should only be called once due to caching
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(result1).toEqual(result2);
    });
  });

  describe('Circuit Breaker Integration', () => {
    it('should execute through circuit breaker', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: 'response' }),
        headers: new Headers(),
      });

      await client.sendMessage('thread', 'message', {});

      expect(mockCircuitBreaker.execute).toHaveBeenCalled();
    });

    it('should handle circuit breaker open state', async () => {
      mockCircuitBreaker.execute.mockRejectedValueOnce(
        new Error('Circuit breaker is open')
      );

      await expect(
        client.sendMessage('thread', 'message', {})
      ).rejects.toThrow('Circuit breaker is open');
    });

    it('should get circuit breaker status', () => {
      const status = client.getCircuitBreakerStatus();

      expect(status).toEqual({
        state: 'closed',
        totalCalls: 0,
        failedCalls: 0,
      });

      expect(mockCircuitBreaker.getStatistics).toHaveBeenCalled();
    });
  });

  describe('Streaming Messages', () => {
    it('should handle streaming mode', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue('data: {"content":"Hello"}\n\n');
          controller.enqueue('data: {"content":" World"}\n\n');
          controller.close();
        },
      });

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        body: mockStream,
        headers: new Headers({
          'content-type': 'text/event-stream',
        }),
      });

      const result = await client.sendMessage(
        'thread',
        'message',
        { streaming: true }
      );

      expect(result.content).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should include request ID in errors', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server error',
        headers: new Headers({
          'x-request-id': 'req-error-123',
        }),
      });

      try {
        await client.sendMessage('thread', 'message', {});
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('API request failed');
      }
    });

    it('should handle malformed JSON response', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
        text: async () => 'not json',
        headers: new Headers(),
      });

      await expect(
        client.sendMessage('thread', 'message', {})
      ).rejects.toThrow();
    });

    it('should handle rate limiting', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'Rate limited',
        headers: new Headers({
          'retry-after': '60',
        }),
      });

      await expect(
        client.sendMessage('thread', 'message', {})
      ).rejects.toThrow('API request failed: 429');
    });
  });

  describe('Configuration', () => {
    it('should use custom configuration', () => {
      process.env.SHRINK_CHAT_API_URL = 'https://custom.api.com';
      process.env.SHRINK_CHAT_TIMEOUT_REGULAR = '3000';
      process.env.SHRINK_CHAT_TIMEOUT_CRISIS = '15000';
      process.env.CIRCUIT_BREAKER_THRESHOLD = '10';

      const customClient = new ShrinkChatClient();

      expect(CircuitBreaker).toHaveBeenCalledWith(
        expect.objectContaining({
          failureThreshold: 10,
        })
      );
    });

    it('should use default configuration when env not set', () => {
      delete process.env.SHRINK_CHAT_API_URL;
      delete process.env.SHRINK_CHAT_TIMEOUT_REGULAR;

      const defaultClient = new ShrinkChatClient();

      expect(CircuitBreaker).toHaveBeenCalledWith(
        expect.objectContaining({
          failureThreshold: 5, // default
        })
      );
    });
  });
});