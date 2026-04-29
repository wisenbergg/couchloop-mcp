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
  private dualStream: boolean;

  constructor() {
    const envLevel = (process.env.LOG_LEVEL?.toUpperCase() || 'INFO') as LogLevel;
    this.level = LOG_LEVELS[envLevel] ?? LOG_LEVELS.INFO;

    // Dual-stream mode routes INFO/DEBUG to stdout and WARN/ERROR to stderr,
    // matching standard log-aggregator conventions (Railway, Cloud Run, k8s)
    // where stderr = error severity. Off by default because the MCP stdio
    // transport reserves stdout for JSON-RPC frames; enabling it there would
    // corrupt the protocol. Server entry points (HTTP/SSE) opt in by setting
    // LOG_DUAL_STREAM=1 before the first import of this module.
    this.dualStream = process.env.LOG_DUAL_STREAM === '1';

    // When piped to a non-TTY (any container runtime), Node block-buffers
    // stdout in 16KB chunks. Force synchronous writes so each log line
    // flushes immediately. This is the same approach used by pino's
    // `sync: true` mode and is safe for low-to-moderate log volume.
    if (this.dualStream) {
      const stdoutHandle = (process.stdout as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle;
      const stderrHandle = (process.stderr as unknown as { _handle?: { setBlocking?: (b: boolean) => void } })._handle;
      stdoutHandle?.setBlocking?.(true);
      stderrHandle?.setBlocking?.(true);
    }
  }

  private log(level: LogLevel, ...args: unknown[]) {
    if (LOG_LEVELS[level] <= this.level) {
      const timestamp = new Date().toISOString();
      const prefix = `[${timestamp}] [${level}]`;
      const sanitizedArgs = args.map(sanitize);

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

      // Default: everything to stderr. stderr is line-buffered (flushes on
      // newline) and is the only safe channel for the MCP stdio transport,
      // where stdout carries JSON-RPC frames.
      //
      // Dual-stream (server processes): INFO/DEBUG go to stdout so log
      // aggregators don't classify normal operation lines as "error" severity.
      // WARN/ERROR stay on stderr to preserve correct severity tagging.
      const line = `${prefix} ${formatted}\n`;
      const useStdout =
        this.dualStream && (level === 'INFO' || level === 'DEBUG');
      if (useStdout) {
        process.stdout.write(line);
      } else {
        process.stderr.write(line);
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
