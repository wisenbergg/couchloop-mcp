import { logger } from './logger.js';

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: Error, attempt: number) => boolean;
  onRetry?: (error: Error, attempt: number, nextDelay: number) => void;
}

/**
 * Retry strategy with exponential backoff and jitter
 */
export class RetryStrategy {
  private readonly defaults: Required<Omit<RetryOptions, 'shouldRetry' | 'onRetry'>> = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
  };

  /**
   * Default retry predicate - retries on network errors and 5xx status codes
   */
  private defaultShouldRetry(error: Error): boolean {
    const message = error.message.toLowerCase();

    // Don't retry on client errors (4xx)
    if (message.includes('400') || message.includes('401') ||
        message.includes('403') || message.includes('404')) {
      return false;
    }

    // Retry on network errors
    if (message.includes('network') || message.includes('timeout') ||
        message.includes('econnrefused') || message.includes('econnreset')) {
      return true;
    }

    // Retry on server errors (5xx)
    if (message.includes('500') || message.includes('502') ||
        message.includes('503') || message.includes('504')) {
      return true;
    }

    // Retry on circuit breaker open (temporary failure)
    if (message.includes('circuit breaker')) {
      return true;
    }

    return false;
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private calculateDelay(attempt: number, options: Required<Omit<RetryOptions, 'shouldRetry' | 'onRetry'>>): number {
    // Exponential backoff
    const exponentialDelay = options.initialDelay * Math.pow(options.backoffMultiplier, attempt);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, options.maxDelay);

    // Add jitter (±25% randomization to prevent thundering herd)
    const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);

    return Math.max(0, cappedDelay + jitter);
  }

  /**
   * Execute a function with retry logic
   */
  async execute<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const config = { ...this.defaults, ...options };
    const shouldRetry = options.shouldRetry || this.defaultShouldRetry;

    let lastError: Error;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        // First attempt or retry
        if (attempt > 0) {
          logger.debug(`Retry attempt ${attempt}/${config.maxRetries}`);
        }

        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Check if we've exhausted retries
        if (attempt === config.maxRetries) {
          logger.error(`All ${config.maxRetries} retry attempts failed:`, lastError.message);
          break;
        }

        // Check if we should retry this error
        if (!shouldRetry(lastError, attempt)) {
          logger.debug(`Not retrying error (non-retryable):`, lastError.message);
          break;
        }

        // Calculate delay for next attempt
        const delay = this.calculateDelay(attempt, config);

        // Notify about retry
        if (options.onRetry) {
          options.onRetry(lastError, attempt + 1, delay);
        } else {
          logger.warn(
            `Request failed (attempt ${attempt + 1}/${config.maxRetries + 1}), ` +
            `retrying in ${Math.round(delay)}ms: ${lastError.message}`
          );
        }

        // Wait before retrying
        await this.delay(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Execute with retry and return result with metadata
   */
  async executeWithMetadata<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<{
    result?: T;
    success: boolean;
    attempts: number;
    totalDelay: number;
    error?: Error;
  }> {
    const config = { ...this.defaults, ...options };
    const shouldRetry = options.shouldRetry || this.defaultShouldRetry;

    let lastError: Error;
    let totalDelay = 0;
    let attempts = 0;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      attempts++;

      try {
        const result = await fn();
        return {
          result,
          success: true,
          attempts,
          totalDelay,
        };
      } catch (error) {
        lastError = error as Error;

        if (attempt === config.maxRetries || !shouldRetry(lastError, attempt)) {
          break;
        }

        const delay = this.calculateDelay(attempt, config);
        totalDelay += delay;
        await this.delay(delay);
      }
    }

    return {
      success: false,
      attempts,
      totalDelay,
      error: lastError!,
    };
  }

  /**
   * Simple delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create a retry wrapper for a specific function
   */
  wrap<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    options: RetryOptions = {}
  ): T {
    return (async (...args: Parameters<T>) => {
      return this.execute(() => fn(...args), options);
    }) as T;
  }
}

// Singleton instance
export const retryStrategy = new RetryStrategy();

// Convenience function for one-off retries
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  return retryStrategy.execute(fn, options);
}

// Export types
export type { RetryOptions };