/**
 * Policy Layer — Universal Response Sanitizer
 *
 * Extends the existing sanitizeResponse() to cover all tools, not just
 * conversation. Also strips raw stack traces in production.
 */

import { sanitizeResponse } from '../utils/sanitize.js';

/**
 * Sanitize any tool response before it leaves the server.
 *
 * - Removes SENSITIVE_FIELDS (sessionId, threadId, userId, etc.)
 * - Strips raw stack traces in non-development environments
 * - Recursively sanitizes nested objects
 * - Passes through all non-sensitive domain fields (checks_run, issues, etc.)
 *
 * @param result Raw handler output (any shape)
 * @returns Sanitized plain object
 */
export function sanitizeUniversalResponse(
  result: unknown,
): Record<string, unknown> {
  if (result === null || result === undefined) {
    return { success: false, error: 'Empty response from tool handler' };
  }

  if (typeof result !== 'object') {
    // Primitive — wrap then sanitize
    return sanitizeResponse({ value: result } as Record<string, unknown>, { logLevel: 'none' });
  }

  if (Array.isArray(result)) {
    // Recursively sanitize each element then return as { items }
    const sanitizedItems = result.map((item) =>
      item !== null && typeof item === 'object' && !Array.isArray(item)
        ? sanitizeResponse(item as Record<string, unknown>, { logLevel: 'none' })
        : item,
    );
    return { items: sanitizedItems };
  }

  const sanitized = sanitizeResponse(result as Record<string, unknown>, { logLevel: 'none' });

  // Strip raw stack traces in production
  if (process.env.NODE_ENV !== 'development') {
    for (const key of Object.keys(sanitized)) {
      if (key === 'stack' || key === 'stackTrace' || key === 'stack_trace') {
        delete sanitized[key];
      }
      // Strip nested stack fields
      if (sanitized[key] && typeof sanitized[key] === 'object') {
        const nested = sanitized[key] as Record<string, unknown>;
        delete nested.stack;
        delete nested.stackTrace;
        delete nested.stack_trace;
      }
    }
    // Remove 'details' in prod when it contains internal error information
    if (sanitized.details && typeof sanitized.details === 'object') {
      const details = sanitized.details as Record<string, unknown>;
      if (details.stack || details.originalError) {
        delete sanitized.details;
      }
    }
  }

  return sanitized;
}
