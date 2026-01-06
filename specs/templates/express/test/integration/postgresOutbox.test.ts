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

test('docker postgres: create -> pipeline -> outbox row inserted', async (t) => {
  if (!dockerAvailable()) return t.skip('Docker not available');

  const image = process.env.ENGINEJS_TEST_PG_IMAGE || 'postgres:16-alpine';
  if (!ensureDockerImage(image)) {
    return t.skip(
      `Docker image not available: ${image} (pre-pull it, or set ENGINEJS_DOCKER_PULL=1)`,
    );
  }
  const password = 'enginejs';
  const dbName = 'enginejs_test';

  const { id, port } = startPostgresContainer(image, password, dbName);
  t.after(() => {
    try {
      execFileSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
    } catch {}
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-pg-it-'));
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
            title: { type: 'string', transforms: [{ name: 'trim' }] },
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
            origin: { type: 'string' },
            origin_chain: { type: 'string', multi: true },
            parent_event_id: { type: 'string' },
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

  const dbUrl = `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`;
  const engine = createEngine({
    app: { name: 'enginejs-it', env: 'test' },
    db: { url: dbUrl, dialect: 'postgres' },
    dsl: { schemaPath, fragments: { modelsDir, metaDir } },
    auth: {
      jwt: { accessSecret: 'x', accessTtl: '1h' },
      sessions: { enabled: false, refreshTtlDays: 30, refreshRotate: true },
    },
    acl: {},
    rls: { subjects: {}, policies: {} },
    workflows: { enabled: true },
  });

  await engine.init();
  const sequelize = engine.services.resolve<any>('db', { scope: 'singleton' });

  await waitFor(() => sequelize.authenticate(), 30_000);
  await sequelize.sync({ force: true });

  const app = createEngineExpressApp(engine, {
    defaultActor: { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {} },
  });

  const { server, url } = await listen(app);
  try {
    const res = await fetch(`${url}/api/post`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '  Hello  ' }),
    });
    const body = (await res.json()) as any;
    assert.equal(res.status, 201);
    assert.equal(body.success, true);
    assert.equal(body.data.title, 'Hello');

    const outbox = (engine.orm as any).models.workflow_events_outbox;
    const rows = await outbox.findAll({ raw: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].model, 'post');
    assert.equal(rows[0].action, 'create');
    assert.equal(rows[0].status, 'pending');
    assert.equal(rows[0].after?.id, 1);
    assert.equal(rows[0].after?.title, 'Hello');
  } finally {
    server.close();
    await sequelize.close();
  }
});

test('docker postgres: workflowRunner processes outbox and runs db.update step', async (t) => {
  if (!dockerAvailable()) return t.skip('Docker not available');

  const image = process.env.ENGINEJS_TEST_PG_IMAGE || 'postgres:16-alpine';
  if (!ensureDockerImage(image)) {
    return t.skip(
      `Docker image not available: ${image} (pre-pull it, or set ENGINEJS_DOCKER_PULL=1)`,
    );
  }

  const password = 'enginejs';
  const dbName = 'enginejs_test2';
  const { id, port } = startPostgresContainer(image, password, dbName);
  t.after(() => {
    try {
      execFileSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
    } catch {}
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-pg-it2-'));
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
            title: { type: 'string', transforms: [{ name: 'trim' }] },
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

  const engine = createEngine({
    app: { name: 'enginejs-it2', env: 'test' },
    db: { url: `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`, dialect: 'postgres' },
    dsl: { schemaPath, fragments: { modelsDir, metaDir } },
    auth: {
      jwt: { accessSecret: 'x', accessTtl: '1h' },
      sessions: { enabled: false, refreshTtlDays: 30, refreshRotate: true },
    },
    acl: {},
    rls: { subjects: {}, policies: {} },
    workflows: { enabled: true },
  });

  engine.registerPlugin({
    name: 'wf',
    registerWorkflows(registry: any) {
      registry.register('post-on-create', {
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
    defaultActor: { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {} },
  });

  const { server, url } = await listen(app);
  try {
    const res = await fetch(`${url}/api/post`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '  Hello  ' }),
    });
    assert.equal(res.status, 201);

    const runner = engine.services.resolve<any>('workflowRunner', { scope: 'singleton' });
    const r = await runner.runOnce({ claimLimit: 10 });
    assert.equal(r.claimed, 1);
    assert.equal(r.processed, 1);

    const post = (engine.orm as any).models.post;
    const row = await post.findOne({ where: { id: 1 }, raw: true });
    assert.equal(row.status, 'processed');

    const outbox = (engine.orm as any).models.workflow_events_outbox;
    const outRow = await outbox.findOne({ where: { model: 'post', action: 'create' }, raw: true });
    assert.equal(outRow.status, 'done');
  } finally {
    server.close();
    await sequelize.close();
  }
});

test('docker postgres: scheduler emits interval/datetime, runner actor modes, replayer requeues stale processing', async (t) => {
  if (!dockerAvailable()) return t.skip('Docker not available');

  const image = process.env.ENGINEJS_TEST_PG_IMAGE || 'postgres:16-alpine';
  if (!ensureDockerImage(image)) {
    return t.skip(
      `Docker image not available: ${image} (pre-pull it, or set ENGINEJS_DOCKER_PULL=1)`,
    );
  }

  const password = 'enginejs';
  const dbName = 'enginejs_test3';
  const { id, port } = startPostgresContainer(image, password, dbName);
  t.after(() => {
    try {
      execFileSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
    } catch {}
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-pg-it3-'));
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
            publish_at: { type: 'datetime' },
            customer_id: { type: 'int' },
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
            origin: { type: 'string' },
            origin_chain: { type: 'string', multi: true },
            parent_event_id: { type: 'string' },
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
    path.join(metaDir, 'workflow_scheduler_kv.json'),
    JSON.stringify(
      {
        workflow_scheduler_kv: {
          fields: {
            key: { type: 'string', primary: true, length: 255 },
            value: { type: 'string' },
          },
          access: { read: [], create: [], update: [], delete: [] },
        },
      },
      null,
      2,
    ),
  );

  const engine = createEngine({
    app: { name: 'enginejs-it3', env: 'test' },
    db: { url: `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`, dialect: 'postgres' },
    dsl: { schemaPath, fragments: { modelsDir, metaDir } },
    auth: {
      jwt: { accessSecret: 'x', accessTtl: '1h' },
      sessions: { enabled: false, refreshTtlDays: 30, refreshRotate: true },
    },
    acl: {},
    rls: { subjects: {}, policies: {} },
    workflows: { enabled: true },
  });

  const calls: Array<{ event: any; actor: any; args: any }> = [];

  engine.registerPlugin({
    name: 'wf',
    registerServices(registry: any) {
      registry.register('workflows.step.capture', 'singleton', () => async (ctx: any) => {
        calls.push({ event: ctx.event, actor: ctx.actor, args: ctx.args });
      });
    },
    registerWorkflows(registry: any) {
      registry.register('tick-5m', {
        actorMode: 'system',
        triggers: [{ type: 'interval', unit: 'minutes', value: 5 }],
        steps: [{ op: 'custom', name: 'capture', args: { kind: 'interval' } }],
      });
      registry.register('post-publish', {
        actorMode: 'impersonate',
        impersonate: { subject: 'customer', idFrom: 'after.customer_id' },
        triggers: [{ type: 'datetime', field: 'post.publish_at', direction: 'exact' }],
        steps: [{ op: 'custom', name: 'capture', args: { kind: 'datetime' } }],
      });
    },
  } as any);

  await engine.init();
  const sequelize = engine.services.resolve<any>('db', { scope: 'singleton' });

  await waitFor(() => sequelize.authenticate(), 30_000);
  await sequelize.sync({ force: true });

  const post = (engine.orm as any).models.post;
  const now = new Date();
  await post.create({ title: 'Hello', publish_at: new Date(now.getTime() - 60_000), customer_id: 123 });

  const scheduler = engine.services.resolve<any>('workflowScheduler', { scope: 'singleton' });
  const sched = await scheduler.runOnce({ now, lookbackMs: 10 * 60_000, lookaheadMs: 0 });
  assert.equal(sched.intervalEmitted, 1);
  assert.equal(sched.datetimeEmitted, 1);

  const runner = engine.services.resolve<any>('workflowRunner', { scope: 'singleton' });
  const r1 = await runner.runOnce({ claimLimit: 10 });
  assert.equal(r1.claimed, 2);
  assert.equal(r1.processed, 2);

  assert.equal(calls.length, 2);
  const byKind = new Map(calls.map((c) => [c.args.kind, c]));
  assert.equal(byKind.get('interval')?.event.action, 'interval');
  assert.deepEqual(byKind.get('interval')?.actor.roles, ['system']);
  assert.equal(byKind.get('datetime')?.event.action, 'datetime');
  assert.equal(byKind.get('datetime')?.actor.isAuthenticated, true);
  assert.equal(byKind.get('datetime')?.actor.subjects?.customer?.id, 123);

  const outbox = (engine.orm as any).models.workflow_events_outbox;
  const done = await outbox.findAll({ where: { status: 'done' }, raw: true });
  assert.equal(done.length, 2);

  // stale processing requeue
  const stale = await outbox.create({
    model: 'post',
    action: 'create',
    before: null,
    after: { id: 99 },
    changed_fields: [],
    status: 'processing',
    attempts: 0,
    next_run_at: null,
    updated_at: new Date(now.getTime() - 10 * 60_000),
  });

  const replayer = engine.services.resolve<any>('workflowReplayer', { scope: 'singleton' });
  const rep = await replayer.requeueStaleProcessing({ staleMs: 60_000, now });
  assert.equal(rep.requeued, 1);

  const r2 = await runner.runOnce({ claimLimit: 10 });
  assert.equal(r2.claimed, 1);
  assert.equal(r2.processed, 1);

  const staleRow = await outbox.findOne({ where: { id: stale.id }, raw: true });
  assert.equal(staleRow.status, 'done');

  await sequelize.close();
});
