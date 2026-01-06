import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const PKG_NAME = 'enginehq';

function usage(code = 0): never {
  const msg = `Usage:
  enginehq init <dir> [--force]
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
        enginehq: '^0.1.0',
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
      schemaPath: 'dsl/schema.json',
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

  writeJsonIfMissing(path.join(targetDir, 'dsl', 'schema.json'), { type: 'object' }, force);

  writeJsonIfMissing(
    path.join(targetDir, 'dsl', 'models', 'customer.json'),
    {
      customer: {
        auto_name: ['email'],
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

  writeFileIfMissing(
    path.join(targetDir, 'pipeline', 'customer.pipeline.ts'),
    `export default {
  customer: {
    create: {
      beforeValidate: [
        {
          op: 'lowercase',
          field: 'email',
        },
      ],
    },
    update: {
      beforeValidate: [
        {
          op: 'lowercase',
          field: 'email',
        },
      ],
    },
  },
} as const;
`,
    force,
  );

  writeFileIfMissing(
    path.join(targetDir, 'workflow', 'customer-created.ts'),
    `export default {
  name: 'customer-created',
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

export function runCli(argv = process.argv): void {
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
