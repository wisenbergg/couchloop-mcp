const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

class Logger {
  private level: number;
  private isMCP: boolean;

  constructor() {
    const envLevel = (process.env.LOG_LEVEL?.toUpperCase() || 'INFO') as LogLevel;
    this.level = LOG_LEVELS[envLevel] ?? LOG_LEVELS.INFO;
    // Disable console logging when running as MCP server
    this.isMCP = process.env.MCP_MODE === 'true' || process.argv.includes('--mcp');
  }

  private log(level: LogLevel, ...args: any[]) {
    // Skip all console output when running as MCP server
    if (this.isMCP) {
      return;
    }

    if (LOG_LEVELS[level] <= this.level) {
      const timestamp = new Date().toISOString();
      const prefix = `[${timestamp}] [${level}]`;

      if (level === 'ERROR') {
        console.error(prefix, ...args);
      } else if (level === 'WARN') {
        console.warn(prefix, ...args);
      } else {
        console.log(prefix, ...args);
      }
    }
  }

  error(...args: any[]) {
    this.log('ERROR', ...args);
  }

  warn(...args: any[]) {
    this.log('WARN', ...args);
  }

  info(...args: any[]) {
    this.log('INFO', ...args);
  }

  debug(...args: any[]) {
    this.log('DEBUG', ...args);
  }
}

export const logger = new Logger();