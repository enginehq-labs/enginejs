import express from 'express';
import type { Actor, DslRoot, EngineConfig, OrmInitResult, ServiceRegistry } from '@enginehq/core';
import type { EngineRuntime } from '@enginehq/core'; // Added import for EngineRuntime
import type { Express } from 'express'; // Added import for Express

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
  registerCustomRoutes?: (app: Express, engine: EngineRuntime) => Promise<void>;
};

export async function createExpressApp(opts: ExpressAppOptions) {
  const app = express();
  const basePath = opts.basePath ?? '';
  const config = opts.getConfig();
  const adminPath = config.http?.adminPath ?? '/admin';
  const crudPath = config.http?.crudPath ?? '/api/crud';

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
  
  if (opts.registerCustomRoutes) {
    // Custom routes should be registered before generic CRUD/Admin
    // to allow more specific custom routes to take precedence.
    await opts.registerCustomRoutes(app, {
      config: opts.getConfig(),
      services: opts.services,
      dsl: opts.getDsl(),
      orm: opts.getOrm(),
      registerPlugin: () => {},
      init: async () => {},
    } as any);
  }

  app.use(
    `${basePath}${adminPath}`,
    createAdminRouter({ getDsl: opts.getDsl as any, getOrm: opts.getOrm as any, getConfig: opts.getConfig }),
  );
  app.use(
    `${basePath}${crudPath}`,
    createCrudRouter({ getDsl: opts.getDsl, getOrm: opts.getOrm, getConfig: opts.getConfig }),
  );

  return app;
}