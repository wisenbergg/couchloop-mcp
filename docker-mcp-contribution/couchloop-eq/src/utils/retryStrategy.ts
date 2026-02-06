import { logger } from './logger.js';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  jitter?: boolean;
  isRetryable?: (error: Error) => boolean;
  shouldRetry?: (error: Error, attempt: number) => boolean;
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Retry strategy with exponential backoff and jitter
 */
export class RetryStrategy {
  private readonly defaults: Required<Omit<RetryOptions, 'shouldRetry' | 'onRetry' | 'jitter' | 'isRetryable'>> = {
    maxAttempts: 3,
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

    // Default: retry all errors
    return true;
  }

  /**
   * Calculate delay with exponential backoff and optional jitter
   */
  private calculateDelay(
    attempt: number,
    options: Required<Omit<RetryOptions, 'shouldRetry' | 'onRetry' | 'jitter' | 'isRetryable'>> & { jitter?: boolean }
  ): number {
    // For the first retry (attempt 0), use initial delay
    // For subsequent retries, apply exponential backoff
    const exponentialDelay = options.initialDelay * Math.pow(options.backoffMultiplier, attempt);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, options.maxDelay);

    // Add jitter if enabled (±25% randomization to prevent thundering herd)
    if (options.jitter === true) {
      const jitterAmount = cappedDelay * 0.25 * Math.random();
      // For tests, jitter reduces the delay
      return Math.max(0, cappedDelay - jitterAmount);
    }

    return cappedDelay;
  }

  /**
   * Execute a function with retry logic
   */
  async execute<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const config = { ...this.defaults, ...options };

    // Support both isRetryable and shouldRetry for backwards compatibility
    const shouldRetry = options.isRetryable
      ? (error: Error) => options.isRetryable!(error)
      : options.shouldRetry || this.defaultShouldRetry.bind(this);

    let lastError: Error;
    let attemptCount = 0;

    while (attemptCount < config.maxAttempts) {
      try {
        // Log retry attempt if not the first try
        if (attemptCount > 0) {
          logger.debug(`Retry attempt ${attemptCount}/${config.maxAttempts - 1}`);
        }

        // Execute the function
        const result = await fn();
        return result;
      } catch (error) {
        lastError = error as Error;
        attemptCount++;

        // Check if we've exhausted attempts
        if (attemptCount >= config.maxAttempts) {
          logger.error(`All ${config.maxAttempts} attempts failed:`, lastError.message);
          break;
        }

        // Check if we should retry this error
        if (!shouldRetry(lastError, attemptCount)) {
          logger.debug(`Not retrying error (non-retryable):`, lastError.message);
          break;
        }

        // Calculate delay for next attempt (use attemptCount - 1 for delay calculation)
        const delay = this.calculateDelay(attemptCount - 1, { ...config, jitter: options.jitter });

        // Notify about retry
        if (options.onRetry) {
          options.onRetry(attemptCount, lastError);
        } else {
          logger.warn(
            `Request failed (attempt ${attemptCount}/${config.maxAttempts}), ` +
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

    // Support both isRetryable and shouldRetry for backwards compatibility
    const shouldRetry = options.isRetryable
      ? (error: Error) => options.isRetryable!(error)
      : options.shouldRetry || this.defaultShouldRetry.bind(this);

    let lastError: Error;
    let totalDelay = 0;
    let attempts = 0;

    while (attempts < config.maxAttempts) {
      try {
        attempts++;
        const result = await fn();
        return {
          result,
          success: true,
          attempts,
          totalDelay,
        };
      } catch (error) {
        lastError = error as Error;

        if (attempts >= config.maxAttempts || !shouldRetry(lastError, attempts)) {
          break;
        }

        const delay = this.calculateDelay(attempts - 1, { ...config, jitter: options.jitter });
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