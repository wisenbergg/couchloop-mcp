import { logger } from './logger.js';

export class CouchLoopError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'CouchLoopError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

export class ValidationError extends CouchLoopError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends CouchLoopError {
  constructor(message: string = 'Authentication required') {
    super(message, 'AUTHENTICATION_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends CouchLoopError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 'AUTHORIZATION_ERROR', 403);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends CouchLoopError {
  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} with id ${identifier} not found`
      : `${resource} not found`;
    super(message, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends CouchLoopError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFLICT', 409, details);
    this.name = 'ConflictError';
  }
}

export class DatabaseError extends CouchLoopError {
  constructor(message: string, originalError?: unknown) {
    super(message, 'DATABASE_ERROR', 500, { originalError });
    this.name = 'DatabaseError';
  }
}

export function handleError(error: unknown): { error: string; details?: Record<string, unknown> } {
  if (error instanceof CouchLoopError) {
    return {
      error: error.message,
      details: error.details,
    };
  }

  // Log unexpected errors
  logger.error('Unexpected error:', error);

  return {
    error: 'An unexpected error occurred',
    details: process.env.NODE_ENV === 'development'
      ? { message: error instanceof Error ? error.message : String(error) }
      : undefined,
  };
}