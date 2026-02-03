import type { Request, Response, NextFunction } from 'express';
import { RequestContext } from '@enginehq/core';
import type { Logger } from '@enginehq/core';
import { randomUUID } from 'node:crypto';

declare global {
  namespace Express {
    interface Request {
      traceId?: string;
    }
  }
}

export interface ObservabilityOptions {
  logger: Logger;
}

export function createObservabilityMiddleware(options: ObservabilityOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const traceId = (req.headers['x-request-id'] as string) || randomUUID();
    req.traceId = traceId;

    // Use RequestContext to propagate traceId
    RequestContext.run(traceId, () => {
      // Log the request start
      const start = Date.now();
      options.logger.info(`Incoming ${req.method} ${req.url}`, {
        method: req.method,
        url: req.url,
        userAgent: req.headers['user-agent'],
      });

      // Log completion on finish
      res.on('finish', () => {
        const duration = Date.now() - start;
        options.logger.info(`Completed ${req.method} ${req.url} ${res.statusCode}`, {
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          duration,
        });
      });

      next();
    });
  };
}
