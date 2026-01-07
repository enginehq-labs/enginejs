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

test('docker postgres: workflow managed via CRUD updates runtime behavior', async (t) => {
  if (!dockerAvailable()) return t.skip('Docker not available');

  const image = process.env.ENGINEJS_TEST_PG_IMAGE || 'postgres:16-alpine';
  if (!ensureDockerImage(image)) {
    return t.skip(`Docker image not available: ${image} (pre-pull it, or set ENGINEJS_DOCKER_PULL=1)`);
  }

  const password = 'enginejs';
  const dbName = 'enginejs_crud_workflows';
  const { id, port } = startPostgresContainer(image, password, dbName);
  t.after(() => {
    try {
      execFileSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
    } catch {}
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-crud-workflows-'));
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
    path.join(modelsDir, 'comment.json'),
    JSON.stringify(
      {
        comment: {
          fields: {
            id: { type: 'int', primary: true, autoIncrement: true },
            post_id: { type: 'int' },
            body: { type: 'string' },
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
            changed_fields: { type: 'jsonb' },
            origin: { type: 'string' },
            origin_chain: { type: 'jsonb' },
            parent_event_id: { type: 'string' },
            actor: { type: 'jsonb' },
            status: { type: 'string', default: 'pending' },
            attempts: { type: 'int', default: 0 },
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
    path.join(metaDir, 'workflow.json'),
    JSON.stringify(
      {
        workflow: {
          fields: {
            id: { type: 'int', primary: true, autoIncrement: true },
            slug: { type: 'string', required: true },
            name: { type: 'string', required: true },
            description: { type: 'text' },
            enabled: { type: 'boolean', default: true },
            spec: { type: 'jsonb', required: true, validate: [{ name: 'workflowSpec' }] },
          },
          indexes: { unique: [['slug']], many: [['name']], lower: [] },
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
    app: { name: 'enginejs-crud-workflows', env: 'test' },
    db: { url: `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`, dialect: 'postgres' },
    dsl: { fragments: { modelsDir, metaDir } },
    auth: { jwt: { accessSecret: 'x', accessTtl: '1h' } },
    acl: {},
    rls: { subjects: {}, policies: {} },
    workflows: { enabled: true, registry: 'db' },
  });

  await engine.init();
  const sequelize = engine.services.resolve<any>('db', { scope: 'singleton' });
  await waitFor(() => sequelize.authenticate(), 30_000);

  const app = createEngineExpressApp(engine, {
    defaultActor: { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {} },
  });

  const { server, url } = await listen(app);
  try {
    // Create tables first (required for DB workflows).
    const syncRes = await fetch(`${url}/admin/sync`, { method: 'POST' });
    assert.equal(syncRes.status, 200);

    // Create a workflow via generic CRUD; registry is updated on afterPersist.
    const createWfRes = await fetch(`${url}/api/workflow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'post-create-comment',
        name: 'Post Create Comment',
        description: 'Creates a comment when a post is created.',
        enabled: true,
        spec: {
          triggers: [{ type: 'model', model: 'post', actions: ['create'] }],
          steps: [
            {
              op: 'crud.create',
              model: 'comment',
              values: { post_id: { from: 'after.id' }, body: 'v1' },
              options: { runPipelines: false },
            },
          ],
        },
      }),
    });
    const createWfBody = (await createWfRes.json()) as any;
    assert.equal(createWfRes.status, 201);
    assert.equal(createWfBody.success, true);
    const workflowId = createWfBody.data.id;
    assert.equal(typeof workflowId === 'number' || typeof workflowId === 'string', true);

    // Clear the workflow model create event (workflows emit events for all models, including workflow itself).
    const runner = engine.services.resolve<any>('workflowRunner', { scope: 'singleton' });
    await runner.runOnce({ claimLimit: 10 });

    // Create a post -> outbox event -> runner executes workflow -> comment created with v1.
    const postRes1 = await fetch(`${url}/api/post`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'hello' }),
    });
    assert.equal(postRes1.status, 201);

    const ran1 = await runner.runOnce({ claimLimit: 10 });
    assert.equal(ran1.claimed, 1);

    const Comment = (engine.orm as any).models.comment;
    const comments1 = await Comment.findAll({ raw: true });
    assert.equal(comments1.length, 1);
    assert.equal(comments1[0].body, 'v1');

    // Update workflow spec to v2 via CRUD; registry is updated on afterPersist.
    const patchRes = await fetch(`${url}/api/workflow/${workflowId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        spec: {
          triggers: [{ type: 'model', model: 'post', actions: ['create'] }],
          steps: [
            {
              op: 'crud.create',
              model: 'comment',
              values: { post_id: { from: 'after.id' }, body: 'v2' },
              options: { runPipelines: false },
            },
          ],
        },
      }),
    });
    assert.equal(patchRes.status, 200);

    // Clear the workflow model update event so the next run only processes the post create.
    await runner.runOnce({ claimLimit: 10 });

    const postRes2 = await fetch(`${url}/api/post`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'hello2' }),
    });
    assert.equal(postRes2.status, 201);

    const ran2 = await runner.runOnce({ claimLimit: 10 });
    assert.equal(ran2.claimed, 1);

    const comments2 = await Comment.findAll({ raw: true, order: [['id', 'ASC']] });
    assert.equal(comments2.length, 2);
    assert.equal(comments2[1].body, 'v2');
  } finally {
    server.close();
    await sequelize.close();
  }
});
