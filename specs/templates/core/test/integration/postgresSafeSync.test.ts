import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { createEngine, safeSync, MigrationRunner } from '../../src/index.js';

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

test('docker postgres: safeSync creates tables + widens (varchar->text) and blocks narrowing via snapshot; MigrationRunner applies migration', async (t) => {
  if (!dockerAvailable()) return t.skip('Docker not available');

  const image = process.env.ENGINEJS_TEST_PG_IMAGE || 'postgres:16-alpine';
  if (!ensureDockerImage(image)) {
    return t.skip(
      `Docker image not available: ${image} (pre-pull it, or set ENGINEJS_DOCKER_PULL=1)`,
    );
  }

  const password = 'enginejs';
  const dbName = 'enginejs_sync_test';
  const { id, port } = startPostgresContainer(image, password, dbName);
  t.after(() => {
    try {
      execFileSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
    } catch {}
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-pg-sync-'));
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
          auto_name: ['title'],
          fields: {
            id: { type: 'int', primary: true, autoIncrement: true },
            title: { type: 'string', length: 20 },
          },
          indexes: { unique: [], many: [['title']], lower: [] },
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
          access: { read: [], create: [], update: [], delete: [] },
        },
      },
      null,
      2,
    ),
  );

  const engine = createEngine({
    app: { name: 'enginejs-sync-it', env: 'test' },
    db: { url: `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`, dialect: 'postgres' },
    dsl: { fragments: { modelsDir, metaDir } },
    auth: { jwt: { accessSecret: 'x', accessTtl: '1h' } },
    acl: {},
    rls: { subjects: {}, policies: {} },
  });

  await engine.init();
  const sequelize = engine.services.resolve<any>('db', { scope: 'singleton' });
  await waitFor(() => sequelize.authenticate(), 30_000);

  const report1 = await safeSync({ sequelize, orm: engine.orm!, dsl: engine.dsl! as any, snapshotModelKey: 'dsl' });
  assert.equal(report1.snapshotWritten, true);

  const qi = sequelize.getQueryInterface();
  const postDesc1 = await qi.describeTable('post');
  const t1 = String(postDesc1.title.type).toLowerCase();
  assert.ok(t1.includes('varchar') || t1.includes('character varying'));

  // insert row (non-destructive sync)
  const post = (engine.orm as any).models.post;
  await post.create({ title: 'Hello' });

  // widen title to text
  fs.writeFileSync(
    path.join(modelsDir, 'post.json'),
    JSON.stringify(
      {
        post: {
          auto_name: ['title'],
          fields: {
            id: { type: 'int', primary: true, autoIncrement: true },
            title: { type: 'text' },
          },
          indexes: { unique: [], many: [['title']], lower: [] },
          access: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'] },
        },
      },
      null,
      2,
    ),
  );

  const engine2 = createEngine({
    app: { name: 'enginejs-sync-it', env: 'test' },
    db: { url: `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`, dialect: 'postgres' },
    dsl: { fragments: { modelsDir, metaDir } },
    auth: { jwt: { accessSecret: 'x', accessTtl: '1h' } },
    acl: {},
    rls: { subjects: {}, policies: {} },
  });
  await engine2.init();

  const report2 = await safeSync({
    sequelize,
    orm: engine2.orm!,
    dsl: engine2.dsl! as any,
    snapshotModelKey: 'dsl',
  });
  assert.ok(report2.widenedColumns.some((c) => c.table === 'post' && c.column === 'title'));

  const postDesc2 = await qi.describeTable('post');
  assert.ok(postDesc2.title.type.toLowerCase().includes('text'));

  // narrowing should be blocked because snapshot exists (text -> string)
  fs.writeFileSync(
    path.join(modelsDir, 'post.json'),
    JSON.stringify(
      {
        post: {
          auto_name: ['title'],
          fields: {
            id: { type: 'int', primary: true, autoIncrement: true },
            title: { type: 'string', length: 10 },
          },
          indexes: { unique: [], many: [['title']], lower: [] },
          access: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'] },
        },
      },
      null,
      2,
    ),
  );
  const engine3 = createEngine({
    app: { name: 'enginejs-sync-it', env: 'test' },
    db: { url: `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`, dialect: 'postgres' },
    dsl: { fragments: { modelsDir, metaDir } },
    auth: { jwt: { accessSecret: 'x', accessTtl: '1h' } },
    acl: {},
    rls: { subjects: {}, policies: {} },
  });
  await engine3.init();
  await assert.rejects(
    () => safeSync({ sequelize, orm: engine3.orm!, dsl: engine3.dsl! as any, snapshotModelKey: 'dsl' }),
    /narrowing/i,
  );

  // migrations runner sanity (same DB)
  const runner = new MigrationRunner({
    sequelize,
    migrations: [
      {
        id: '0001_create_widget',
        async up(ctx) {
          await ctx.sequelize.query(
            'CREATE TABLE IF NOT EXISTS widget (id SERIAL PRIMARY KEY, name VARCHAR(50) NOT NULL)',
          );
        },
      },
    ],
  });
  const st0 = await runner.status();
  assert.ok(st0.pending.includes('0001_create_widget'));
  const up = await runner.up();
  assert.deepEqual(up.applied, ['0001_create_widget']);
  const st1 = await runner.status();
  assert.ok(st1.executed.includes('0001_create_widget'));

  await sequelize.close();
});
