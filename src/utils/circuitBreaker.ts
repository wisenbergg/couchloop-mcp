import { logger } from './logger.js';

export interface CircuitBreakerOptions {
  threshold?: number;      // Number of failures before opening
  timeout?: number;        // How long to wait in open state
  resetTimeout?: number;   // Time before trying half-open
  onOpen?: () => void;    // Callback when circuit opens
  onClose?: () => void;   // Callback when circuit closes
}

export class CircuitBreaker {
  private failures = 0;
  private lastFailTime?: Date;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private successCount = 0;
  private readonly successThreshold = 3; // Successful calls needed to close from half-open

  constructor(
    private threshold = 5,
    timeout = 60000, // 1 minute - not used as class property
    private resetTimeout = 30000, // 30 seconds
    private callbacks?: {
      onOpen?: () => void;
      onClose?: () => void;
    }
  ) {
    logger.info(`Circuit breaker initialized: threshold=${threshold}, timeout=${timeout}ms`);
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should transition from open to half-open
    if (this.state === 'open') {
      const timeSinceLastFailure = Date.now() - (this.lastFailTime?.getTime() || 0);

      if (timeSinceLastFailure > this.resetTimeout) {
        logger.info('Circuit breaker transitioning to half-open state');
        this.state = 'half-open';
        this.successCount = 0;
      } else {
        const remainingTime = Math.ceil((this.resetTimeout - timeSinceLastFailure) / 1000);
        throw new Error(`Circuit breaker is open. Retry in ${remainingTime} seconds`);
      }
    }

    try {
      const result = await fn();

      // Handle successful execution
      if (this.state === 'half-open') {
        this.successCount++;
        logger.debug(`Circuit breaker half-open: success ${this.successCount}/${this.successThreshold}`);

        if (this.successCount >= this.successThreshold) {
          this.close();
        }
      } else if (this.state === 'closed' && this.failures > 0) {
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
    this.lastFailTime = new Date();

    logger.warn(`Circuit breaker failure ${this.failures}/${this.threshold}: ${error}`);

    if (this.state === 'half-open') {
      // Immediately open on failure in half-open state
      this.open();
    } else if (this.failures >= this.threshold) {
      this.open();
    }
  }

  private open(): void {
    if (this.state !== 'open') {
      this.state = 'open';
      logger.error(`Circuit breaker opened after ${this.failures} failures`);
      this.callbacks?.onOpen?.();
    }
  }

  private close(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successCount = 0;
    logger.info('Circuit breaker closed');
    this.callbacks?.onClose?.();
  }

  /**
   * Get current circuit breaker status
   */
  getStatus(): {
    state: 'closed' | 'open' | 'half-open';
    failures: number;
    lastFailTime?: Date;
  } {
    return {
      state: this.state,
      failures: this.failures,
      lastFailTime: this.lastFailTime,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.close();
    this.lastFailTime = undefined;
    logger.info('Circuit breaker manually reset');
  }

  /**
   * Check if the circuit is currently available
   */
  isAvailable(): boolean {
    if (this.state === 'closed' || this.state === 'half-open') {
      return true;
    }

    // Check if enough time has passed to try half-open
    const timeSinceLastFailure = Date.now() - (this.lastFailTime?.getTime() || 0);
    return timeSinceLastFailure > this.resetTimeout;
  }
}