import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { createEngine } from '@enginehq/core';

import { autoloadWorkflows } from './autoload.js';
import { loadEngineJsConfig } from './config.js';

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  return { flags };
}

async function upsertWorkflow({
  workflowModel,
  slug,
  name,
  description,
  spec,
  overwrite,
}: {
  workflowModel: any;
  slug: string;
  name: string;
  description: string;
  spec: unknown;
  overwrite: boolean;
}) {
  const existing = await workflowModel.findOne({
    where: { slug, deleted: false, archived: false },
    raw: true,
  });

  if (existing && !overwrite) return { slug, action: 'skipped' as const };

  const row = { slug, name, description, enabled: true, spec };
  if (existing) {
    await workflowModel.update(row, { where: { id: existing.id } });
    return { slug, action: 'updated' as const };
  }

  await workflowModel.create(row);
  return { slug, action: 'created' as const };
}

export async function syncWorkflowsFromFsToDb(cwd = process.cwd()): Promise<void> {
  const { flags } = parseArgs(process.argv);
  const overwrite = flags.has('--overwrite');

  const cfg = await loadEngineJsConfig(cwd);
  const engine = createEngine(cfg.engine);
  await engine.init();

  const workflowsDir = cfg.autoload?.workflowsDir ?? 'workflow';
  const temp = new Map<string, unknown>();
  const registry = {
    register: (name: string, spec: unknown) => temp.set(String(name), spec),
    get: (name: string) => temp.get(String(name)),
    list: () => [...temp.keys()].sort((a, b) => a.localeCompare(b)),
  };
  await autoloadWorkflows({ cwd, workflowsDir, registry: registry as any });

  const modelKey = String((cfg.engine.workflows as any)?.db?.modelKey || 'workflow');
  const workflowModel = (engine.orm as any)?.models?.[modelKey];
  if (!workflowModel) {
    throw new Error(`Missing workflow model "${modelKey}" in ORM; define dsl/meta/${modelKey}.json and run \`enginehq sync\``);
  }

  const results: Array<{ slug: string; action: 'created' | 'updated' | 'skipped' }> = [];
  for (const name of registry.list()) {
    const spec = registry.get(name);
    const slug = spec && typeof spec === 'object' ? String((spec as any).slug || name) : String(name);
    const displayName = spec && typeof spec === 'object' ? String((spec as any).name || slug) : slug;
    const description = spec && typeof spec === 'object' ? String((spec as any).description || '') : '';
    results.push(await upsertWorkflow({ workflowModel, slug, name: displayName, description, spec, overwrite }));
  }

  process.stdout.write(JSON.stringify({ ok: true, overwrite, results }, null, 2) + '\n');
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  syncWorkflowsFromFsToDb().catch((e) => {
    console.error('[enginehq] workflows sync failed', e);
    process.exit(1);
  });
}
