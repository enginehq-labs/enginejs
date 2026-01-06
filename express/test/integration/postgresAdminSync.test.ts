import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

import { createEngine } from '@enginehq/core';
import { createEngineExpressApp } from '../../src/http/createEngineExpressApp.js';

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
  return new Promise<{ server: http.Server; url: string }>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('No address'));
      resolve({ server, url: `http://${addr.address}:${addr.port}` });
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

test('docker postgres: POST /admin/sync creates tables so CRUD can insert; deny uses hideExistence', async (t) => {
  if (!dockerAvailable()) return t.skip('Docker not available');

  const image = process.env.ENGINEJS_TEST_PG_IMAGE || 'postgres:16-alpine';
  if (!ensureDockerImage(image)) {
    return t.skip(
      `Docker image not available: ${image} (pre-pull it, or set ENGINEJS_DOCKER_PULL=1)`,
    );
  }

  const password = 'enginejs';
  const dbName = 'enginejs_admin_sync';
  const { id, port } = startPostgresContainer(image, password, dbName);
  t.after(() => {
    try {
      execFileSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
    } catch {}
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-admin-sync-'));
  const dslDir = path.join(root, 'dsl');
  const schemaPath = path.join(dslDir, 'schema.json');
  const modelsDir = path.join(dslDir, 'models');
  const metaDir = path.join(dslDir, 'meta');
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.mkdirSync(metaDir, { recursive: true });

  fs.writeFileSync(
    schemaPath,
    JSON.stringify(
      {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        additionalProperties: true,
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(modelsDir, 'post.json'),
    JSON.stringify(
      {
        post: {
          fields: {
            id: { type: 'int', primary: true, autoIncrement: true },
            title: { type: 'string' },
          },
          access: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'] },
        },
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(metaDir, 'dsl.json'),
    JSON.stringify(
      {
        dsl: {
          fields: {
            id: { type: 'int', primary: true, autoIncrement: true },
            hash: { type: 'string', length: 255 },
            dsl: { type: 'jsonb' },
          },
          access: { read: [], create: ['admin'], update: ['admin'], delete: [] },
        },
      },
      null,
      2,
    ),
  );

  const engine = createEngine({
    app: { name: 'enginejs-admin-sync', env: 'test' },
    db: { url: `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`, dialect: 'postgres' },
    dsl: { schemaPath, fragments: { modelsDir, metaDir } },
    auth: { jwt: { accessSecret: 'x', accessTtl: '1h' } },
    acl: {},
    rls: { subjects: {}, policies: {} },
    http: { hideExistence: true },
  });

  await engine.init();
  const sequelize = engine.services.resolve<any>('db', { scope: 'singleton' });
  await waitFor(() => sequelize.authenticate(), 30_000);

  const app = createEngineExpressApp(engine, {
    defaultActor: { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {} },
  });

  const { server, url } = await listen(app);
  try {
    // Dry-run does not create tables.
    const dryRes = await fetch(`${url}/admin/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dryRun: true }),
    });
    const dryBody = (await dryRes.json()) as any;
    assert.equal(dryRes.status, 200);
    assert.equal(dryBody.success, true);
    assert.equal(dryBody.data.dryRun, true);

    const createFail = await fetch(`${url}/api/post`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Hello' }),
    });
    assert.equal(createFail.status, 500);

    // Real sync creates tables so CRUD can insert.
    const syncRes = await fetch(`${url}/admin/sync`, { method: 'POST' });
    const syncBody = (await syncRes.json()) as any;
    assert.equal(syncRes.status, 200);
    assert.equal(syncBody.success, true);
    assert.equal(syncBody.data.dryRun, false);

    const createRes = await fetch(`${url}/api/post`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Hello' }),
    });
    const createBody = (await createRes.json()) as any;
    assert.equal(createRes.status, 201);
    assert.equal(createBody.success, true);
    assert.equal(createBody.data.title, 'Hello');

    // Deny uses hideExistence (404) for non-admin actor.
    const app2 = createEngineExpressApp(engine, {
      defaultActor: { isAuthenticated: true, subjects: {}, roles: ['user'], claims: {} },
    });
    const { server: s2, url: url2 } = await listen(app2);
    try {
      const denyRes = await fetch(`${url2}/admin/sync`, { method: 'POST' });
      assert.equal(denyRes.status, 404);
    } finally {
      s2.close();
    }
  } finally {
    server.close();
    await sequelize.close();
  }
});
