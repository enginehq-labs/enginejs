import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

/**
 * End to end: `enginehq init --auth`, then sync, start, and exercise the built-in auth
 * routes and user CRUD over HTTP against a real PostgreSQL container.
 *
 * This file compiles to dist-test/test/integration, so the package root is three levels up.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..', '..', '..');
const cliEntry = path.join(packageRoot, 'bin', 'enginehq.js');
const runtimeEntry = path.join(packageRoot, 'dist', 'runtime', 'app.js');

const PASSWORD = 'enginejs';
const DB_NAME = 'enginejs_auth_scaffold';
const JWT_SECRET = 'auth-scaffold-secret';

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isTruthy(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function ensureDockerImage(image: string): boolean {
  try {
    execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
    return true;
  } catch {}

  if (!isTruthy(process.env.ENGINEJS_DOCKER_PULL)) return false;

  const timeoutMs = Number(process.env.ENGINEJS_DOCKER_PULL_TIMEOUT_MS || 30_000);
  try {
    execFileSync('docker', ['pull', image], { stdio: 'pipe', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

function startPostgresContainer(image: string, password: string, db: string): { id: string; port: number } {
  const timeoutMs = Number(process.env.ENGINEJS_DOCKER_RUN_TIMEOUT_MS || 10_000);
  const id = execFileSync(
    'docker',
    ['run', '-d', '--rm', '-e', `POSTGRES_PASSWORD=${password}`, '-e', `POSTGRES_DB=${db}`, '-p', '127.0.0.1::5432', image],
    { encoding: 'utf8', timeout: timeoutMs },
  ).trim();

  const portLine = execFileSync('docker', ['port', id, '5432/tcp'], { encoding: 'utf8' }).trim();
  const port = Number(portLine.split(':').pop());
  if (!Number.isFinite(port) || port <= 0) throw new Error(`Failed to parse docker port: ${portLine}`);
  return { id, port };
}

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

async function waitFor<T>(fn: () => T | Promise<T>, timeoutMs: number, intervalMs = 1000): Promise<T> {
  const started = Date.now();
  let lastErr: unknown = null;
  while (Date.now() - started < timeoutMs) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw lastErr ?? new Error('Timed out');
}

type Started = { child: ChildProcess; output: () => string };

function spawnRuntime(cwd: string, env: NodeJS.ProcessEnv): Started {
  const child = spawn(process.execPath, ['--import', tsxSpecifier(), runtimeEntry], {
    cwd,
    env,
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

async function call(
  base: string,
  method: string,
  route: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('docker postgres: enginehq init --auth produces a working and safe auth app', async (t) => {
  if (!dockerAvailable()) return t.skip('Docker not available');

  const image = process.env.ENGINEJS_TEST_PG_IMAGE || 'postgres:16-alpine';
  if (!ensureDockerImage(image)) {
    return t.skip(`Docker image not available: ${image} (pre-pull it, or set ENGINEJS_DOCKER_PULL=1)`);
  }

  assert.ok(fs.existsSync(runtimeEntry), `built runtime missing at ${runtimeEntry}. Run: npm -w enginehq run build`);

  const { id: containerId, port: pgPort } = startPostgresContainer(image, PASSWORD, DB_NAME);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-auth-scaffold-'));
  const appDir = path.join(root, 'app');
  let runtime: Started | null = null;

  t.after(() => {
    runtime?.child.kill('SIGKILL');
    try {
      execFileSync('docker', ['rm', '-f', containerId], { stdio: 'ignore' });
    } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  });

  // 1. Scaffold with the real CLI.
  execFileSync(process.execPath, [cliEntry, 'init', appDir, '--auth'], { stdio: 'pipe' });

  // The scaffolded enginejs.config.ts reads these, so the test changes no config file.
  const appPort = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(appPort),
    JWT_SECRET,
    DATABASE_URL: `postgres://postgres:${PASSWORD}@127.0.0.1:${pgPort}/${DB_NAME}`,
  };

  // 2. Sync the schema. Retry until PostgreSQL accepts connections.
  await waitFor(
    () => execFileSync(process.execPath, ['--import', tsxSpecifier(), cliEntry, 'sync'], { cwd: appDir, env, stdio: 'pipe' }),
    60_000,
  );

  // 3. Start the runtime the way `enginehq start` does.
  runtime = spawnRuntime(appDir, env);
  await waitForOutput(runtime, 'listening on', 30_000);
  const base = `http://127.0.0.1:${appPort}`;

  const ada = { email: 'ada@example.com', password: 'ada-password' };

  await t.test('register ignores client roles and returns no password hash', async () => {
    const res = await call(base, 'POST', '/auth/register', { body: { ...ada, roles: ['admin'] } });
    assert.equal(res.status, 201);
    assert.equal('password_hash' in res.body.data.user, false, 'the response must not hold the hash');
    assert.equal('password' in res.body.data.user, false);

    const me = await call(base, 'GET', '/auth/me', { token: res.body.data.accessToken });
    assert.equal(me.body.data.isAuthenticated, true);
    assert.deepEqual(me.body.data.roles, []);
  });

  let adaToken = '';
  let adaUserId = 0;

  await t.test('login works for the registered user', async () => {
    const res = await call(base, 'POST', '/auth/login', { body: ada });
    assert.equal(res.status, 200);
    adaToken = res.body.data.accessToken;
    const me = await call(base, 'GET', '/auth/me', { token: adaToken });
    adaUserId = Number(me.body.data.subjects.user.id);
    assert.ok(adaUserId > 0);
  });

  await t.test('anonymous callers cannot read or create users', async () => {
    const list = await call(base, 'GET', '/api/crud/user');
    assert.equal(list.status, 403);

    const create = await call(base, 'POST', '/api/crud/user', { body: { email: 'eve@example.com', password: 'x' } });
    assert.ok([403, 404].includes(create.status), `expected a denial, got ${create.status}`);
  });

  await t.test('a user without the admin role cannot change a user', async () => {
    // Without a real id and token the PATCH returns 404 and this check passes by accident.
    assert.ok(adaUserId > 0 && adaToken, 'needs the id and token from the login step');
    const res = await call(base, 'PATCH', `/api/crud/user/${adaUserId}`, { token: adaToken, body: { roles: ['admin'] } });
    assert.ok([403, 404].includes(res.status), `expected a denial, got ${res.status}`);
  });

  let adminToken = '';

  await t.test('roles stored in the database reach the actor', async () => {
    execFileSync('docker', [
      'exec', containerId, 'psql', '-U', 'postgres', '-d', DB_NAME,
      '-c', `UPDATE "user" SET roles = '{admin}' WHERE email = '${ada.email}'`,
    ], { stdio: 'pipe' });

    const login = await call(base, 'POST', '/auth/login', { body: ada });
    assert.equal(login.status, 200);
    adminToken = login.body.data.accessToken;

    const me = await call(base, 'GET', '/auth/me', { token: adminToken });
    assert.deepEqual(me.body.data.roles, ['admin']);
  });

  await t.test('an admin list of users holds no password hash', async () => {
    const res = await call(base, 'GET', '/api/crud/user', { token: adminToken });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 1);
    for (const row of res.body.data) assert.equal('password_hash' in row, false);
  });

  const bob = { email: 'bob@example.com', password: 'bob-password-1' };
  let bobId = 0;

  await t.test('a user created through CRUD gets a hashed password', async () => {
    const res = await call(base, 'POST', '/api/crud/user', { token: adminToken, body: bob });
    assert.equal(res.status, 201);
    assert.equal('password_hash' in res.body.data, false);
    bobId = Number(res.body.data.id);

    const login = await call(base, 'POST', '/auth/login', { body: bob });
    assert.equal(login.status, 200, 'bob must be able to log in with the password set through CRUD');
  });

  await t.test('a password changed through CRUD is hashed and replaces the old one', async () => {
    const newPassword = 'bob-password-2';
    const res = await call(base, 'PATCH', `/api/crud/user/${bobId}`, { token: adminToken, body: { password: newPassword } });
    assert.equal(res.status, 200);
    assert.equal('password_hash' in res.body.data, false);

    assert.equal((await call(base, 'POST', '/auth/login', { body: { ...bob, password: newPassword } })).status, 200);
    assert.equal((await call(base, 'POST', '/auth/login', { body: bob })).status, 401);

    const read = await call(base, 'GET', `/api/crud/user/${bobId}`, { token: adminToken });
    assert.equal('password_hash' in read.body.data, false);
  });

  await t.test('logout revokes the session behind the refresh token', async () => {
    const login = await call(base, 'POST', '/auth/login', { body: ada });
    const { accessToken, refreshToken } = login.body.data;

    assert.equal((await call(base, 'POST', '/auth/logout', { token: accessToken, body: {} })).status, 200);
    assert.equal((await call(base, 'POST', '/auth/refresh', { body: { refreshToken } })).status, 401);
  });
});
