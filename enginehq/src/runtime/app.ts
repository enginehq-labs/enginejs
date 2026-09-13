import process from 'node:process';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

import type { Express } from 'express';
import type { WorkflowRegistry } from '@enginehq/core';
import { createEngine } from '@enginehq/core';
import { createEngineExpressApp } from '@enginehq/express';
import { autoloadPipelines, autoloadRoutes, autoloadWorkflows } from './autoload.js';
import { loadEngineJsConfig } from './config.js';
import { createActorResolver } from './actorResolver.js';

async function startEngineJsApp(cwd = process.cwd()): Promise<void> {
  const cfg = await loadEngineJsConfig(cwd);
  const engine = createEngine(cfg.engine);
  // Compiles the DSL and initializes the ORM. createEngineExpressApp resolves the
  // dsl and orm services eagerly, so without this the app throws
  // 'DSL not initialized (call engine.init())'.
  await engine.init();

  // Autoload custom ops and steps if they exist
  const opsPath = path.join(cwd, 'pipeline', 'ops.ts');
  if (fs.existsSync(opsPath)) {
    try {
      const mod = await import(pathToFileURL(opsPath).href);
      if (typeof mod.default === 'function') {
        await mod.default({ engine });
      }
    } catch (e) {
      console.warn(`[enginejs] failed to load pipeline ops from ${opsPath}`, e);
    }
  }

  const stepsPath = path.join(cwd, 'workflow', 'steps.ts');
  if (fs.existsSync(stepsPath)) {
    try {
      const mod = await import(pathToFileURL(stepsPath).href);
      if (typeof mod.default === 'function') {
        await mod.default({ engine });
      }
    } catch (e) {
      console.warn(`[enginejs] failed to load workflow steps from ${stepsPath}`, e);
    }
  }

  const services = engine.services;
  const workflows = services.resolve('workflows', { scope: 'singleton' }) as WorkflowRegistry;

  const autoload = cfg.autoload ?? {};
  await autoloadPipelines({
    cwd,
    pipelinesDir: autoload.pipelinesDir ?? 'pipeline',
    services,
  });
  await autoloadWorkflows({
    cwd,
    workflowsDir: autoload.workflowsDir ?? 'workflow',
    registry: workflows,
  });

  const resolveActor = createActorResolver(cfg);

  const app = await createEngineExpressApp(engine, {
    ...(resolveActor ? { resolveActor } : {}),
    registerCustomRoutes: async (expressApp, runtimeEngine) => {
      await autoloadRoutes({ cwd, routesDir: autoload.routesDir ?? 'routes', app: expressApp, engine: runtimeEngine });
    },
  });


  const port = cfg.http.port || 3000;
  const host = cfg.http.host;
  const onListening = () => {
    console.log(`[enginehq] listening on ${host ? `${host}:${port}` : `:${port}`}`);
  };
  if (host) app.listen(port, host, onListening);
  else app.listen(port, onListening);
}

export { startEngineJsApp };

// `enginehq start` and `enginehq dev` spawn this file directly, so it must run
// itself when it is the entry point. Without this the process exits 0 having
// started nothing. Same pattern as workflowsWorker.ts.
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  startEngineJsApp().catch((e) => {
    console.error('[enginehq] fatal', e);
    process.exit(1);
  });
}