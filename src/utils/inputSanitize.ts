/**
 * Input Sanitization Utilities
 * Defense-in-depth layer beyond Zod schema validation.
 * Protects against XSS, null-byte injection, and oversized payloads.
 */

/** Strip HTML tags to prevent stored/reflected XSS */
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '');
}

/** Escape HTML entities for safe rendering */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** Remove null bytes that can bypass validation */
export function stripNullBytes(input: string): string {
  return input.replace(/\0/g, '');
}

/**
 * Sanitize user-provided text input:
 * 1. Strip null bytes
 * 2. Strip HTML tags
 * 3. Enforce max length
 */
export function sanitizeText(input: string, maxLength = 10_000): string {
  let cleaned = stripNullBytes(input);
  cleaned = stripHtml(cleaned);
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength);
  }
  return cleaned;
}

/**
 * Sanitize code input — preserves HTML-like syntax since it's code,
 * but strips null bytes and enforces length.
 */
export function sanitizeCode(input: string, maxLength = 100_000): string {
  let cleaned = stripNullBytes(input);
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength);
  }
  return cleaned;
}

/**
 * Validate a redirect URI against an allow-list.
 * Returns null if the URI is not allowed.
 */
export function validateRedirectUri(
  uri: string,
  allowedUris: string[]
): string | null {
  try {
    const parsed = new URL(uri);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return allowedUris.includes(uri) ? uri : null;
  } catch {
    return null;
  }
}
