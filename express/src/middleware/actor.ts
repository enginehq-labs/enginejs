import type { NextFunction, Request, Response } from 'express';
import type { Actor } from '@enginehq/core';

declare global {
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}

export type ActorResolver = (req: Request) => Promise<Actor> | Actor;

export function actorMiddleware(resolver?: ActorResolver) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const actor =
        (await resolver?.(req)) ??
        ({
          isAuthenticated: false,
          subjects: {},
          roles: [],
          claims: {},
        } satisfies Actor);
      req.actor = actor;
      next();
    } catch (e) {
      next(e);
    }
  };
}

