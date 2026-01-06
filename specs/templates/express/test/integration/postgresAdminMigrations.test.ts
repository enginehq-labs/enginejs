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

test('docker postgres: /admin/migrations/* uses migrationRunner when configured (status -> up -> status)', async (t) => {
  if (!dockerAvailable()) return t.skip('Docker not available');

  const image = process.env.ENGINEJS_TEST_PG_IMAGE || 'postgres:16-alpine';
  if (!ensureDockerImage(image)) {
    return t.skip(
      `Docker image not available: ${image} (pre-pull it, or set ENGINEJS_DOCKER_PULL=1)`,
    );
  }

  const password = 'enginejs';
  const dbName = 'enginejs_admin_migrations';
  const { id, port } = startPostgresContainer(image, password, dbName);
  t.after(() => {
    try {
      execFileSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
    } catch {}
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-admin-migrations-'));
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

  const dbUrl = `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`;

  const engine = createEngine({
    app: { name: 'enginejs-admin-migrations', env: 'test' },
    db: { url: dbUrl, dialect: 'postgres' },
    dsl: { schemaPath, fragments: { modelsDir, metaDir } },
    auth: { jwt: { accessSecret: 'x', accessTtl: '1h' } },
    acl: {},
    rls: { subjects: {}, policies: {} },
    migrations: {
      tableName: 'engine_migrations',
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
    },
  });

  await engine.init();
  const sequelize = engine.services.resolve<any>('db', { scope: 'singleton' });
  await waitFor(() => sequelize.authenticate(), 30_000);

  const app = createEngineExpressApp(engine, {
    defaultActor: { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {} },
  });

  const { server, url } = await listen(app);
  try {
    const status1 = await fetch(`${url}/admin/migrations/status`);
    const s1 = (await status1.json()) as any;
    assert.equal(status1.status, 200);
    assert.equal(s1.success, true);
    assert.deepEqual(s1.data.executed, []);
    assert.deepEqual(s1.data.pending, ['0001_create_widget']);

    const up = await fetch(`${url}/admin/migrations/up`, { method: 'POST' });
    const upBody = (await up.json()) as any;
    assert.equal(up.status, 200);
    assert.equal(upBody.success, true);
    assert.deepEqual(upBody.data.applied, ['0001_create_widget']);

    const status2 = await fetch(`${url}/admin/migrations/status`);
    const s2 = (await status2.json()) as any;
    assert.equal(status2.status, 200);
    assert.equal(s2.success, true);
    assert.deepEqual(s2.data.executed, ['0001_create_widget']);
    assert.deepEqual(s2.data.pending, []);

    const qi = sequelize.getQueryInterface();
    const widget = await qi.describeTable('widget');
    assert.ok(widget.id);
  } finally {
    server.close();
    await sequelize.close();
  }
});

