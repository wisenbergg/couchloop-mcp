import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { CircuitBreaker } from '../utils/circuitBreaker.js';
import { RetryStrategy } from '../utils/retryStrategy.js';
import { crisisCache } from '../utils/responseCache.js';
import { performanceMonitor } from '../utils/performanceMonitor.js';
import { v4 as uuidv4 } from 'uuid';

// Configuration with differentiated timeouts
// Made as a function to allow dynamic reading of environment variables
const getConfig = () => ({
  baseUrl: process.env.COUCHLOOP_SERVER || process.env.SHRINK_CHAT_API_URL || 'http://localhost:3000',
  timeout: {
    default: parseInt(process.env.SHRINK_CHAT_TIMEOUT || '30000'),
    regular: parseInt(process.env.SHRINK_CHAT_TIMEOUT_REGULAR || '15000'),
    crisis: parseInt(process.env.SHRINK_CHAT_TIMEOUT_CRISIS || '45000'),
    stream: parseInt(process.env.SHRINK_CHAT_TIMEOUT_STREAM || '60000'),
  },
});

// Response Schema based on actual shrink-chat API
export const ShrinkResponseSchema = z.object({
  // shrink-chat returns 'reply' or 'response_text' instead of 'content'
  reply: z.string().optional(),
  response_text: z.string().optional(),
  content: z.string().optional(), // Keep for backward compatibility
  messageId: z.string().optional(),
  crisisDetected: z.boolean().optional(),
  crisisLevel: z.union([z.number().min(0).max(10), z.string()]).optional(), // Can be number or "none"
  crisis_level: z.union([z.string(), z.number()]).optional(), // Alternative field name
  crisisHandled: z.boolean().optional(),
  crisis_confidence: z.number().min(0).max(1).optional(), // Crisis detection confidence
  crisis_requires_intervention: z.boolean().optional(), // Flag for revision needed
  crisis_indicators: z.array(z.string()).optional(), // What triggered detection
  crisis_suggested_actions: z.array(z.string()).optional(), // Suggested actions
  emotions: z.array(z.string()).optional(),
  therapeuticTechnique: z.string().optional(),
  resources: z.array(z.object({
    type: z.string(),
    title: z.string(),
    url: z.string().optional(),
    phone: z.string().optional(),
    description: z.string().optional(),
  })).optional(),
  escalationPath: z.string().optional(),
  threadId: z.string().optional(),
  meta: z.object({
    rag_confidence: z.number().min(0).max(1).optional(), // Memory retrieval confidence
    emotionalTone: z.array(z.string()).optional(),
    therapeuticElements: z.array(z.string()).optional(),
  }).optional(),
  memory_high_relevance_count: z.number().optional(),
  error: z.string().optional(),
  error_type: z.string().optional(),
  message: z.string().optional(), // Error message format
});

export const ErrorResponseSchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
  error_type: z.string().optional(),
  code: z.string().optional(),
  details: z.unknown().optional(),
});

export type ShrinkResponse = z.infer<typeof ShrinkResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export class ShrinkChatClient {
  private circuitBreaker: CircuitBreaker;
  private retryStrategy: RetryStrategy;

  constructor() {
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '5'),
      resetTimeout: parseInt(process.env.CIRCUIT_BREAKER_RESET || '30000'),
      halfOpenMaxAttempts: 3,
    });

    this.retryStrategy = new RetryStrategy();
  }

  /**
   * Detect if a message contains crisis indicators
   */
  private detectCrisisContent(message: string): boolean {
    const crisisPatterns = [
      /\b(suicide|suicidal)\b/i,
      /\b(kill\s+(myself|me))\b/i,
      /\b(self[- ]?harm)\b/i,
      /\b(end\s+(it|my\s+life))\b/i,
      /\b(hurt\s+myself)\b/i,
      /\b(take\s+my\s+(own\s+)?life)\b/i,
      /\b(want\s+to\s+die)\b/i,
      /\b(better\s+off\s+dead)\b/i,
      /\b(overdose)\b/i,
      /\b(cutting|cut\s+myself)\b/i,
    ];

    return crisisPatterns.some(pattern => pattern.test(message));
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    timeoutMs?: number
  ): Promise<T> {
    const config = getConfig();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      timeoutMs || config.timeout.default
    );

    try {
      const response = await this.circuitBreaker.execute(
        `shrink-chat-${endpoint}`,
        async () => {
          const res = await fetch(`${config.baseUrl}${endpoint}`, {
            ...options,
            headers: {
              'Content-Type': 'application/json',
              'X-Source': 'mcp-server',
              ...options.headers,
            },
            signal: controller.signal,
          });

          if (!res.ok) {
            const errorData = await res.json().catch(() => ({
              error: res.statusText,
              error_type: 'http_error'
            })) as ErrorResponse;

            throw new Error(
              errorData.message ||
              errorData.error ||
              `Shrink-Chat API error: ${res.statusText}`
            );
          }

          return res.json();
        }
      );

      clearTimeout(timeout);
      return response as T;
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Shrink-Chat API timeout after ${timeoutMs || config.timeout.default}ms`);
      }

      throw error;
    }
  }

  /**
   * Send a message through the shrink-chat therapeutic stack
   * Note: Threads are created lazily - no need for separate thread creation
   */
  async sendMessage(
    threadId: string,
    prompt: string,
    options?: {
      userId?: string;
      memoryContext?: string;
      enhancedContext?: Record<string, unknown>;
      history?: Array<{ role: string; content: string }>;
      systemPrompt?: string;
      conversationType?: string;
      idempotencyKey?: string;
    }
  ): Promise<ShrinkResponse> {
    logger.debug(`Sending message to thread ${threadId}`);

    const config = getConfig();
    // Detect crisis content to determine timeout
    const isCrisis = this.detectCrisisContent(prompt);
    const timeout = isCrisis ? config.timeout.crisis : config.timeout.regular;

    // Track performance metrics
    const operationName = isCrisis
      ? 'shrink-chat.crisis-message'
      : 'shrink-chat.regular-message';

    return performanceMonitor.measure(operationName, async () => {

    if (isCrisis) {
      logger.info(`Crisis content detected, using extended timeout of ${timeout}ms`);

      // Check cache for crisis patterns
      if (crisisCache.shouldCache(prompt)) {
        const cachedResponse = crisisCache.get(prompt);
        if (cachedResponse) {
          logger.info('Using cached crisis response');
          // Record cache hit metric
          performanceMonitor.record(operationName + '.cache-hit', 0, true, {
            threadId,
            cached: true,
          });
          return cachedResponse as ShrinkResponse;
        }
      }
    }

    const headers: Record<string, string> = {};
    if (options?.idempotencyKey) {
      headers['x-idempotency-key'] = options.idempotencyKey;
    }

    const body = {
      prompt,
      threadId,
      userId: options?.userId,
      memoryContext: options?.memoryContext || '',
      enhancedContext: options?.enhancedContext || {},
      history: options?.history || [],
      systemPrompt: options?.systemPrompt,
      conversationType: options?.conversationType,
    };

    // Use retry strategy for crisis messages or when explicitly requested
    const shouldUseRetry = isCrisis || options?.conversationType === 'crisis';

    const response = shouldUseRetry
      ? await this.retryStrategy.execute(
          () => this.request<ShrinkResponse>(
            '/api/shrink?stream=false',
            {
              method: 'POST',
              headers,
              body: JSON.stringify(body),
            },
            timeout
          ),
          {
            maxAttempts: isCrisis ? 3 : 2,
            initialDelay: 2000,
            maxDelay: 10000,
            shouldRetry: (error) => {
              // Don't retry on explicit client errors
              if (error.message.includes('400') || error.message.includes('401')) {
                return false;
              }
              // Always retry crisis messages on timeout
              if (isCrisis && error.message.includes('timeout')) {
                logger.warn('Retrying crisis message after timeout');
                return true;
              }
              // Default retry logic
              return true;
            },
            onRetry: (attempt: number, error: Error) => {
              logger.warn(`Retrying message (attempt ${attempt}): ${error.message}`);
            },
          }
        )
      : await this.request<ShrinkResponse>(
          '/api/shrink?stream=false',
          {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          },
          timeout
        );

    // Log raw response for debugging
    logger.info('Raw shrink-chat response:', JSON.stringify(response, null, 2));

    const validated = ShrinkResponseSchema.parse(response);

    // Map 'reply' or 'response_text' to 'content' for consistency
    if (!validated.content && (validated.reply || validated.response_text)) {
      validated.content = validated.reply || validated.response_text;
    }

    // Normalize crisis_level field
    if (validated.crisis_level !== undefined && validated.crisisLevel === undefined) {
      // Convert "none" to 0 for consistency
      validated.crisisLevel = validated.crisis_level === "none" ? 0 :
                              typeof validated.crisis_level === 'number' ? validated.crisis_level :
                              parseInt(validated.crisis_level as string) || 0;
    }

    // Log parsed response
    logger.debug(`Parsed response - content: "${validated.content || '(empty)'}", length: ${validated.content?.length || 0}`);

    // Log crisis detection
    if (validated.crisisLevel && Number(validated.crisisLevel) > 7) {
      logger.warn(`Crisis detected in thread ${threadId}: Level ${validated.crisisLevel}`);
    }

    // Cache crisis responses for future use
    if (isCrisis && crisisCache.shouldCache(prompt)) {
      crisisCache.set(prompt, validated);
      logger.debug('Cached crisis response for future use');
    }

    return validated;
    }, {
      threadId,
      isCrisis,
      cached: false,
      messageLength: prompt.length,
      hasMemoryContext: !!options?.memoryContext,
    });
  }

  /**
   * Stream a message response (SSE)
   */
  async* streamMessage(
    prompt: string,
    threadId: string,
    options?: {
      memoryContext?: string;
      enhancedContext?: Record<string, unknown>;
      history?: Array<{ role: string; content: string }>;
      systemPrompt?: string;
      conversationType?: string;
      signal?: AbortSignal;
    }
  ): AsyncGenerator<ShrinkResponse> {
    const config = getConfig();
    const url = `${config.baseUrl}/api/shrink?stream=true`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Source': 'mcp-server',
      },
      body: JSON.stringify({
        prompt,
        threadId,
        memoryContext: options?.memoryContext || '',
        enhancedContext: options?.enhancedContext || {},
        history: options?.history || [],
        systemPrompt: options?.systemPrompt,
        conversationType: options?.conversationType,
      }),
      signal: options?.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`Stream failed: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              return;
            }
            try {
              const parsed = JSON.parse(data);
              yield parsed;
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Get recent messages for a thread
   */
  async getRecentMessages(
    threadId: string,
    limit: number = 10
  ): Promise<unknown> {
    const params = new URLSearchParams({ threadId, limit: String(limit) });
    return this.request(`/api/messages/recent?${params}`, {
      method: 'GET',
    });
  }

  /**
   * Log a message (for offline/manual logging)
   */
  async logMessage(
    threadId: string,
    role: 'user' | 'assistant',
    content: string,
    idempotencyKey?: string
  ): Promise<unknown> {
    const headers: Record<string, string> = {};
    if (idempotencyKey) {
      headers['x-idempotency-key'] = idempotencyKey;
    }

    return this.request('/api/chat/log', {
      method: 'POST',
      headers,
      body: JSON.stringify({ threadId, role, content }),
    });
  }

  /**
   * Health check for the shrink-chat API
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request('/api/health', { method: 'GET' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate a new thread ID (client-side)
   * Threads are created lazily server-side when first message is sent
   */
  generateThreadId(): string {
    return uuidv4();
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus() {
    return this.circuitBreaker.getStatistics();
  }
}

// Singleton instance
let clientInstance: ShrinkChatClient | null = null;

export function getShrinkChatClient(): ShrinkChatClient {
  if (!clientInstance) {
    clientInstance = new ShrinkChatClient();
  }
  return clientInstance;
}