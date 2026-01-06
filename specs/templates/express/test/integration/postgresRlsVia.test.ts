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

test('docker postgres: RLS via chain scopes list/read through joins', async (t) => {
  if (!dockerAvailable()) return t.skip('Docker not available');

  const image = process.env.ENGINEJS_TEST_PG_IMAGE || 'postgres:16-alpine';
  if (!ensureDockerImage(image)) {
    return t.skip(
      `Docker image not available: ${image} (pre-pull it, or set ENGINEJS_DOCKER_PULL=1)`,
    );
  }

  const password = 'enginejs';
  const dbName = 'enginejs_rls_via';
  const { id, port } = startPostgresContainer(image, password, dbName);
  t.after(() => {
    try {
      execFileSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
    } catch {}
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-rls-via-'));
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
    path.join(modelsDir, 'customer.json'),
    JSON.stringify(
      {
        customer: {
          fields: { id: { type: 'int', primary: true, autoIncrement: true }, name: { type: 'string' } },
          access: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'] },
        },
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(modelsDir, 'order.json'),
    JSON.stringify(
      {
        order: {
          fields: {
            id: { type: 'int', primary: true, autoIncrement: true },
            customer_id: { type: 'int', source: 'customer', sourceid: 'id' },
          },
          access: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'] },
        },
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(modelsDir, 'order_item.json'),
    JSON.stringify(
      {
        order_item: {
          fields: {
            id: { type: 'int', primary: true, autoIncrement: true },
            order_id: { type: 'int', source: 'order', sourceid: 'id' },
            name: { type: 'string' },
          },
          access: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'] },
        },
      },
      null,
      2,
    ),
  );

  const engine = createEngine({
    app: { name: 'enginejs-rls-via', env: 'test' },
    db: { url: `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`, dialect: 'postgres' },
    dsl: { schemaPath, fragments: { modelsDir, metaDir } },
    auth: { jwt: { accessSecret: 'x', accessTtl: '1h' } },
    acl: {},
    rls: {
      subjects: {},
      policies: {
        order_item: {
          list: {
            subject: 'customer',
            via: [
              { fromModel: 'order_item', fromField: 'order_id', toModel: 'order', toField: 'id' },
              { fromModel: 'order', fromField: 'customer_id', toModel: 'customer', toField: 'id' },
            ],
          } as any,
          read: {
            subject: 'customer',
            via: [
              { fromModel: 'order_item', fromField: 'order_id', toModel: 'order', toField: 'id' },
              { fromModel: 'order', fromField: 'customer_id', toModel: 'customer', toField: 'id' },
            ],
          } as any,
        },
      },
    },
  });

  await engine.init();
  const sequelize = engine.services.resolve<any>('db', { scope: 'singleton' });
  await waitFor(() => sequelize.authenticate(), 30_000);
  await sequelize.sync({ force: true });

  const Customer = (engine.orm as any).models.customer;
  const Order = (engine.orm as any).models.order;
  const OrderItem = (engine.orm as any).models.order_item;

  const c1 = await Customer.create({ name: 'C1' });
  const c2 = await Customer.create({ name: 'C2' });
  const o1 = await Order.create({ customer_id: c1.id });
  const o2 = await Order.create({ customer_id: c2.id });
  await OrderItem.create({ order_id: o1.id, name: 'only-mine' });
  await OrderItem.create({ order_id: o2.id, name: 'not-mine' });

  const app = createEngineExpressApp(engine, {
    defaultActor: {
      isAuthenticated: true,
      subjects: { customer: { type: 'customer', model: 'customer', id: c1.id } },
      roles: ['admin'],
      claims: {},
    },
  });
  const { server, url } = await listen(app);
  try {
    const listRes = await fetch(`${url}/api/order_item`);
    const listBody = (await listRes.json()) as any;
    assert.equal(listRes.status, 200);
    assert.equal(listBody.success, true);
    assert.equal(listBody.data.length, 1);
    assert.equal(listBody.data[0].name, 'only-mine');

    const id = listBody.data[0].id;
    const readRes = await fetch(`${url}/api/order_item/${id}`);
    const readBody = (await readRes.json()) as any;
    assert.equal(readRes.status, 200);
    assert.equal(readBody.data.name, 'only-mine');
  } finally {
    server.close();
    await sequelize.close();
  }
});
