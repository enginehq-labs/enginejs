import type { Request } from 'express';

import type { Actor } from '@enginehq/core';
import { getBearerToken, verifyActorAccessTokenHS256 } from '@enginehq/auth';

import type { EngineJsAppConfig } from './config.js';

const ANON_ACTOR: Actor = { isAuthenticated: false, subjects: {}, roles: [], claims: {} };

/**
 * Returns the resolver that turns a request into an actor.
 *
 * A resolveActor in the app config wins. Otherwise, when auth.jwt.accessSecret is set,
 * the resolver verifies the Bearer token, and a missing or invalid token gives the
 * anonymous actor. With neither, it returns undefined and the adapter default applies.
 */
export function createActorResolver(cfg: EngineJsAppConfig): ((req: Request) => Promise<Actor>) | undefined {
  const custom = cfg.resolveActor;
  if (custom) return async (req) => (await custom(req)) ?? ANON_ACTOR;

  const accessSecret = cfg.engine.auth?.jwt?.accessSecret;
  if (!accessSecret) return undefined;

  return async (req) => {
    const token = getBearerToken(req.headers.authorization);
    if (!token) return ANON_ACTOR;
    try {
      return await verifyActorAccessTokenHS256({ token, secret: accessSecret });
    } catch {
      return ANON_ACTOR;
    }
  };
}
