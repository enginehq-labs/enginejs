import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

import { createEngine } from '@enginehq/core';
import { getBearerToken, verifyActorAccessTokenHS256 } from '@enginehq/auth';
import { createEngineExpressApp } from '../../src/http/createEngineExpressApp.js';

const ACCESS_SECRET = 'test-access-secret';

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
    [
      'run',
      '-d',
      '--rm',
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      '-e',
      `POSTGRES_DB=${db}`,
      '-p',
      '127.0.0.1::5432',
      image,
    ],
    { encoding: 'utf8', timeout: timeoutMs },
  ).trim();

  const portLine = execFileSync('docker', ['port', id, '5432/tcp'], { encoding: 'utf8' }).trim();
  const portStr = portLine.split(':').pop();
  const port = Number(portStr);
  if (!Number.isFinite(port) || port <= 0) throw new Error(`Failed to parse docker port: ${portLine}`);

  return { id, port };
}

function listen(app: any) {
  const server = http.createServer(app);
  return new Promise<{ url: string; close: () => void }>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('No address'));
      resolve({
        url: `http://${addr.address}:${addr.port}`,
        close: () => {
          if ('closeAllConnections' in server) (server as any).closeAllConnections();
          server.close();
        },
      });
    });
  });
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitFor<T>(fn: () => Promise<T>, timeoutMs: number) {
  const started = Date.now();
  let lastErr: unknown = null;
  while (Date.now() - started < timeoutMs) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await sleep(250);
    }
  }
  throw lastErr ?? new Error('Timed out');
}

async function request(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const payload = opts.body === undefined ? null : JSON.stringify(opts.body);
    const req = http.request(
      url,
      {
        method: opts.method || 'GET',
        headers: {
          ...(payload ? { 'content-type': 'application/json' } : {}),
          ...(opts.headers || {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, body: data ? JSON.parse(data) : null });
          } catch {
            reject(new Error(`Failed to parse response (${res.statusCode}): ${data}`));
          }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('docker postgres: builtin auth register -> login -> refresh -> logout flow', async (t) => {
  if (!dockerAvailable()) return t.skip('Docker not available');

  const image = process.env.ENGINEJS_TEST_PG_IMAGE || 'postgres:16-alpine';
  if (!ensureDockerImage(image)) {
    return t.skip(`Docker image not available: ${image} (pre-pull it, or set ENGINEJS_DOCKER_PULL=1)`);
  }

  const password = 'enginejs';
  const dbName = 'enginejs_builtin_auth';
  const { id, port } = startPostgresContainer(image, password, dbName);
  t.after(() => {
    try {
      execFileSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
    } catch {}
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-builtin-auth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const modelsDir = path.join(root, 'dsl', 'models');
  const metaDir = path.join(root, 'dsl', 'meta');
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.mkdirSync(metaDir, { recursive: true });

  fs.writeFileSync(
    path.join(modelsDir, 'user.json'),
    JSON.stringify({
      user: {
        fields: {
          id: { type: 'int', primary: true, autoIncrement: true },
          email: { type: 'string' },
          password_hash: { type: 'string', length: 255 },
          roles: { type: 'jsonb' },
        },
        access: { read: ['system'], create: ['system'], update: ['system'], delete: ['system'] },
      },
    }),
  );

  // Present => the router auto-selects SequelizeAuthSessionStore over in-memory.
  fs.writeFileSync(
    path.join(metaDir, 'auth_session.json'),
    JSON.stringify({
      auth_session: {
        fields: {
          id: { type: 'uuid', primary: true },
          subject_type: { type: 'string' },
          subject_model: { type: 'string' },
          subject_id: { type: 'string', canfind: true },
          refresh_hash: { type: 'string', length: 255 },
          refresh_expires_at: { type: 'datetime' },
          revoked: { type: 'boolean', default: false },
          revoked_at: { type: 'datetime' },
          device_token: { type: 'string' },
        },
        indexes: { unique: [], many: [['subject_id']], lower: [] },
        access: { read: [], create: [], update: [], delete: [] },
      },
    }),
  );

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

  const engine = createEngine({
    app: { name: 'enginejs-builtin-auth-it', env: 'test' },
    db: { url: `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`, dialect: 'postgres' },
    dsl: { fragments: { modelsDir, metaDir } },
    auth: {
      jwt: { accessSecret: ACCESS_SECRET, accessTtl: '15m' },
      sessions: { enabled: true, refreshTtlDays: 7, refreshRotate: true },
      local: { userModel: 'user' },
    },
    acl: {},
    rls: { subjects: {}, policies: {} },
    workflows: { enabled: false },
  });

  await engine.init();
  const sequelize = engine.services.resolve<any>('db', { scope: 'singleton' });
  await waitFor(() => sequelize.authenticate(), 30_000);
  await sequelize.sync({ force: true });

  // Mirrors the JWT actorResolver that `enginehq start` auto-wires at runtime.
  const app = await createEngineExpressApp(engine, {
    resolveActor: async (req: any) => {
      const token = getBearerToken(req.headers?.authorization);
      if (!token) return { isAuthenticated: false, subjects: {}, roles: [], claims: {} };
      try {
        return await verifyActorAccessTokenHS256({ token, secret: ACCESS_SECRET });
      } catch {
        return { isAuthenticated: false, subjects: {}, roles: [], claims: {} };
      }
    },
  });

  const { url, close } = await listen(app);
  t.after(close);

  const creds = { email: 'ada@example.com', password: 'correct-horse-battery' };

  await t.test('register creates the user and returns a token pair', async () => {
    const res = await request(`${url}/auth/register`, { method: 'POST', body: creds });
    assert.equal(res.status, 201);
    assert.ok(res.body.data.accessToken, 'should return an accessToken');
    assert.ok(res.body.data.refreshToken, 'should return a refreshToken');
    assert.equal(res.body.data.user.email, creds.email);
  });

  await t.test('register never persists or echoes the plain-text password', async () => {
    const res = await request(`${url}/auth/login`, { method: 'POST', body: creds });
    const me = await request(`${url}/auth/me`, {
      headers: { authorization: `Bearer ${res.body.data.accessToken}` },
    });
    assert.equal(JSON.stringify(me.body).includes(creds.password), false);

    const [row] = await sequelize.query(
      `SELECT password_hash FROM "user" WHERE email = '${creds.email}'`,
      { type: 'SELECT' },
    );
    assert.ok(String(row.password_hash).startsWith('pbkdf2:'), 'column should hold a pbkdf2 hash');
    assert.equal(String(row.password_hash).includes(creds.password), false);
  });

  await t.test('register rejects a missing password', async () => {
    const res = await request(`${url}/auth/register`, {
      method: 'POST',
      body: { email: 'nopass@example.com' },
    });
    assert.equal(res.status, 400);
  });

  let accessToken = '';
  let refreshToken = '';

  await t.test('login with correct credentials returns a token pair', async () => {
    const res = await request(`${url}/auth/login`, { method: 'POST', body: creds });
    assert.equal(res.status, 200);
    accessToken = res.body.data.accessToken;
    refreshToken = res.body.data.refreshToken;
    assert.ok(accessToken);
    assert.ok(refreshToken);
  });

  await t.test('login with a wrong password is rejected as 401', async () => {
    const res = await request(`${url}/auth/login`, {
      method: 'POST',
      body: { ...creds, password: 'wrong' },
    });
    assert.equal(res.status, 401);
  });

  await t.test('login with an unknown email is rejected as 401', async () => {
    const res = await request(`${url}/auth/login`, {
      method: 'POST',
      body: { email: 'ghost@example.com', password: 'whatever' },
    });
    assert.equal(res.status, 401);
  });

  await t.test('me returns the authenticated actor for a valid token', async () => {
    const res = await request(`${url}/auth/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.isAuthenticated, true);
    assert.equal(res.body.data.subjects.user.model, 'user');
  });

  await t.test('me returns an anonymous actor without a token', async () => {
    const res = await request(`${url}/auth/me`);
    assert.equal(res.body.data.isAuthenticated, false);
  });

  await t.test('me returns an anonymous actor for a garbage token', async () => {
    const res = await request(`${url}/auth/me`, {
      headers: { authorization: 'Bearer not-a-real-jwt' },
    });
    assert.equal(res.body.data.isAuthenticated, false);
  });

  await t.test('refresh rotates the refresh token', async () => {
    const res = await request(`${url}/auth/refresh`, { method: 'POST', body: { refreshToken } });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.refreshToken);
    assert.notEqual(res.body.data.refreshToken, refreshToken, 'rotation should issue a new token');
    const rotated = res.body.data.refreshToken;

    const replay = await request(`${url}/auth/refresh`, { method: 'POST', body: { refreshToken } });
    assert.equal(replay.status, 401, 'the consumed refresh token must not be reusable');

    refreshToken = rotated;
  });

  await t.test('refresh rejects a missing token with 400', async () => {
    const res = await request(`${url}/auth/refresh`, { method: 'POST', body: {} });
    assert.equal(res.status, 400);
  });

  await t.test('refresh rejects an unknown token with 401', async () => {
    const res = await request(`${url}/auth/refresh`, {
      method: 'POST',
      body: { refreshToken: 'bogus.token' },
    });
    assert.equal(res.status, 401);
  });

  await t.test('sessions are persisted to the auth_session table', async () => {
    const rows = await sequelize.query('SELECT id, revoked FROM auth_session', { type: 'SELECT' });
    assert.ok(rows.length > 0, 'login/register should have written session rows to the DB');
  });

  await t.test('logout invalidates the session behind the refresh token', async () => {
    const res = await request(`${url}/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      body: {},
    });
    assert.equal(res.status, 200);

    const after = await request(`${url}/auth/refresh`, { method: 'POST', body: { refreshToken } });
    assert.equal(after.status, 401, 'refresh must fail once the session is revoked by logout');

    const revoked = await sequelize.query('SELECT id FROM auth_session WHERE revoked = true', { type: 'SELECT' });
    assert.ok(revoked.length > 0, 'logout should mark the session row revoked in the DB');
  });
});
