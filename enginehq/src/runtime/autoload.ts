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

// Helper functions for autoloadRoutes
function walkRoutes(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return [];
  const entries = fs
    .readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const res = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkRoutes(res));
    } else if (/\.(ts|js|mjs)$/.test(entry.name)) {
      files.push(res);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}


function resolveRoutePath(filePath: string, routesDir: string): string {
  const relativePath = path.relative(routesDir, filePath);
  // Strip extension
  let routePath = relativePath.replace(/\.(ts|js|mjs)$/, '');
  
  // Handle index.ts
  if (routePath === 'index' || routePath.endsWith('/index')) {
    routePath = routePath.slice(0, -5); // remove 'index'
  }
  
  // Ensure starts with / and ends without /
  if (!routePath.startsWith('/')) routePath = '/' + routePath;
  if (routePath.endsWith('/') && routePath.length > 1) routePath = routePath.slice(0, -1);
  
  // Convert [param] to :param
  // We no longer convert dynamic segments here, as the router itself handles them.
  // routePath = routePath.replace(/\[([^\]]+)\]/g, ':$1'); 
  
  return routePath;
}

export async function autoloadRoutes(args: { cwd: string; routesDir: string; app: Express; engine: EngineRuntime }): Promise<void> {
  const defaultPrefix = args.engine.config.http?.routesPath ?? '/api';
  const routesDir = path.isAbsolute(args.routesDir) ? args.routesDir : path.join(args.cwd, args.routesDir);
  
  const files = walkRoutes(routesDir);
  
  for (const filePath of files) {
    const mod = await importFile(filePath);
    const fn = mod?.default ?? mod?.registerRoutes ?? null;
    if (typeof fn !== 'function') continue;

    // Local override in the route file (e.g., export const path = '/special')
    const overridePath = mod?.path ?? mod?.prefix ?? null;
    
    let mountPath: string;
    if (overridePath !== null) {
      mountPath = String(overridePath);
    } else {
      const relativePath = resolveRoutePath(filePath, routesDir);
      // Remove the dynamic segment from the mountPath, it will be handled by the router itself.
      const baseMountPath = relativePath.replace(/\/:[^/]+$/, '');
      mountPath = defaultPrefix === '/' ? baseMountPath : `${defaultPrefix}${baseMountPath}`;
    }

    const globalBasePath = args.engine.config.http?.basePath ?? '';
    mountPath = `${globalBasePath}${mountPath}`;
    
    // Clean up double slashes
    mountPath = mountPath.replace(/\/+/g, '/');
    // Ensure starts with /
    if (!mountPath.startsWith('/')) mountPath = '/' + mountPath;
    // Don't end with / if not root
    if (mountPath.endsWith('/') && mountPath.length > 1) mountPath = mountPath.slice(0, -1);
    
    const router = express.Router();
    await fn({ app: router as any, engine: args.engine });
    args.app.use(mountPath, router);
  }
}
