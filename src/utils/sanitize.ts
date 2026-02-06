/**
 * Response Sanitization Utilities
 * 
 * Strips sensitive internal metadata from responses before returning to users.
 * Full data is logged server-side for debugging.
 */

import { logger } from './logger.js';

/**
 * Fields that should NEVER be exposed to end users
 */
const SENSITIVE_FIELDS = [
  'sessionId',
  'session_id',
  'threadId',
  'thread_id',
  'messageId',
  'message_id',
  'userId',
  'user_id',
  'insightId',
  'insight_id',
  'checkpointId',
  'checkpoint_id',
  'crisisLevel',
  'crisis_level',
  'crisisConfidence',
  'crisis_confidence',
  'crisisIndicators',
  'crisis_indicators',
  'selfCorrected',
  'self_corrected',
  'currentStep',
  'current_step',
  'internalId',
  'internal_id',
  'auth',
  'token',
  'apiKey',
  'api_key',
];

/**
 * Fields that ARE safe to expose
 */
const SAFE_FIELDS = [
  'success',
  'content',
  'message',
  'timestamp',
  'type',
  'error',
  'crisis_resources', // Only if crisis detected
];

/**
 * Sanitize a response object by removing sensitive fields
 */
export function sanitizeResponse<T extends Record<string, unknown>>(
  response: T,
  options?: {
    logLevel?: 'debug' | 'info' | 'none';
    allowFields?: string[];
  }
): Record<string, unknown> {
  const { logLevel = 'debug', allowFields = [] } = options || {};
  
  // Log full response server-side before sanitizing
  if (logLevel === 'debug') {
    logger.debug('[Sanitize] Full response (internal):', response);
  } else if (logLevel === 'info') {
    logger.info('[Sanitize] Full response (internal):', response);
  }

  const safeFields = [...SAFE_FIELDS, ...allowFields];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(response)) {
    // Skip sensitive fields
    if (SENSITIVE_FIELDS.includes(key)) {
      continue;
    }
    
    // Skip nested metadata objects (they often contain sensitive data)
    if (key === 'metadata' && typeof value === 'object' && value !== null) {
      // Only extract crisis detection status for safety messaging
      const meta = value as Record<string, unknown>;
      if (meta.crisisDetected === true) {
        sanitized.crisis_resources = '988 Suicide & Crisis Lifeline • Crisis Text Line: text HOME to 741741';
      }
      continue;
    }
    
    // Include safe fields
    if (safeFields.includes(key) || !SENSITIVE_FIELDS.some(s => key.toLowerCase().includes(s.toLowerCase()))) {
      // Recursively sanitize nested objects
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitized[key] = sanitizeResponse(value as Record<string, unknown>, { logLevel: 'none' });
      } else {
        sanitized[key] = value;
      }
    }
  }

  return sanitized;
}

/**
 * Sanitize an array of objects
 */
export function sanitizeArray<T extends Record<string, unknown>>(
  items: T[],
  options?: { allowFields?: string[] }
): Record<string, unknown>[] {
  return items.map(item => sanitizeResponse(item, { ...options, logLevel: 'none' }));
}

/**
 * Check if a response contains any sensitive fields
 */
export function hasSensitiveData(obj: Record<string, unknown>): boolean {
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_FIELDS.includes(key)) {
      return true;
    }
    const value = obj[key];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if (hasSensitiveData(value as Record<string, unknown>)) {
        return true;
      }
    }
  }
  return false;
}
