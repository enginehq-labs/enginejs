import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The CLI spawns the BUILT runtime, not the source, so this test does the same.
 * This file compiles to dist-test/test/integration, so the package root is
 * three levels up.
 */
const packageRoot = path.resolve(here, '..', '..', '..');
const runtimeEntry = path.join(packageRoot, 'dist', 'runtime', 'app.js');

/** Node resolves `--import tsx` against the child cwd, and the temp app has no
 *  node_modules. Resolve it here and pass an absolute file:// URL instead. */
function tsxSpecifier(): string {
  const require = createRequire(import.meta.url);
  return pathToFileURL(require.resolve('tsx')).href;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') return reject(new Error('No address'));
      const { port } = addr;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** Minimal app directory: a config and the dsl meta model the engine needs. */
function scaffoldApp(root: string, port: number): void {
  const metaDir = path.join(root, 'dsl', 'meta');
  fs.mkdirSync(path.join(root, 'dsl', 'models'), { recursive: true });
  fs.mkdirSync(metaDir, { recursive: true });

  fs.writeFileSync(
    path.join(metaDir, 'dsl.json'),
    JSON.stringify({
      dsl: {
        fields: {
          id: { type: 'int', primary: true, autoIncrement: true },
          hash: { type: 'string', length: 255 },
          dsl: { type: 'jsonb' },
        },
        access: { read: [], create: [], update: [], delete: [] },
      },
    }),
  );

  // No DB connection is opened: Sequelize connects lazily and the workflow
  // registry defaults to 'fs', so nothing queries at startup.
  fs.writeFileSync(
    path.join(root, 'enginejs.config.ts'),
    `export default {
  http: { port: ${port} },
  engine: {
    app: { name: 'start-app-it', env: 'test' },
    db: { url: 'postgres://postgres:postgres@127.0.0.1:1/none', dialect: 'postgres' },
    dsl: { fragments: { modelsDir: 'dsl/models', metaDir: 'dsl/meta' } },
    auth: { jwt: { accessSecret: '${'x'.repeat(32)}', accessTtl: '1h' } },
    acl: {},
    rls: { subjects: {}, policies: {} },
    workflows: { enabled: false },
  },
} as const;
`,
  );
}

type Started = { child: ChildProcess; output: () => string };

function spawnRuntime(cwd: string): Started {
  const child = spawn(process.execPath, ['--import', tsxSpecifier(), runtimeEntry], {
    cwd,
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout?.on('data', (c) => (output += String(c)));
  child.stderr?.on('data', (c) => (output += String(c)));
  return { child, output: () => output };
}

/** Resolves when the text appears, or when the child exits first. */
function waitForOutput(started: Started, needle: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      if (started.output().includes(needle)) {
        clearInterval(timer);
        return resolve();
      }
      if (started.child.exitCode !== null) {
        clearInterval(timer);
        return reject(
          new Error(
            `runtime exited with code ${started.child.exitCode} before printing "${needle}".\n` +
              `output:\n${started.output() || '(no output)'}`,
          ),
        );
      }
      if (Date.now() > deadline) {
        clearInterval(timer);
        return reject(new Error(`timed out waiting for "${needle}".\noutput:\n${started.output()}`));
      }
    }, 100);
  });
}

test('enginehq runtime: starts a server and serves /health', async (t) => {
  assert.ok(
    fs.existsSync(runtimeEntry),
    `built runtime missing at ${runtimeEntry}. Run: npm -w enginehq run build`,
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-start-app-'));
  const port = await freePort();
  scaffoldApp(root, port);

  const started = spawnRuntime(root);
  t.after(() => {
    started.child.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  });

  // Fails today: the built app.js only exports startEngineJsApp and never calls
  // it, so the process exits 0 immediately and prints nothing.
  await waitForOutput(started, 'listening on', 20_000);

  const res = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(res.status, 200);

  const body = (await res.json()) as any;
  assert.equal(body.success, true);
  assert.equal(body.data.ok, true);
});
