import express from 'express';
import type { Actor, DslRoot, EngineConfig, OrmInitResult, ServiceRegistry } from '@enginehq/core';

import { actorMiddleware, type ActorResolver } from '../middleware/actor.js';
import { responseEnvelope } from '../middleware/responseEnvelope.js';
import { servicesMiddleware } from '../middleware/services.js';
import { createAdminRouter } from '../routers/admin.js';
import { createCrudRouter } from '../routers/crud.js';

export type ExpressAppOptions = {
  basePath?: string;
  services: ServiceRegistry;
  getDsl: () => DslRoot;
  getOrm: () => OrmInitResult;
  getConfig: () => EngineConfig;
  resolveActor?: ActorResolver;
  defaultActor?: Actor;
};

export function createExpressApp(opts: ExpressAppOptions) {
  const app = express();
  const basePath = opts.basePath ?? '';

  app.use(express.json({ limit: '2mb' }));
  app.use(responseEnvelope);
  app.use(servicesMiddleware(opts.services));
  app.use(
    actorMiddleware(
      opts.resolveActor ??
        (() =>
          (opts.defaultActor ??
            ({
              isAuthenticated: false,
              subjects: {},
              roles: [],
              claims: {},
            } satisfies Actor))),
    ),
  );

  app.get(`${basePath}/health`, (_req, res) => res.ok({ ok: true }, { code: 200, pagination: null }));
  app.use(
    `${basePath}/admin`,
    createAdminRouter({ getDsl: opts.getDsl as any, getOrm: opts.getOrm as any, getConfig: opts.getConfig }),
  );
  app.use(
    `${basePath}/api`,
    createCrudRouter({ getDsl: opts.getDsl, getOrm: opts.getOrm, getConfig: opts.getConfig }),
  );

  return app;
}
