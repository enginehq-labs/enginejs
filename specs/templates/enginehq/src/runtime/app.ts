import process from 'node:process';
import { pathToFileURL } from 'node:url';

import type { Actor } from '@enginehq/core';
import { createEngine } from '@enginehq/core';
import { createEngineExpressApp } from '@enginehq/express';

import { autoloadPipelines, autoloadRoutes, autoloadWorkflows } from './autoload.js';
import { loadEngineJsConfig } from './config.js';

const defaultActor: Actor = {
  isAuthenticated: false,
  subjects: {},
  roles: [],
  claims: {},
};

export async function startEngineJsApp(cwd = process.cwd()): Promise<void> {
  const cfg = await loadEngineJsConfig(cwd);
  const engine = createEngine(cfg.engine);
  await engine.init();

  const services = engine.services;
  const pipelines = services.resolve('pipelines', { scope: 'singleton' });
  const workflows = services.resolve('workflows', { scope: 'singleton' });

  const autoload = cfg.autoload ?? {};
  await autoloadPipelines({ cwd, pipelinesDir: autoload.pipelinesDir ?? 'pipeline', registry: pipelines as any });
  await autoloadWorkflows({ cwd, workflowsDir: autoload.workflowsDir ?? 'workflow', registry: workflows as any });

  const app = createEngineExpressApp(engine, {
    defaultActor,
    ...(cfg.resolveActor ? { resolveActor: cfg.resolveActor as any } : {}),
  });

  await autoloadRoutes({ cwd, routesDir: autoload.routesDir ?? 'routes', app, engine });

  const host = cfg.http.host;
  const port = cfg.http.port;

  await new Promise<void>((resolve) => {
    const srv = host
      ? app.listen(port, host, () => {
          const addr = `${host}:${port}`;
          console.log(`[enginejs] listening on ${addr}`);
          resolve();
        })
      : app.listen(port, () => {
          console.log(`[enginejs] listening on :${port}`);
          resolve();
        });
    srv.on('error', (err) => {
      console.error('[enginejs] server error', err);
      process.exit(1);
    });
  });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  startEngineJsApp().catch((e) => {
    console.error('[enginejs] fatal', e);
    process.exit(1);
  });
}
