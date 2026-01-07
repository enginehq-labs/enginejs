import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

import { createEngine, safeSync } from '@enginehq/core';
import { loadEngineJsConfig } from './runtime/config.js';

const PKG_NAME = 'enginehq';

function usage(code = 0): never {
  const msg = `Usage:
  enginehq init <dir> [--force]
  enginehq sync [--dry-run] [--requireSnapshot] [--allowNoSnapshot]
  enginehq workflows sync [--overwrite]
  enginehq start
  enginehq dev

Notes:
  - Apps run via \`node --loader tsx .\` with package.json main pointing to enginehq runtime.
`;
  (code === 0 ? process.stdout : process.stderr).write(msg);
  process.exit(code);
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const cmd = args[0] || '';
  const rest = args.slice(1);
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const positionals = rest.filter((a) => !a.startsWith('--'));
  return { cmd, flags, positionals };
}

function ensureEmptyOrForce(targetDir: string, force: boolean) {
  if (!fs.existsSync(targetDir)) return;
  const entries = fs.readdirSync(targetDir);
  if (!entries.length) return;
  if (!force) throw new Error(`Target dir is not empty: ${targetDir} (use --force)`);
}

function writeFileIfMissing(filePath: string, contents: string, force: boolean) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!force && fs.existsSync(filePath)) return;
  fs.writeFileSync(filePath, contents);
}

function writeJsonIfMissing(filePath: string, obj: unknown, force: boolean) {
  writeFileIfMissing(filePath, JSON.stringify(obj, null, 2) + '\n', force);
}

export type InitAppOptions = {
  dir: string;
  force?: boolean;
  name?: string;
};

export function initEngineJsApp(opts: InitAppOptions): void {
  const targetDir = path.resolve(opts.dir);
  const force = opts.force === true;
  const name = String(opts.name || path.basename(targetDir) || 'enginejs-app');

  fs.mkdirSync(targetDir, { recursive: true });
  ensureEmptyOrForce(targetDir, force);

  fs.mkdirSync(path.join(targetDir, 'dsl', 'models'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'dsl', 'meta'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'workflow'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'pipeline'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'routes'), { recursive: true });

  // Cleanup deprecated scaffold files when force-regenerating.
  if (force) {
    const deprecated = [path.join(targetDir, 'dsl', 'schema.json'), path.join(targetDir, 'pipeline', 'customer.pipeline.ts')];
    for (const p of deprecated) {
      try {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) fs.rmSync(p);
      } catch {}
    }
  }

  writeJsonIfMissing(
    path.join(targetDir, 'package.json'),
    {
      name,
      private: true,
      type: 'module',
      main: './node_modules/enginehq/dist/runtime/app.js',
      scripts: {
        start: 'node --loader tsx .',
        dev: 'node --loader tsx .',
      },
      dependencies: {
        enginehq: '^0.1.2',
      },
    },
    force,
  );

  writeFileIfMissing(
    path.join(targetDir, 'enginejs.config.ts'),
    `import type { EngineConfig } from 'enginehq';

export default {
  http: { port: Number(process.env.PORT || 3000) },
  autoload: { pipelinesDir: 'pipeline', workflowsDir: 'workflow', routesDir: 'routes' },
  engine: {
    app: { name: ${JSON.stringify(name)}, env: (process.env.NODE_ENV as any) || 'development' },
    db: { url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres', dialect: 'postgres' },
    dsl: {
      fragments: { modelsDir: 'dsl/models', metaDir: 'dsl/meta' },
    },
    auth: { jwt: { accessSecret: process.env.JWT_SECRET || 'dev', accessTtl: '1h' } },
    acl: {},
    rls: { subjects: {}, policies: {} },
    workflows: { enabled: true },
  } satisfies EngineConfig,
} as const;
`,
    force,
  );

  writeJsonIfMissing(
    path.join(targetDir, 'dsl', 'models', 'customer.json'),
    {
      customer: {
        auto_name: ['email'],
        pipelines: {
          create: { beforeValidate: [{ op: 'lowercase', field: 'email' }] },
          update: { beforeValidate: [{ op: 'lowercase', field: 'email' }] },
        },
        fields: {
          id: { type: 'int', primary: true, autoIncrement: true },
          email: { type: 'string', required: true, canfind: true },
        },
        indexes: { unique: [['email']], many: [], lower: [] },
        access: {
          read: ['*'],
          create: ['*'],
          update: ['*'],
          delete: ['*'],
        },
      },
    },
    force,
  );

  writeJsonIfMissing(
    path.join(targetDir, 'dsl', 'meta', 'dsl.json'),
    {
      dsl: {
        fields: {
          id: { type: 'int', primary: true, autoIncrement: true },
          hash: { type: 'string', length: 255 },
          dsl: { type: 'jsonb' },
        },
        access: { read: [], create: [], update: [], delete: [] },
      },
    },
    force,
  );

  writeJsonIfMissing(
    path.join(targetDir, 'dsl', 'meta', 'workflow_events_outbox.json'),
    {
      workflow_events_outbox: {
        fields: {
          id: { type: 'int', primary: true, autoIncrement: true },
          model: { type: 'string' },
          action: { type: 'string' },
          before: { type: 'jsonb' },
          after: { type: 'jsonb' },
          changed_fields: { type: 'jsonb' },
          origin: { type: 'string' },
          origin_chain: { type: 'jsonb' },
          parent_event_id: { type: 'string' },
          actor: { type: 'jsonb' },
          status: { type: 'string', default: 'pending' },
          attempts: { type: 'int', default: 0 },
          next_run_at: { type: 'datetime' },
        },
        access: {},
      },
    },
    force,
  );

  writeJsonIfMissing(
    path.join(targetDir, 'dsl', 'meta', 'workflow.json'),
    {
      workflow: {
        fields: {
          id: { type: 'int', primary: true, autoIncrement: true },
          slug: { type: 'string', required: true, canfind: true },
          name: { type: 'string', required: true, canfind: true },
          description: { type: 'text' },
          enabled: { type: 'boolean', default: true },
          spec: { type: 'jsonb', required: true, validate: [{ name: 'workflowSpec' }] },
        },
        indexes: { unique: [['slug']], many: [['name']], lower: [] },
        access: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'] },
      },
    },
    force,
  );

  writeFileIfMissing(
    path.join(targetDir, 'pipeline', 'validators.ts'),
    `import type { PipelineCtx } from '@enginehq/core';

export const validators = {
  // Return a string to fail validation; return void/true to pass.
  nonEmptyString: (_ctx: PipelineCtx, args: { value: unknown }) => {
    if (typeof args.value === 'string' && args.value.trim()) return;
    return 'Required';
  },
} as const;
`,
    force,
  );

  writeFileIfMissing(
    path.join(targetDir, 'pipeline', 'transforms.ts'),
    `import type { PipelineCtx } from '@enginehq/core';

export const transforms = {
  // Return the transformed value.
  trimString: (_ctx: PipelineCtx, args: { value: unknown }) => {
    return typeof args.value === 'string' ? args.value.trim() : args.value;
  },
} as const;
`,
    force,
  );

  writeFileIfMissing(
    path.join(targetDir, 'pipeline', 'ops.ts'),
    `import type { PipelineCtx } from '@enginehq/core';

export const ops = {
  // In a model pipeline spec: { op: 'custom', name: '<opName>', args?: any }
  logPayload: (ctx: PipelineCtx, args: unknown) => {
    void args;
    console.log('[pipeline op] payload', { model: ctx.modelKey, action: ctx.action, phase: ctx.phase, input: ctx.input });
  },
} as const;
`,
    force,
  );

  writeFileIfMissing(
    path.join(targetDir, 'workflow', 'customer-created.ts'),
    `export default {
  slug: 'customer-created',
  name: 'Customer Created',
  description: 'Runs when a customer is created.',
  triggers: [{ type: 'model', model: 'customer', actions: ['create'] }],
  steps: [{ op: 'log', message: 'customer created' }],
} as const;
`,
    force,
  );

  writeFileIfMissing(
    path.join(targetDir, 'routes', 'hello.ts'),
    `export default function register({ app }: any) {
  app.get('/api/hello', (_req: any, res: any) => res.ok({ message: 'hello from enginejs app' }));
}
`,
    force,
  );
}

function runtimePath() {
  // dist/cli.js -> dist/runtime/app.js
  return fileURLToPath(new URL('./runtime/app.js', import.meta.url));
}

function runtimeWorkflowsSyncPath() {
  // dist/cli.js -> dist/runtime/workflowsSync.js
  return fileURLToPath(new URL('./runtime/workflowsSync.js', import.meta.url));
}

function spawnStart({ cwd }: { cwd: string }) {
  const node = process.execPath;
  const rt = runtimePath();
  const child = spawn(node, ['--loader', 'tsx', rt], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

function spawnWorkflowsSync({ cwd, overwrite }: { cwd: string; overwrite: boolean }) {
  const node = process.execPath;
  const rt = runtimeWorkflowsSyncPath();
  const args = ['--loader', 'tsx', rt, ...(overwrite ? ['--overwrite'] : [])];
  const child = spawn(node, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

async function runSync({ cwd, dryRun, requireSnapshot, allowNoSnapshot }: { cwd: string; dryRun: boolean; requireSnapshot: boolean; allowNoSnapshot: boolean }) {
  const cfg = await loadEngineJsConfig(cwd);
  const engine = createEngine(cfg.engine);
  await engine.init();

  const sequelize = engine.services.resolve<any>('db', { scope: 'singleton' });
  const report = await safeSync({
    sequelize,
    orm: engine.orm!,
    dsl: engine.dsl! as any,
    dryRun,
    snapshot: { modelKey: 'dsl', requireSnapshot, allowNoSnapshot },
  });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

export async function runCli(argv = process.argv): Promise<void> {
  const { cmd, flags, positionals } = parseArgs(argv);
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') usage(0);

  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    process.stdout.write(`${PKG_NAME}\n`);
    return;
  }

  if (cmd === 'init') {
    const dir = positionals[0];
    if (!dir) usage(1);
    initEngineJsApp({ dir, force: flags.has('--force') });
    process.stdout.write(`Initialized EngineJS app in ${path.resolve(dir)}\n`);
    return;
  }

  if (cmd === 'sync') {
    const requireSnapshot = flags.has('--requireSnapshot');
    await runSync({
      cwd: process.cwd(),
      dryRun: flags.has('--dry-run'),
      requireSnapshot,
      allowNoSnapshot: flags.has('--allowNoSnapshot') ? true : !requireSnapshot,
    });
    return;
  }

  if (cmd === 'workflows') {
    const sub = positionals[0] || '';
    if (sub === 'sync') {
      spawnWorkflowsSync({ cwd: process.cwd(), overwrite: flags.has('--overwrite') });
      return;
    }
    usage(1);
  }

  if (cmd === 'start' || cmd === 'dev') {
    spawnStart({ cwd: process.cwd() });
    return;
  }

  usage(1);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  runCli();
}
