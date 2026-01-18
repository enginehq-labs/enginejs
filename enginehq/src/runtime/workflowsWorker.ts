import process from 'node:process';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

import { createEngine } from '@enginehq/core';
import { loadEngineJsConfig } from './config.js';
import { autoloadPipelines, autoloadWorkflows } from './autoload.js';

export async function runWorkflowsWorker(cwd = process.cwd()): Promise<void> {
  const cfg = await loadEngineJsConfig(cwd);
  const engine = createEngine(cfg.engine);
  await engine.init();

  const services = engine.services;
  const workflows = services.resolve<any>('workflows', { scope: 'singleton' });

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

  // Load custom ops and steps (same as app start)
  const autoload = cfg.autoload ?? {};
  await autoloadPipelines({ cwd, pipelinesDir: autoload.pipelinesDir ?? 'pipeline', services });
  if ((cfg.engine.workflows as any)?.registry !== 'db') {
    await autoloadWorkflows({ cwd, workflowsDir: autoload.workflowsDir ?? 'workflow', registry: workflows });
  }

  const runner = services.resolve<any>('workflowRunner', { scope: 'singleton' });
  
  console.log('[enginejs] workflow worker started');

  // Simple loop for now
  while (true) {
    try {
      const { processed } = await runner.runOnce();
      if (processed === 0) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    } catch (e) {
      console.error('[enginejs] workflow worker error', e);
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  runWorkflowsWorker().catch((e) => {
    console.error('[enginejs] workflow worker fatal', e);
    process.exit(1);
  });
}
