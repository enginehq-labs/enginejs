import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Request } from 'express';

import type { Actor } from '@enginehq/core';
import type { EngineConfig } from '@enginehq/core';

export type EngineJsAutoloadConfig = {
  pipelinesDir?: string;
  workflowsDir?: string;
  routesDir?: string;
};

export type EngineJsAppConfig = {
  http: { host?: string; port: number };
  engine: EngineConfig;
  autoload?: EngineJsAutoloadConfig;
  resolveActor?: (req: Request) => Promise<Actor | null> | Actor | null;
};

export function resolveAppPath(cwd: string, p: string) {
  return path.isAbsolute(p) ? p : path.join(cwd, p);
}

export async function loadEngineJsConfig(cwd = process.cwd()): Promise<EngineJsAppConfig> {
  const configPath = path.join(cwd, 'enginejs.config.ts');
  if (!fs.existsSync(configPath)) throw new Error(`Missing enginejs.config.ts in ${cwd}`);

  const mod = await import(pathToFileURL(configPath).toString());
  const cfg = (mod as any)?.default ?? (mod as any)?.config ?? null;
  if (!cfg || typeof cfg !== 'object') throw new Error('enginejs.config.ts must export default config object');
  if (!cfg.http || typeof cfg.http !== 'object') throw new Error('enginejs.config.ts missing http');
  if (!cfg.engine || typeof cfg.engine !== 'object') throw new Error('enginejs.config.ts missing engine');

  return cfg as EngineJsAppConfig;
}

