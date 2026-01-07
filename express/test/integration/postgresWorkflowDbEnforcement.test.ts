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

test('docker postgres: workflow db.update is blocked by RLS for inherit actor', async (t) => {
  if (!dockerAvailable()) return t.skip('Docker not available');

  const image = process.env.ENGINEJS_TEST_PG_IMAGE || 'postgres:16-alpine';
  if (!ensureDockerImage(image)) {
    return t.skip(
      `Docker image not available: ${image} (pre-pull it, or set ENGINEJS_DOCKER_PULL=1)`,
    );
  }
  const password = 'enginejs';
  const dbName = 'enginejs_wf_rls1';
  const { id, port } = startPostgresContainer(image, password, dbName);
  t.after(() => {
    try {
      execFileSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
    } catch {}
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-wf-rls1-'));
  const dslDir = path.join(root, 'dsl');
  const modelsDir = path.join(dslDir, 'models');
  const metaDir = path.join(dslDir, 'meta');
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.mkdirSync(metaDir, { recursive: true });

  fs.writeFileSync(
    path.join(modelsDir, 'post.json'),
    JSON.stringify(
      {
        post: {
          fields: {
            id: { type: 'int', primary: true, autoIncrement: true },
            customer_id: { type: 'int' },
            status: { type: 'string' },
          },
          access: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'] },
        },
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(metaDir, 'workflow_events_outbox.json'),
    JSON.stringify(
      {
        workflow_events_outbox: {
          fields: {
            id: { type: 'int', primary: true, autoIncrement: true },
            model: { type: 'string' },
            action: { type: 'string' },
            before: { type: 'jsonb' },
            after: { type: 'jsonb' },
            changed_fields: { type: 'string', multi: true },
            actor: { type: 'jsonb' },
            status: { type: 'string' },
            attempts: { type: 'int' },
            next_run_at: { type: 'datetime' },
          },
          access: { read: [], create: [], update: [], delete: [] },
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
          access: { read: [], create: [], update: [], delete: [] },
        },
      },
      null,
      2,
    ),
  );

  const engine = createEngine({
    app: { name: 'enginejs-wf-rls1', env: 'test' },
    db: { url: `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`, dialect: 'postgres' },
    dsl: { fragments: { modelsDir, metaDir } },
    auth: { jwt: { accessSecret: 'x', accessTtl: '1h' } },
    acl: {},
    rls: {
      subjects: {},
      policies: {
        post: {
          update: { subject: 'customer', field: 'customer_id', writeMode: 'validate' } as any,
        },
      },
    },
    workflows: { enabled: true },
  });

  engine.registerPlugin({
    name: 'wf',
    registerWorkflows(registry: any) {
      registry.register('post-on-create', {
        actorMode: 'inherit',
        triggers: [{ type: 'model', model: 'post', actions: ['create'] }],
        steps: [
          {
            op: 'db.update',
            model: 'post',
            where: { field: 'id', value: { from: 'after.id' } },
            set: { status: 'processed' },
          },
        ],
      });
    },
  } as any);

  await engine.init();
  const sequelize = engine.services.resolve<any>('db', { scope: 'singleton' });
  await waitFor(() => sequelize.authenticate(), 30_000);
  await sequelize.sync({ force: true });

  const app = createEngineExpressApp(engine, {
    defaultActor: {
      isAuthenticated: true,
      subjects: { customer: { type: 'customer', model: 'customer', id: 1 } },
      roles: ['admin'],
      claims: {},
    },
  });

  const { server, url } = await listen(app);
  try {
    const res = await fetch(`${url}/api/post`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customer_id: 2 }),
    });
    assert.equal(res.status, 201);

    const runner = engine.services.resolve<any>('workflowRunner', { scope: 'singleton' });
    const r = await runner.runOnce({ claimLimit: 10 });
    assert.equal(r.claimed, 1);
    assert.equal(r.processed, 0);

    const post = (engine.orm as any).models.post;
    const row = await post.findOne({ where: { id: 1 }, raw: true });
    assert.equal(row.status, null);

    const outbox = (engine.orm as any).models.workflow_events_outbox;
    const outRow = await outbox.findOne({ where: { model: 'post', action: 'create' }, raw: true });
    assert.equal(outRow.status, 'failed');
  } finally {
    server.close();
    await sequelize.close();
  }
});

test('docker postgres: workflow db.update bypasses ACL/RLS for system actor', async (t) => {
  if (!dockerAvailable()) return t.skip('Docker not available');

  const image = process.env.ENGINEJS_TEST_PG_IMAGE || 'postgres:16-alpine';
  if (!ensureDockerImage(image)) {
    return t.skip(
      `Docker image not available: ${image} (pre-pull it, or set ENGINEJS_DOCKER_PULL=1)`,
    );
  }
  const password = 'enginejs';
  const dbName = 'enginejs_wf_rls2';
  const { id, port } = startPostgresContainer(image, password, dbName);
  t.after(() => {
    try {
      execFileSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
    } catch {}
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-wf-rls2-'));
  const dslDir = path.join(root, 'dsl');
  const modelsDir = path.join(dslDir, 'models');
  const metaDir = path.join(dslDir, 'meta');
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.mkdirSync(metaDir, { recursive: true });

  fs.writeFileSync(
    path.join(modelsDir, 'post.json'),
    JSON.stringify(
      {
        post: {
          fields: {
            id: { type: 'int', primary: true, autoIncrement: true },
            customer_id: { type: 'int' },
            status: { type: 'string' },
          },
          access: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'] },
        },
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(metaDir, 'workflow_events_outbox.json'),
    JSON.stringify(
      {
        workflow_events_outbox: {
          fields: {
            id: { type: 'int', primary: true, autoIncrement: true },
            model: { type: 'string' },
            action: { type: 'string' },
            before: { type: 'jsonb' },
            after: { type: 'jsonb' },
            changed_fields: { type: 'string', multi: true },
            actor: { type: 'jsonb' },
            status: { type: 'string' },
            attempts: { type: 'int' },
            next_run_at: { type: 'datetime' },
          },
          access: { read: [], create: [], update: [], delete: [] },
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
          access: { read: [], create: [], update: [], delete: [] },
        },
      },
      null,
      2,
    ),
  );

  const engine = createEngine({
    app: { name: 'enginejs-wf-rls2', env: 'test' },
    db: { url: `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`, dialect: 'postgres' },
    dsl: { fragments: { modelsDir, metaDir } },
    auth: { jwt: { accessSecret: 'x', accessTtl: '1h' } },
    acl: {},
    rls: {
      subjects: {},
      policies: {
        post: {
          update: { subject: 'customer', field: 'customer_id', writeMode: 'validate' } as any,
        },
      },
    },
    workflows: { enabled: true },
  });

  engine.registerPlugin({
    name: 'wf',
    registerWorkflows(registry: any) {
      registry.register('post-on-create', {
        actorMode: 'system',
        triggers: [{ type: 'model', model: 'post', actions: ['create'] }],
        steps: [
          {
            op: 'db.update',
            model: 'post',
            where: { field: 'id', value: { from: 'after.id' } },
            set: { status: 'processed' },
          },
        ],
      });
    },
  } as any);

  await engine.init();
  const sequelize = engine.services.resolve<any>('db', { scope: 'singleton' });
  await waitFor(() => sequelize.authenticate(), 30_000);
  await sequelize.sync({ force: true });

  const app = createEngineExpressApp(engine, {
    defaultActor: {
      isAuthenticated: true,
      subjects: { customer: { type: 'customer', model: 'customer', id: 1 } },
      roles: ['admin'],
      claims: {},
    },
  });

  const { server, url } = await listen(app);
  try {
    const res = await fetch(`${url}/api/post`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customer_id: 2 }),
    });
    assert.equal(res.status, 201);

    const runner = engine.services.resolve<any>('workflowRunner', { scope: 'singleton' });
    const r = await runner.runOnce({ claimLimit: 10 });
    assert.equal(r.claimed, 1);
    assert.equal(r.processed, 1);

    const post = (engine.orm as any).models.post;
    const row = await post.findOne({ where: { id: 1 }, raw: true });
    assert.equal(row.status, 'processed');
  } finally {
    server.close();
    await sequelize.close();
  }
});
