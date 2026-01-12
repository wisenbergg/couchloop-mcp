import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CircuitBreaker, CircuitState } from '../../src/utils/circuitBreaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 1000,
      halfOpenMaxAttempts: 2,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Closed State', () => {
    it('should execute function successfully when closed', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await breaker.execute('test-op', fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should remain closed on successful calls', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      for (let i = 0; i < 5; i++) {
        await breaker.execute('test-op', fn);
      }

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      expect(fn).toHaveBeenCalledTimes(5);
    });

    it('should count failures but stay closed below threshold', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      try {
        await breaker.execute('test-op', fn);
      } catch {}

      try {
        await breaker.execute('test-op', fn);
      } catch {}

      expect(breaker.getState()).toBe(CircuitState.CLOSED);

      const result = await breaker.execute('test-op', fn);
      expect(result).toBe('success');
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('Open State', () => {
    it('should open after reaching failure threshold', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute('test-op', fn);
        } catch {}
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should reject immediately when open', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute('test-op', fn);
        } catch {}
      }

      // Should reject without calling function
      const successFn = vi.fn().mockResolvedValue('success');
      await expect(breaker.execute('test-op', successFn))
        .rejects.toThrow('Circuit breaker is open');

      expect(successFn).not.toHaveBeenCalled();
    });

    it('should report statistics correctly', () => {
      const stats = breaker.getStatistics();

      expect(stats).toMatchObject({
        state: expect.any(String),
        totalCalls: expect.any(Number),
        successfulCalls: expect.any(Number),
        failedCalls: expect.any(Number),
        rejectedCalls: expect.any(Number),
        successRate: expect.any(Number),
      });
    });
  });

  describe('Half-Open State', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should transition to half-open after reset timeout', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute('test-op', fn);
        } catch {}
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Wait for reset timeout
      vi.advanceTimersByTime(1001);

      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
    });

    it('should close on successful call in half-open state', async () => {
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));
      const successFn = vi.fn().mockResolvedValue('success');

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute('test-op', failFn);
        } catch {}
      }

      // Move to half-open
      vi.advanceTimersByTime(1001);
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      // Successful call should close circuit
      const result = await breaker.execute('test-op', successFn);
      expect(result).toBe('success');
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should reopen on failure in half-open state', async () => {
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute('test-op', failFn);
        } catch {}
      }

      // Move to half-open
      vi.advanceTimersByTime(1001);
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      // Failed call should reopen circuit
      try {
        await breaker.execute('test-op', failFn);
      } catch {}

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should limit attempts in half-open state', async () => {
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));
      const successFn = vi.fn().mockResolvedValue('success');

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute('test-op', failFn);
        } catch {}
      }

      // Move to half-open
      vi.advanceTimersByTime(1001);
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      // First attempt allowed
      try {
        await breaker.execute('test-op-1', successFn);
      } catch {}

      // Second attempt allowed
      try {
        await breaker.execute('test-op-2', successFn);
      } catch {}

      // Third attempt should be rejected (max is 2)
      await expect(breaker.execute('test-op-3', successFn))
        .rejects.toThrow('Half-open state: max attempts reached');
    });
  });

  describe('Force Operations', () => {
    it('should allow forced open', () => {
      breaker.forceOpen();
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should allow forced close', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute('test-op', fn);
        } catch {}
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);

      breaker.forceClose();
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should allow reset', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      // Create some history
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute('test-op', fn);
        } catch {}
      }

      const statsBefore = breaker.getStatistics();
      expect(statsBefore.failedCalls).toBe(2);

      breaker.reset();

      const statsAfter = breaker.getStatistics();
      expect(statsAfter.failedCalls).toBe(0);
      expect(statsAfter.totalCalls).toBe(0);
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('Error Handling', () => {
    it('should handle different error types', async () => {
      const timeoutError = new Error('Timeout');
      const networkError = new Error('Network failed');
      const businessError = new Error('Business logic error');

      const fn = vi.fn()
        .mockRejectedValueOnce(timeoutError)
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(businessError);

      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(`test-op-${i}`, fn);
        } catch (error) {
          expect(error).toBeDefined();
        }
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should preserve original error message', async () => {
      const originalError = new Error('Original error message');
      const fn = vi.fn().mockRejectedValue(originalError);

      try {
        await breaker.execute('test-op', fn);
      } catch (error: any) {
        expect(error.message).toBe('Original error message');
      }
    });
  });

  describe('Health Check', () => {
    it('should perform health check', async () => {
      const healthCheckFn = vi.fn().mockResolvedValue(true);
      const isHealthy = await breaker.healthCheck(healthCheckFn);

      expect(isHealthy).toBe(true);
      expect(healthCheckFn).toHaveBeenCalled();
    });

    it('should report unhealthy when circuit is open', async () => {
      breaker.forceOpen();

      const healthCheckFn = vi.fn().mockResolvedValue(true);
      const isHealthy = await breaker.healthCheck(healthCheckFn);

      expect(isHealthy).toBe(false);
      expect(healthCheckFn).not.toHaveBeenCalled();
    });
  });
});