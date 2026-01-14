import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RetryStrategy, withRetry } from '../../src/utils/retryStrategy';

describe('RetryStrategy', () => {
  let strategy: RetryStrategy;

  beforeEach(() => {
    vi.useFakeTimers();
    strategy = new RetryStrategy();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Basic Retry Logic', () => {
    it('should succeed on first try', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await strategy.execute(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const resultPromise = strategy.execute(fn, { maxAttempts: 3 });

      // Advance through retries
      await vi.runAllTimersAsync();

      const result = await resultPromise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should fail after max attempts', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('persistent failure'));

      const resultPromise = strategy.execute(fn, { maxAttempts: 3 });

      await vi.runAllTimersAsync();

      await expect(resultPromise).rejects.toThrow('persistent failure');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should use default options when none provided', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      const resultPromise = strategy.execute(fn);
      await vi.runAllTimersAsync();

      await expect(resultPromise).rejects.toThrow();
      // Default is 3 attempts
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('Backoff Strategies', () => {
    it('should use exponential backoff', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const resultPromise = strategy.execute(fn, {
        maxAttempts: 3,
        initialDelay: 100,
        backoffMultiplier: 2,
        jitter: false,
      });

      // Wait for first attempt to fail
      await vi.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);

      // Wait for first retry (100ms)
      await vi.advanceTimersByTimeAsync(100);
      expect(fn).toHaveBeenCalledTimes(2);

      // Wait for second retry (200ms)
      await vi.advanceTimersByTimeAsync(200);
      expect(fn).toHaveBeenCalledTimes(3);

      const result = await resultPromise;
      expect(result).toBe('success');
    });

    it('should apply jitter when enabled', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const resultPromise = strategy.execute(fn, {
        maxAttempts: 3,
        initialDelay: 100,
        jitter: true,
      });

      // With jitter, delays vary but should complete eventually
      await vi.runAllTimersAsync();

      const result = await resultPromise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should respect max delay', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const resultPromise = strategy.execute(fn, {
        maxAttempts: 4,
        initialDelay: 1000,
        backoffMultiplier: 10,
        maxDelay: 2000,
        jitter: false,
      });

      // All delays should be capped at maxDelay
      // First retry: 1000ms, Second: 2000ms (capped), Third: 2000ms (capped)
      await vi.advanceTimersByTimeAsync(0); // First attempt
      expect(fn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000); // First retry
      expect(fn).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(2000); // Second retry (capped)
      expect(fn).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(2000); // Third retry (capped)
      expect(fn).toHaveBeenCalledTimes(4);

      const result = await resultPromise;
      expect(result).toBe('success');
    });
  });

  describe('Retryable Errors', () => {
    it('should retry on retryable errors', async () => {
      const retryableError = new Error('Network timeout');
      const fn = vi.fn()
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue('success');

      const resultPromise = strategy.execute(fn, {
        isRetryable: (error) => error.message.includes('timeout'),
      });

      await vi.runAllTimersAsync();

      const result = await resultPromise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable errors', async () => {
      const nonRetryableError = new Error('Invalid input');
      const fn = vi.fn().mockRejectedValue(nonRetryableError);

      const resultPromise = strategy.execute(fn, {
        maxAttempts: 3,
        isRetryable: (error) => !error.message.includes('Invalid'),
      });

      await vi.runAllTimersAsync();

      await expect(resultPromise).rejects.toThrow('Invalid input');
      expect(fn).toHaveBeenCalledTimes(1); // No retries
    });

    it('should handle network errors specifically', async () => {
      const networkError = new Error('ECONNREFUSED');
      const fn = vi.fn()
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError)
        .mockResolvedValue('success');

      const resultPromise = strategy.execute(fn, {
        isRetryable: (error) => error.message.includes('ECONNREFUSED'),
      });

      await vi.runAllTimersAsync();

      const result = await resultPromise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('Callbacks', () => {
    it('should call onRetry callback', async () => {
      const onRetry = vi.fn();
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const resultPromise = strategy.execute(fn, { onRetry });

      await vi.runAllTimersAsync();

      await resultPromise;
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
    });

    it('should provide correct attempt number to onRetry', async () => {
      const attemptNumbers: number[] = [];
      const onRetry = vi.fn((attempt) => {
        attemptNumbers.push(attempt);
      });

      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockRejectedValueOnce(new Error('fail2'))
        .mockResolvedValue('success');

      const resultPromise = strategy.execute(fn, {
        maxAttempts: 3,
        onRetry,
      });

      await vi.runAllTimersAsync();

      await resultPromise;
      expect(attemptNumbers).toEqual([1, 2]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle immediate success with maxAttempts = 1', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await strategy.execute(fn, { maxAttempts: 1 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should handle immediate failure with maxAttempts = 1', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(strategy.execute(fn, { maxAttempts: 1 }))
        .rejects.toThrow('fail');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should handle async errors', async () => {
      const fn = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('async fail');
      });

      const resultPromise = strategy.execute(fn, { maxAttempts: 2 });

      // Process all timers and ensure promise rejection is handled
      await Promise.all([
        vi.runAllTimersAsync(),
        resultPromise.catch(() => {}) // Catch to prevent unhandled rejection
      ]);

      await expect(resultPromise).rejects.toThrow('async fail');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should handle zero initial delay', async () => {
      // Use real timers for zero delay test
      vi.useRealTimers();

      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const result = await strategy.execute(fn, {
        initialDelay: 0,
        maxAttempts: 2,
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);

      // Restore fake timers for next test
      vi.useFakeTimers();
    });
  });

  describe('withRetry Helper', () => {
    it('should work with helper function', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const resultPromise = withRetry(fn, {
        maxAttempts: 2,
      });

      await vi.runAllTimersAsync();

      const result = await resultPromise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should use default options in helper', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await withRetry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle mixed success and failure pattern', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockResolvedValueOnce('partial')
        .mockRejectedValueOnce(new Error('fail2'))
        .mockResolvedValue('complete');

      let callCount = 0;
      const wrappedFn = async () => {
        callCount++;
        if (callCount <= 3) {
          throw new Error(`attempt ${callCount}`);
        }
        return 'success';
      };

      const resultPromise = strategy.execute(wrappedFn, {
        maxAttempts: 4,
      });

      await vi.runAllTimersAsync();

      const result = await resultPromise;
      expect(result).toBe('success');
      expect(callCount).toBe(4);
    });

    it('should handle concurrent executions', async () => {
      const fn1 = vi.fn().mockResolvedValue('result1');
      const fn2 = vi.fn().mockResolvedValue('result2');

      const [result1, result2] = await Promise.all([
        strategy.execute(fn1),
        strategy.execute(fn2),
      ]);

      expect(result1).toBe('result1');
      expect(result2).toBe('result2');
      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(1);
    });
  });
});