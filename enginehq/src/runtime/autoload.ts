import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import express from 'express';
import type { Express } from 'express';

import type { EngineRuntime } from '@enginehq/core';
import type { ServiceRegistry, WorkflowRegistry } from '@enginehq/core';

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
  services: ServiceRegistry;
}): Promise<void> {
  const dir = path.isAbsolute(args.pipelinesDir) ? args.pipelinesDir : path.join(args.cwd, args.pipelinesDir);
  for (const filePath of listModuleFiles(dir)) {
    const mod = await importFile(filePath);

    const validators = mod?.validators ?? mod?.default?.validators ?? null;
    if (validators && typeof validators === 'object') {
      for (const name of Object.keys(validators as any).sort((a, b) => a.localeCompare(b))) {
        const fn = (validators as any)[name];
        if (typeof fn !== 'function') continue;
        args.services.register(`pipelines.validator.${name}`, 'singleton', () => fn);
      }
    }

    const transforms = mod?.transforms ?? mod?.default?.transforms ?? null;
    if (transforms && typeof transforms === 'object') {
      for (const name of Object.keys(transforms as any).sort((a, b) => a.localeCompare(b))) {
        const fn = (transforms as any)[name];
        if (typeof fn !== 'function') continue;
        args.services.register(`pipelines.transform.${name}`, 'singleton', () => fn);
      }
    }

    const ops = mod?.ops ?? mod?.default?.ops ?? null;
    if (ops && typeof ops === 'object') {
      for (const name of Object.keys(ops as any).sort((a, b) => a.localeCompare(b))) {
        const fn = (ops as any)[name];
        if (typeof fn !== 'function') continue;
        args.services.register(`pipelines.custom.${name}`, 'singleton', () => fn);
      }
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
    const key =
      spec && typeof spec === 'object'
        ? String((spec as any).slug || (spec as any).name || '')
        : '';
    if (!key) continue;
    args.registry.register(key, spec);
  }
}

export async function autoloadRoutes(args: { cwd: string; routesDir: string; app: Express; engine: EngineRuntime }): Promise<void> {
  const routesPath = args.engine.config.http?.routesPath ?? '';
  const dir = path.isAbsolute(args.routesDir) ? args.routesDir : path.join(args.cwd, args.routesDir);
  for (const filePath of listModuleFiles(dir)) {
    const mod = await importFile(filePath);
    const fn = mod?.default ?? mod?.registerRoutes ?? null;
    if (typeof fn !== 'function') continue;

    // Local override in the route file (e.g., export const path = '/special')
    // If null/undefined, fall back to the global routesPath.
    const overridePath = mod?.path ?? mod?.prefix ?? null;
    const prefix = overridePath !== null ? String(overridePath) : routesPath;

    if (prefix && prefix !== '/') {
      const router = express.Router();
      await fn({ app: router as any, engine: args.engine });
      args.app.use(prefix, router);
    } else {
      await fn({ app: args.app, engine: args.engine });
    }
  }
}
