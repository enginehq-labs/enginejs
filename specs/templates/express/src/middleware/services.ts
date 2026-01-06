import type { NextFunction, Request, Response } from 'express';
import type { ResolveCtx, ServiceRegistry } from '@enginehq/core';

export type RequestServices = {
  get: <T>(name: string) => T;
  has: (name: string) => boolean;
};

declare global {
  namespace Express {
    interface Request {
      services?: RequestServices;
    }
  }
}

export function servicesMiddleware(registry: ServiceRegistry) {
  const resolveCtx: ResolveCtx = { scope: 'request' };

  return (req: Request, _res: Response, next: NextFunction) => {
    req.services = {
      get: <T>(name: string) => registry.resolve<T>(name, resolveCtx),
      has: (name: string) => registry.has(name),
    };
    next();
  };
}

