import type { Express } from 'express';

import type { Actor } from '@enginehq/core';
import type { EngineRuntime } from '@enginehq/core';

import { createExpressApp } from './createExpressApp.js';
import type { ActorResolver } from '../middleware/actor.js';

export type CreateEngineExpressAppOptions = {
  basePath?: string;
  resolveActor?: ActorResolver;
  defaultActor?: Actor;
};

export function createEngineExpressApp(engine: EngineRuntime, opts: CreateEngineExpressAppOptions = {}): Express {
  return createExpressApp({
    basePath: opts.basePath ?? engine.config.http?.basePath ?? '',
    services: engine.services,
    getConfig: () => engine.config,
    getDsl: () => engine.services.resolve('dsl', { scope: 'singleton' }),
    getOrm: () => engine.services.resolve('orm', { scope: 'singleton' }),
    ...(opts.resolveActor ? { resolveActor: opts.resolveActor } : {}),
    ...(opts.defaultActor ? { defaultActor: opts.defaultActor } : {}),
  });
}
