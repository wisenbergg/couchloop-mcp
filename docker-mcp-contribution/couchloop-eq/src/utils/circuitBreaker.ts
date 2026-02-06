import { logger } from './logger.js';

export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open'
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;      // Number of failures before opening
  resetTimeout?: number;          // Time before trying half-open
  halfOpenMaxAttempts?: number;   // Max attempts in half-open state
  onOpen?: () => void;           // Callback when circuit opens
  onClose?: () => void;          // Callback when circuit closes
}

export interface CircuitBreakerStatistics {
  state: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  rejectedCalls: number;
  successRate: number;
  lastFailTime?: Date;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export class CircuitBreaker {
  private failures = 0;
  private lastFailTime?: Date;
  private state: CircuitState = CircuitState.CLOSED;
  private successCount = 0;
  private halfOpenAttempts = 0;

  // Statistics tracking
  private totalCalls = 0;
  private successfulCalls = 0;
  private failedCalls = 0;
  private rejectedCalls = 0;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;

  // Configuration
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly halfOpenMaxAttempts: number;
  private readonly callbacks?: {
    onOpen?: () => void;
    onClose?: () => void;
  };

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 30000;
    this.halfOpenMaxAttempts = options.halfOpenMaxAttempts || 3;
    this.callbacks = {
      onOpen: options.onOpen,
      onClose: options.onClose
    };

    logger.info(`Circuit breaker initialized: threshold=${this.failureThreshold}, resetTimeout=${this.resetTimeout}ms`);
  }

  async execute<T>(_operation: string, fn: () => Promise<T>): Promise<T> {
    this.totalCalls++;

    // Check state and transition if needed
    this.checkStateTransition();

    // Reject if circuit is open
    if (this.state === CircuitState.OPEN) {
      this.rejectedCalls++;
      const timeSinceLastFailure = Date.now() - (this.lastFailTime?.getTime() || 0);
      const remainingTime = Math.ceil((this.resetTimeout - timeSinceLastFailure) / 1000);
      throw new Error(`Circuit breaker is open. Retry in ${remainingTime} seconds`);
    }

    // Check half-open attempts limit
    if (this.state === CircuitState.HALF_OPEN) {
      // Increment for this attempt first
      this.halfOpenAttempts++;
      // Check if we've exceeded the max attempts
      if (this.halfOpenAttempts > this.halfOpenMaxAttempts) {
        this.rejectedCalls++;
        throw new Error('Half-open state: max attempts reached');
      }
    }

    try {
      const result = await fn();

      // Handle successful execution
      this.successfulCalls++;
      this.consecutiveSuccesses++;
      this.consecutiveFailures = 0;

      if (this.state === CircuitState.HALF_OPEN) {
        this.successCount++;
        logger.debug(`Circuit breaker half-open: success ${this.successCount}`);

        // Only close if we've had a successful attempt
        // The getState() method will handle the actual state transition
        // by checking conditions, allowing tests to verify state properly
        if (this.successCount >= 1) {
          this.state = CircuitState.CLOSED;
          this.failures = 0;
          this.successCount = 0;
          this.halfOpenAttempts = 0;
          logger.info('Circuit breaker closed after successful half-open test');
          this.callbacks?.onClose?.();
        }
      } else if (this.state === CircuitState.CLOSED && this.failures > 0) {
        // Reset failure count on success when closed
        this.failures = 0;
      }

      return result;
    } catch (error) {
      this.handleFailure(error);
      throw error;
    }
  }

  private handleFailure(error: unknown): void {
    this.failures++;
    this.failedCalls++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailTime = new Date();

    logger.warn(`Circuit breaker failure ${this.failures}/${this.failureThreshold}: ${error}`);

    if (this.state === CircuitState.HALF_OPEN) {
      // Immediately open on failure in half-open state
      this.open();
    } else if (this.failures >= this.failureThreshold) {
      this.open();
    }
  }

  private open(): void {
    if (this.state !== CircuitState.OPEN) {
      this.state = CircuitState.OPEN;
      logger.error(`Circuit breaker opened after ${this.failures} failures`);
      this.callbacks?.onOpen?.();
    }
  }

  private close(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successCount = 0;
    this.halfOpenAttempts = 0;
    logger.info('Circuit breaker closed');
    this.callbacks?.onClose?.();
  }

  /**
   * Check and perform state transitions
   */
  private checkStateTransition(): void {
    if (this.state === CircuitState.OPEN) {
      const timeSinceLastFailure = Date.now() - (this.lastFailTime?.getTime() || 0);
      if (timeSinceLastFailure > this.resetTimeout) {
        logger.info('Circuit breaker transitioning to half-open state');
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        this.halfOpenAttempts = 0;
      }
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    // Check for state transition before returning
    this.checkStateTransition();
    return this.state;
  }

  /**
   * Get statistics
   */
  getStatistics(): CircuitBreakerStatistics {
    const successRate = this.totalCalls > 0
      ? (this.successfulCalls / this.totalCalls) * 100
      : 0;

    return {
      state: this.state,
      totalCalls: this.totalCalls,
      successfulCalls: this.successfulCalls,
      failedCalls: this.failedCalls,
      rejectedCalls: this.rejectedCalls,
      successRate: Math.round(successRate * 100) / 100, // Round to 2 decimal places
      lastFailTime: this.lastFailTime,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
    };
  }

  /**
   * Force circuit to open state
   */
  forceOpen(): void {
    this.state = CircuitState.OPEN;
    this.lastFailTime = new Date();
    logger.info('Circuit breaker forced open');
    this.callbacks?.onOpen?.();
  }

  /**
   * Force circuit to closed state
   */
  forceClose(): void {
    this.close();
    logger.info('Circuit breaker forced closed');
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successCount = 0;
    this.halfOpenAttempts = 0;
    this.totalCalls = 0;
    this.successfulCalls = 0;
    this.failedCalls = 0;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailTime = undefined;
    logger.info('Circuit breaker manually reset');
  }

  /**
   * Check if the circuit is currently available
   */
  isAvailable(): boolean {
    if (this.state === CircuitState.CLOSED || this.state === CircuitState.HALF_OPEN) {
      return true;
    }

    // Check if enough time has passed to try half-open
    const timeSinceLastFailure = Date.now() - (this.lastFailTime?.getTime() || 0);
    return timeSinceLastFailure > this.resetTimeout;
  }

  /**
   * Health check
   */
  async healthCheck(fn?: () => Promise<boolean>): Promise<boolean> {
    // If circuit is open, don't run the health check function
    if (this.state === CircuitState.OPEN) {
      return false;
    }

    // If a health check function is provided, run it
    if (fn) {
      try {
        return await fn();
      } catch {
        return false;
      }
    }

    // Default: healthy if not open
    return true;
  }

  /**
   * Get current circuit breaker status (legacy)
   */
  getStatus(): {
    state: CircuitState;
    failures: number;
    lastFailTime?: Date;
  } {
    return {
      state: this.state,
      failures: this.failures,
      lastFailTime: this.lastFailTime,
    };
  }
}