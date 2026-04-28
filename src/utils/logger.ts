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

  constructor() {
    const envLevel = (process.env.LOG_LEVEL?.toUpperCase() || 'INFO') as LogLevel;
    this.level = LOG_LEVELS[envLevel] ?? LOG_LEVELS.INFO;
  }

  private log(level: LogLevel, ...args: unknown[]) {
    if (LOG_LEVELS[level] <= this.level) {
      const timestamp = new Date().toISOString();
      const prefix = `[${timestamp}] [${level}]`;
      const sanitizedArgs = args.map(sanitize);

      // ALL log output goes to stderr. Two reasons this is the correct default
      // for both transports:
      //   1. MCP stdio transport: only stdout is reserved for JSON-RPC frames.
      //      stderr is explicitly free for logging per the MCP spec, so writing
      //      here cannot corrupt the protocol channel.
      //   2. HTTP transport on Railway / Docker / k8s: Node block-buffers stdout
      //      (16KB) when piped to a non-TTY, so a long-running server's logs
      //      never flushed. stderr is line-buffered and flushes immediately,
      //      and Railway captures both streams into deploy logs.
      // This replaces an earlier `MCP_MODE=true` silencer that was a partial
      // workaround for #1 but accidentally killed all observability in #2.
      const formatted = sanitizedArgs
        .map((a) => {
          if (a instanceof Error) return a.stack || a.message;
          if (typeof a === 'string') return a;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(' ');

      process.stderr.write(`${prefix} ${formatted}\n`);
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