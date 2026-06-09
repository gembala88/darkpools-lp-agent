export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  module: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export class Logger {
  private module: string;
  private static logs: LogEntry[] = [];
  private static maxLogs = 10000;
  private static logLevel: LogLevel = 'info';
  private static levelOrder: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(module: string) {
    this.module = module;
  }

  private log(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    if (Logger.levelOrder[level] < Logger.levelOrder[Logger.logLevel]) return;

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      module: this.module,
      message,
      metadata,
    };

    Logger.logs.push(entry);
    if (Logger.logs.length > Logger.maxLogs) {
      Logger.logs = Logger.logs.slice(-Logger.maxLogs);
    }

    const prefix = `[${entry.timestamp.toISOString()}] [${level.toUpperCase()}] [${this.module}]`;
    const metaStr = metadata ? ` ${JSON.stringify(metadata)}` : '';

    switch (level) {
      case 'error':
        console.error(`${prefix} ${message}${metaStr}`);
        break;
      case 'warn':
        console.warn(`${prefix} ${message}${metaStr}`);
        break;
      default:
        console.log(`${prefix} ${message}${metaStr}`);
    }
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log('debug', message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.log('info', message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log('warn', message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.log('error', message, metadata);
  }

  static getLogs(level?: LogLevel, module?: string, limit = 100): LogEntry[] {
    let filtered = Logger.logs;
    if (level) filtered = filtered.filter(e => e.level === level);
    if (module) filtered = filtered.filter(e => e.module === module);
    return filtered.slice(-limit);
  }

  static setLogLevel(level: LogLevel): void {
    Logger.logLevel = level;
  }

  static clearLogs(): void {
    Logger.logs = [];
  }

  static getLogCount(): number {
    return Logger.logs.length;
  }
}
