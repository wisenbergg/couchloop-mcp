const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

/** Patterns that indicate sensitive values to redact */
const SENSITIVE_KEYS = /token|secret|password|authorization|api[_-]?key|cookie|credential/i;
const REDACTED = '[REDACTED]';

/**
 * Deep-sanitize an object, redacting values whose keys match sensitive patterns.
 * Handles nested objects, arrays, and stringified JSON.
 */
function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    // Redact Bearer tokens that appear inline
    const cleaned = value.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, `Bearer ${REDACTED}`);
    // Redact JWTs (three base64 segments joined by dots)
    return cleaned.replace(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED);
  }

  if (Array.isArray(value)) {
    return value.map(sanitize);
  }

  if (typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = SENSITIVE_KEYS.test(key) ? REDACTED : sanitize(val);
    }
    return sanitized;
  }

  return value;
}

class Logger {
  private level: number;
  private isMCP: boolean;

  constructor() {
    const envLevel = (process.env.LOG_LEVEL?.toUpperCase() || 'INFO') as LogLevel;
    this.level = LOG_LEVELS[envLevel] ?? LOG_LEVELS.INFO;
    // Disable console logging when running as MCP server
    this.isMCP = process.env.MCP_MODE === 'true' || process.argv.includes('--mcp');
  }

  private log(level: LogLevel, ...args: unknown[]) {
    // Skip all console output when running as MCP server
    if (this.isMCP) {
      return;
    }

    if (LOG_LEVELS[level] <= this.level) {
      const timestamp = new Date().toISOString();
      const prefix = `[${timestamp}] [${level}]`;
      const sanitizedArgs = args.map(sanitize);

      if (level === 'ERROR') {
        console.error(prefix, ...sanitizedArgs);
      } else if (level === 'WARN') {
        console.warn(prefix, ...sanitizedArgs);
      } else {
        console.log(prefix, ...sanitizedArgs);
      }
    }
  }

  error(...args: unknown[]) {
    this.log('ERROR', ...args);
  }

  warn(...args: unknown[]) {
    this.log('WARN', ...args);
  }

  info(...args: unknown[]) {
    this.log('INFO', ...args);
  }

  debug(...args: unknown[]) {
    this.log('DEBUG', ...args);
  }
}

export const logger = new Logger();

// Exported for testing
export { sanitize as sanitizeLogValue };