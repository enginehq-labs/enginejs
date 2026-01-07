import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { createEngine } from '../../src/engine/createEngine.js';

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

test('docker postgres: outbox retention maintenance archives and deletes terminal events', async (t) => {
  if (!dockerAvailable()) return t.skip('Docker not available');

  const image = process.env.ENGINEJS_TEST_PG_IMAGE || 'postgres:16-alpine';
  if (!ensureDockerImage(image)) {
    return t.skip(
      `Docker image not available: ${image} (pre-pull it, or set ENGINEJS_DOCKER_PULL=1)`,
    );
  }

  const password = 'enginejs';
  const dbName = 'enginejs_outbox_retention';
  const { id, port } = startPostgresContainer(image, password, dbName);
  t.after(() => {
    try {
      execFileSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
    } catch {}
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-pg-outbox-ret-'));
  const dslDir = path.join(root, 'dsl');
  const modelsDir = path.join(dslDir, 'models');
  const metaDir = path.join(dslDir, 'meta');
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.mkdirSync(metaDir, { recursive: true });

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
    app: { name: 'enginejs-outbox-ret', env: 'test' },
    db: { url: `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`, dialect: 'postgres' },
    dsl: { fragments: { modelsDir, metaDir } },
    auth: { jwt: { accessSecret: 'x', accessTtl: '1h' } },
    acl: {},
    rls: { subjects: {}, policies: {} },
    workflows: { enabled: true },
  });

  await engine.init();
  const sequelize = engine.services.resolve<any>('db', { scope: 'singleton' });
  await waitFor(() => sequelize.authenticate(), 30_000);
  await sequelize.sync({ force: true });

  const outbox = (engine.orm as any).models.workflow_events_outbox;
  const now = new Date();
  const old = new Date(now.getTime() - 10 * 86_400_000);
  const keep = await outbox.create({ model: 'x', action: 'create', before: null, after: null, changed_fields: [], status: 'done', attempts: 0, created_at: now });
  const oldDone = await outbox.create({ model: 'x', action: 'create', before: null, after: null, changed_fields: [], status: 'done', attempts: 0, created_at: old });
  const oldFailed = await outbox.create({ model: 'x', action: 'create', before: null, after: null, changed_fields: [], status: 'failed', attempts: 0, created_at: old });

  const maint = engine.services.resolve<any>('workflowOutboxMaintenance', { scope: 'singleton' });
  const r1 = await maint.runOnce({ mode: 'archive', retentionDays: 1, now });
  assert.equal(r1.archived, 2);

  const aDone = await outbox.findOne({ where: { id: oldDone.id }, raw: true });
  assert.equal(aDone.status, 'archived');
  const aFailed = await outbox.findOne({ where: { id: oldFailed.id }, raw: true });
  assert.equal(aFailed.status, 'archived');
  const kept = await outbox.findOne({ where: { id: keep.id }, raw: true });
  assert.equal(kept.status, 'done');

  const r2 = await maint.runOnce({ mode: 'delete', retentionDays: 1, now });
  assert.equal(r2.deleted, 2);

  const gone = await outbox.findAll({ where: { status: 'archived' }, raw: true });
  assert.equal(gone.length, 0);

  await sequelize.close();
});
