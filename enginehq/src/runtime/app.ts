import process from 'node:process';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

import type { Actor } from '@enginehq/core';
import type { Express } from 'express'; // Added import for Express
import type { WorkflowRegistry } from '@enginehq/core';
import { createEngine } from '@enginehq/core';
import { createEngineExpressApp } from '@enginehq/express';
import { autoloadPipelines, autoloadRoutes, autoloadWorkflows } from './autoload.js';
import { loadEngineJsConfig } from './config.js';

async function startEngineJsApp(cwd = process.cwd()): Promise<void> {
  const cfg = await loadEngineJsConfig(cwd);
  const engine = createEngine(cfg.engine);
  
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

  const app = await createEngineExpressApp(engine, {
    registerCustomRoutes: async (expressApp, runtimeEngine) => {
      await autoloadRoutes({ cwd, routesDir: autoload.routesDir ?? 'routes', app: expressApp, engine: runtimeEngine });
    },
  });


  const port = cfg.http.port || 3000;
  app.listen(port, () => {
    console.log(`[link-shortener] listening on :${port}`);
  });
}

export { startEngineJsApp };