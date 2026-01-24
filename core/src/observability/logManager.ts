import * as pinoModule from 'pino';
import type { Logger as PinoLogger, LoggerOptions } from 'pino';
import type { Logger, LogContext } from './types.js';
import { RequestContext } from './context.js';

// Pino v7 has some oddities with ES module imports in some environments
const pino = (pinoModule.default || pinoModule) as unknown as typeof pinoModule.default;

export interface LogManagerOptions {
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | undefined;
  stream?: { write(msg: string): void } | undefined;
}

export class LogManager {
  static createLogger(options: LogManagerOptions = {}): Logger {
    const pinoOptions: LoggerOptions = {
      level: options.level || 'info',
      mixin() {
        const traceId = RequestContext.getTraceId();
        return traceId ? { traceId } : {};
      },
      // Ensure we don't have base fields that might conflict
      base: null,
    };

    const pinoInstance = options.stream 
      ? (pino as any)(pinoOptions, options.stream as any)
      : (pino as any)(pinoOptions);

    return new PinoLoggerWrapper(pinoInstance);
  }
}

class PinoLoggerWrapper implements Logger {
  constructor(private pino: PinoLogger) {}

  trace(msg: string, context?: LogContext): void {
    if (context) this.pino.trace(context, msg);
    else this.pino.trace(msg);
  }

  debug(msg: string, context?: LogContext): void {
    if (context) this.pino.debug(context, msg);
    else this.pino.debug(msg);
  }

  info(msg: string, context?: LogContext): void {
    if (context) this.pino.info(context, msg);
    else this.pino.info(msg);
  }

  warn(msg: string, context?: LogContext): void {
    if (context) this.pino.warn(context, msg);
    else this.pino.warn(msg);
  }

  error(msg: string, context?: LogContext): void {
    if (context) this.pino.error(context, msg);
    else this.pino.error(msg);
  }

  fatal(msg: string, context?: LogContext): void {
    if (context) this.pino.fatal(context, msg);
    else this.pino.fatal(msg);
  }

  child(context: LogContext): Logger {
    return new PinoLoggerWrapper(this.pino.child(context));
  }
}
