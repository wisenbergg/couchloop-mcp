import { logger } from './logger.js';

export enum ErrorType {
  NETWORK = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT_ERROR',
  VALIDATION = 'VALIDATION_ERROR',
  AUTHENTICATION = 'AUTHENTICATION_ERROR',
  RATE_LIMIT = 'RATE_LIMIT_ERROR',
  SERVER = 'SERVER_ERROR',
  CRISIS = 'CRISIS_HANDLING_ERROR',
  DATABASE = 'DATABASE_ERROR',
  UNKNOWN = 'UNKNOWN_ERROR',
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface ErrorContext {
  type: ErrorType;
  severity: ErrorSeverity;
  message: string;
  originalError?: Error;
  metadata?: Record<string, any>;
  timestamp: Date;
  recoverable: boolean;
  userMessage?: string;
}

export class ApplicationError extends Error {
  public readonly context: ErrorContext;

  constructor(context: Partial<ErrorContext> & { message: string }) {
    super(context.message);
    this.name = 'ApplicationError';

    this.context = {
      type: context.type || ErrorType.UNKNOWN,
      severity: context.severity || ErrorSeverity.MEDIUM,
      message: context.message,
      originalError: context.originalError,
      metadata: context.metadata || {},
      timestamp: context.timestamp || new Date(),
      recoverable: context.recoverable ?? true,
      userMessage: context.userMessage,
    };
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      context: this.context,
      stack: this.stack,
    };
  }
}

/**
 * Error handler with recovery strategies
 */
export class ErrorHandler {
  private errorCount = new Map<ErrorType, number>();
  private lastError = new Map<ErrorType, Date>();

  /**
   * Classify error based on message and characteristics
   */
  classifyError(error: Error): ErrorType {
    const message = error.message.toLowerCase();

    // Network errors
    if (message.includes('network') ||
        message.includes('econnrefused') ||
        message.includes('econnreset') ||
        message.includes('fetch failed')) {
      return ErrorType.NETWORK;
    }

    // Timeout errors
    if (message.includes('timeout') ||
        message.includes('timed out')) {
      return ErrorType.TIMEOUT;
    }

    // Authentication errors
    if (message.includes('401') ||
        message.includes('unauthorized') ||
        message.includes('authentication')) {
      return ErrorType.AUTHENTICATION;
    }

    // Rate limiting
    if (message.includes('429') ||
        message.includes('rate limit') ||
        message.includes('too many requests')) {
      return ErrorType.RATE_LIMIT;
    }

    // Validation errors
    if (message.includes('validation') ||
        message.includes('invalid') ||
        message.includes('expected')) {
      return ErrorType.VALIDATION;
    }

    // Server errors
    if (message.includes('500') ||
        message.includes('502') ||
        message.includes('503') ||
        message.includes('server error')) {
      return ErrorType.SERVER;
    }

    // Database errors
    if (message.includes('database') ||
        message.includes('connection pool') ||
        message.includes('query failed')) {
      return ErrorType.DATABASE;
    }

    // Crisis handling errors
    if (message.includes('crisis') ||
        message.includes('emergency')) {
      return ErrorType.CRISIS;
    }

    return ErrorType.UNKNOWN;
  }

  /**
   * Determine error severity
   */
  determineSeverity(type: ErrorType, _error: Error): ErrorSeverity {
    // Critical errors that need immediate attention
    if (type === ErrorType.CRISIS) {
      return ErrorSeverity.CRITICAL;
    }

    // High severity for authentication and database issues
    if (type === ErrorType.AUTHENTICATION ||
        type === ErrorType.DATABASE) {
      return ErrorSeverity.HIGH;
    }

    // Medium for server and timeout errors
    if (type === ErrorType.SERVER ||
        type === ErrorType.TIMEOUT) {
      return ErrorSeverity.MEDIUM;
    }

    // Low for network and rate limit (usually transient)
    if (type === ErrorType.NETWORK ||
        type === ErrorType.RATE_LIMIT) {
      return ErrorSeverity.LOW;
    }

    return ErrorSeverity.MEDIUM;
  }

  /**
   * Handle error with appropriate recovery strategy
   */
  async handle(error: Error, context?: Record<string, any>): Promise<ErrorContext> {
    const type = this.classifyError(error);
    const severity = this.determineSeverity(type, error);

    // Track error frequency
    this.trackError(type);

    // Create error context
    const errorContext: ErrorContext = {
      type,
      severity,
      message: error.message,
      originalError: error,
      metadata: context,
      timestamp: new Date(),
      recoverable: this.isRecoverable(type),
      userMessage: this.getUserMessage(type, error),
    };

    // Log based on severity
    this.logError(errorContext);

    // Apply recovery strategy
    await this.applyRecoveryStrategy(errorContext);

    return errorContext;
  }

  /**
   * Track error frequency for monitoring
   */
  private trackError(type: ErrorType): void {
    const count = this.errorCount.get(type) || 0;
    this.errorCount.set(type, count + 1);
    this.lastError.set(type, new Date());

    // Alert if error frequency is too high
    if (count > 10) {
      logger.error(`High frequency of ${type} errors: ${count} occurrences`);
    }
  }

  /**
   * Determine if error is recoverable
   */
  private isRecoverable(type: ErrorType): boolean {
    switch (type) {
      case ErrorType.NETWORK:
      case ErrorType.TIMEOUT:
      case ErrorType.RATE_LIMIT:
      case ErrorType.SERVER:
        return true;
      case ErrorType.AUTHENTICATION:
      case ErrorType.VALIDATION:
        return false;
      case ErrorType.CRISIS:
        return true;  // Always try to recover from crisis handling errors
      default:
        return true;
    }
  }

  /**
   * Get user-friendly error message
   */
  private getUserMessage(type: ErrorType, _error: Error): string {
    switch (type) {
      case ErrorType.NETWORK:
        return 'Connection issue. Please check your internet and try again.';
      case ErrorType.TIMEOUT:
        return 'The request is taking longer than expected. Please try again.';
      case ErrorType.AUTHENTICATION:
        return 'Authentication failed. Please check your credentials.';
      case ErrorType.RATE_LIMIT:
        return 'Too many requests. Please wait a moment and try again.';
      case ErrorType.VALIDATION:
        return 'Invalid input provided. Please check your data and try again.';
      case ErrorType.SERVER:
        return 'Server error occurred. Our team has been notified.';
      case ErrorType.DATABASE:
        return 'Database issue encountered. Please try again later.';
      case ErrorType.CRISIS:
        return 'We\'re having trouble processing your message. If this is an emergency, please call 988 (Suicide & Crisis Lifeline).';
      default:
        return 'An unexpected error occurred. Please try again.';
    }
  }

  /**
   * Log error based on severity
   */
  private logError(context: ErrorContext): void {
    const logData = {
      type: context.type,
      severity: context.severity,
      message: context.message,
      metadata: context.metadata,
      timestamp: context.timestamp,
    };

    switch (context.severity) {
      case ErrorSeverity.CRITICAL:
        logger.error('[CRITICAL]', logData);
        // Could trigger alerts here
        break;
      case ErrorSeverity.HIGH:
        logger.error('[HIGH]', logData);
        break;
      case ErrorSeverity.MEDIUM:
        logger.warn('[MEDIUM]', logData);
        break;
      case ErrorSeverity.LOW:
        logger.debug('[LOW]', logData);
        break;
    }
  }

  /**
   * Apply recovery strategy based on error type
   */
  private async applyRecoveryStrategy(context: ErrorContext): Promise<void> {
    switch (context.type) {
      case ErrorType.NETWORK:
        // Network errors: wait and retry
        await this.delay(2000);
        break;

      case ErrorType.TIMEOUT:
        // Timeout: increase timeout for next attempt
        context.metadata = {
          ...context.metadata,
          suggestedTimeout: 60000,
        };
        break;

      case ErrorType.RATE_LIMIT: {
        // Rate limit: exponential backoff
        const waitTime = this.calculateBackoff(context.type);
        await this.delay(waitTime);
        break;
      }

      case ErrorType.SERVER:
        // Server error: circuit breaker pattern
        context.metadata = {
          ...context.metadata,
          useCircuitBreaker: true,
        };
        break;

      case ErrorType.CRISIS:
        // Crisis error: fallback to emergency response
        context.metadata = {
          ...context.metadata,
          fallbackToEmergencyResponse: true,
          emergencyResources: this.getEmergencyResources(),
        };
        break;

      case ErrorType.DATABASE:
        // Database error: use cache or fallback
        context.metadata = {
          ...context.metadata,
          useCache: true,
          fallbackToLocal: true,
        };
        break;

      default:
        // Unknown errors: log and continue
        logger.warn('No specific recovery strategy for error type:', context.type);
    }
  }

  /**
   * Calculate backoff time based on error frequency
   */
  private calculateBackoff(type: ErrorType): number {
    const count = this.errorCount.get(type) || 1;
    return Math.min(1000 * Math.pow(2, count - 1), 30000);  // Max 30 seconds
  }

  /**
   * Simple delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get emergency resources for crisis situations
   */
  private getEmergencyResources() {
    return [
      {
        name: '988 Suicide & Crisis Lifeline',
        phone: '988',
        text: 'Text "HELLO" to 741741',
        available: '24/7',
      },
      {
        name: 'Emergency Services',
        phone: '911',
        available: '24/7',
      },
    ];
  }

  /**
   * Get error statistics
   */
  getStats() {
    const stats: Record<string, any> = {};

    for (const [type, count] of this.errorCount.entries()) {
      const lastOccurrence = this.lastError.get(type);
      stats[type] = {
        count,
        lastOccurrence: lastOccurrence?.toISOString(),
      };
    }

    return stats;
  }

  /**
   * Reset error tracking
   */
  reset(): void {
    this.errorCount.clear();
    this.lastError.clear();
  }
}

// Export singleton instance
export const errorHandler = new ErrorHandler();

// Convenience function
export async function handleError(
  error: Error,
  context?: Record<string, any>
): Promise<ErrorContext> {
  return errorHandler.handle(error, context);
}