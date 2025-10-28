/**
 * Logger Utility
 *
 * Provides a centralized logging system with configurable log levels.
 * Respects the LOG_LEVEL environment variable to control verbosity.
 */

export enum LogLevel {
  SILENT = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4,
}

class Logger {
  private static instance: Logger;
  private currentLevel: LogLevel;

  private constructor() {
    this.currentLevel = this.parseLogLevel(process.env.LOG_LEVEL || 'info');
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Parse log level string from environment variable
   */
  private parseLogLevel(level: string): LogLevel {
    const normalized = level.toLowerCase().trim();
    switch (normalized) {
      case 'silent':
        return LogLevel.SILENT;
      case 'error':
        return LogLevel.ERROR;
      case 'warn':
      case 'warning':
        return LogLevel.WARN;
      case 'info':
        return LogLevel.INFO;
      case 'debug':
      case 'verbose':
        return LogLevel.DEBUG;
      default:
        console.warn(`Unknown LOG_LEVEL "${level}", defaulting to "info"`);
        return LogLevel.INFO;
    }
  }

  /**
   * Set the log level programmatically
   */
  public setLogLevel(level: LogLevel | string): void {
    if (typeof level === 'string') {
      this.currentLevel = this.parseLogLevel(level);
    } else {
      this.currentLevel = level;
    }
  }

  /**
   * Get the current log level
   */
  public getLogLevel(): LogLevel {
    return this.currentLevel;
  }

  /**
   * Get the current log level as a string
   */
  public getLogLevelString(): string {
    switch (this.currentLevel) {
      case LogLevel.SILENT:
        return 'silent';
      case LogLevel.ERROR:
        return 'error';
      case LogLevel.WARN:
        return 'warn';
      case LogLevel.INFO:
        return 'info';
      case LogLevel.DEBUG:
        return 'debug';
      default:
        return 'unknown';
    }
  }

  /**
   * Format timestamp for log messages
   */
  private getTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Format log message with optional context
   */
  private formatMessage(level: string, message: string, context?: string): string {
    const timestamp = this.getTimestamp();
    const contextStr = context ? `[${context}]` : '';
    return `${timestamp} [${level}] ${contextStr} ${message}`;
  }

  /**
   * Log an error message
   */
  public error(message: string, context?: string, error?: any): void {
    if (this.currentLevel >= LogLevel.ERROR) {
      if (error) {
        console.error(this.formatMessage('ERROR', message, context), error);
      } else {
        console.error(this.formatMessage('ERROR', message, context));
      }
    }
  }

  /**
   * Log a warning message
   */
  public warn(message: string, context?: string, error?: any): void {
    if (this.currentLevel >= LogLevel.WARN) {
      if (error) {
        console.warn(this.formatMessage('WARN', message, context), error);
      } else {
        console.warn(this.formatMessage('WARN', message, context));
      }
    }
  }

  /**
   * Log an informational message
   */
  public info(message: string, context?: string, ...args: any[]): void {
    if (this.currentLevel >= LogLevel.INFO) {
      console.log(this.formatMessage('INFO', message, context), ...args);
    }
  }

  /**
   * Log a debug message
   */
  public debug(message: string, context?: string, ...args: any[]): void {
    if (this.currentLevel >= LogLevel.DEBUG) {
      console.log(this.formatMessage('DEBUG', message, context), ...args);
    }
  }

  /**
   * Log a success message (info level)
   */
  public success(message: string, context?: string, ...args: any[]): void {
    if (this.currentLevel >= LogLevel.INFO) {
      console.log(this.formatMessage('INFO', message, context), ...args);
    }
  }

  /**
   * Log a startup/important message (always visible except in silent mode)
   */
  public important(message: string, context?: string, ...args: any[]): void {
    if (this.currentLevel > LogLevel.SILENT) {
      console.log(this.formatMessage('INFO', message, context), ...args);
    }
  }

  /**
   * Check if a specific log level is enabled
   */
  public isLevelEnabled(level: LogLevel): boolean {
    return this.currentLevel >= level;
  }
}

// Export singleton instance
export const logger = Logger.getInstance();

// Export convenience functions
export const log = {
  error: (message: string, context?: string, error?: any) => logger.error(message, context, error),
  warn: (message: string, context?: string, error?: any) => logger.warn(message, context, error),
  info: (message: string, context?: string, ...args: any[]) => logger.info(message, context, ...args),
  debug: (message: string, context?: string, ...args: any[]) => logger.debug(message, context, ...args),
  success: (message: string, context?: string, ...args: any[]) => logger.success(message, context, ...args),
  important: (message: string, context?: string, ...args: any[]) => logger.important(message, context, ...args),
};

export default logger;
