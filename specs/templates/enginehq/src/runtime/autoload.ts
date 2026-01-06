import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Express } from 'express';

import type { EngineRuntime } from '@enginehq/core';
import type { PipelineRegistry, WorkflowRegistry } from '@enginehq/core';

function listModuleFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((n) => /\.(ts|js|mjs)$/.test(n))
    .sort((a, b) => a.localeCompare(b));
  return entries.map((n) => path.join(dir, n));
}

async function importFile(filePath: string): Promise<any> {
  return import(pathToFileURL(filePath).toString());
}

export async function autoloadPipelines(args: {
  cwd: string;
  pipelinesDir: string;
  registry: PipelineRegistry;
}): Promise<void> {
  const dir = path.isAbsolute(args.pipelinesDir) ? args.pipelinesDir : path.join(args.cwd, args.pipelinesDir);
  for (const filePath of listModuleFiles(dir)) {
    const mod = await importFile(filePath);
    const spec = mod?.default ?? mod?.pipelines ?? null;
    if (!spec || typeof spec !== 'object') continue;
    for (const [modelKey, modelSpec] of Object.entries(spec as any)) {
      args.registry.register(String(modelKey), modelSpec);
    }
  }
}

export async function autoloadWorkflows(args: {
  cwd: string;
  workflowsDir: string;
  registry: WorkflowRegistry;
}): Promise<void> {
  const dir = path.isAbsolute(args.workflowsDir) ? args.workflowsDir : path.join(args.cwd, args.workflowsDir);
  for (const filePath of listModuleFiles(dir)) {
    const mod = await importFile(filePath);
    const spec = mod?.default ?? mod?.workflow ?? null;
    const name = spec && typeof spec === 'object' ? String((spec as any).name || '') : '';
    if (!name) continue;
    args.registry.register(name, spec);
  }
}

export async function autoloadRoutes(args: { cwd: string; routesDir: string; app: Express; engine: EngineRuntime }): Promise<void> {
  const dir = path.isAbsolute(args.routesDir) ? args.routesDir : path.join(args.cwd, args.routesDir);
  for (const filePath of listModuleFiles(dir)) {
    const mod = await importFile(filePath);
    const fn = mod?.default ?? mod?.registerRoutes ?? null;
    if (typeof fn !== 'function') continue;
    await fn({ app: args.app, engine: args.engine });
  }
}

