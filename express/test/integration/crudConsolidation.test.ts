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
  return new Promise<{ server: http.Server; url: string; close: () => void }>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('No address'));
      resolve({
        server,
        url: `http://${addr.address}:${addr.port}`,
        close: () => {
          if ('closeAllConnections' in server) {
            (server as any).closeAllConnections();
          }
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

test('docker postgres: crud consolidation features (includeDepth, complex filters)', async (t) => {
  if (!dockerAvailable()) return t.skip('Docker not available');

  const image = process.env.ENGINEJS_TEST_PG_IMAGE || 'postgres:16-alpine';
  if (!ensureDockerImage(image)) {
    return t.skip(`Docker image not available: ${image} (pre-pull it, or set ENGINEJS_DOCKER_PULL=1)`);
  }

  const password = 'enginejs';
  const dbName = 'enginejs_crud_consolidation';
  const { id, port } = startPostgresContainer(image, password, dbName);
  t.after(() => {
    try {
      execFileSync('docker', ['rm', '-f', id], { stdio: 'ignore' });
    } catch {}
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-crud-consolidation-'));
  const dslDir = path.join(root, 'dsl');
  const modelsDir = path.join(dslDir, 'models');
  const metaDir = path.join(dslDir, 'meta');
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.mkdirSync(metaDir, { recursive: true });

  fs.writeFileSync(
    path.join(modelsDir, 'company.json'),
    JSON.stringify(
      {
        company: {
          fields: { id: { type: 'int', primary: true, autoIncrement: true }, name: { type: 'string' } },
          access: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'] },
        },
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(modelsDir, 'role.json'),
    JSON.stringify(
      {
        role: {
          fields: { id: { type: 'int', primary: true, autoIncrement: true }, title: { type: 'string' } },
          access: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'] },
        },
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(modelsDir, 'user.json'),
    JSON.stringify(
      {
        user: {
          fields: {
            id: { type: 'int', primary: true, autoIncrement: true },
            company_id: { type: 'int', source: 'company', sourceid: 'id' },
            name: { type: 'string' },
            status: { type: 'string' },
            roles: { type: 'int', multi: true, source: 'role', sourceid: 'id' },
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
    app: { name: 'enginejs-crud-consolidation', env: 'test' },
    db: { url: `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`, dialect: 'postgres', logging: console.log },
    dsl: { fragments: { modelsDir, metaDir } },
    auth: { jwt: { accessSecret: 'x', accessTtl: '1h' } },
    acl: {},
    rls: { subjects: {}, policies: {} },
    workflows: { enabled: false },
  });

  await engine.init();
  const sequelize = engine.services.resolve<any>('db', { scope: 'singleton' });
  await waitFor(() => sequelize.authenticate(), 30_000);

  const app = await createEngineExpressApp(engine, {
    defaultActor: { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {} },
  });

  const { server, url, close } = await listen(app);
  try {
    const syncRes = await fetch(`${url}/admin/sync`, { method: 'POST' });
    assert.equal(syncRes.status, 200, 'Sync failed');

    const companyRes = await fetch(`${url}/api/crud/company`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acme Corp' }),
    });
    const companyBody = await companyRes.json() as any;
    if (!companyBody.success) console.error("Company create failed:", companyBody);
    const company = companyBody.data;

    const role1Res = await fetch(`${url}/api/crud/role`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Admin' }),
    });
    const role1 = (await role1Res.json() as any).data;

    const role2Res = await fetch(`${url}/api/crud/role`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'User' }),
    });
    const role2 = (await role2Res.json() as any).data;

    const user1Res = await fetch(`${url}/api/crud/user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company_id: company.id, name: 'Alice', status: 'active', roles: [role1.id, role2.id] }),
    });
    const user1 = (await user1Res.json() as any).data;

    const user2Res = await fetch(`${url}/api/crud/user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company_id: company.id, name: 'Bob', status: 'inactive', roles: [role2.id] }),
    });
    const user2 = (await user2Res.json() as any).data;

    // Test includeDepth=1
    const getRes = await fetch(`${url}/api/crud/user/${user1.id}?includeDepth=1`);
    const getBody = (await getRes.json()) as any;
    assert.equal(getBody.success, true);
    console.log("GET BODY DATA:", getBody.data);
    assert.equal(getBody.data.company.name, 'Acme Corp');
    assert.equal(getBody.data.roles.length, 2);
    // order of junction returns is not strictly guaranteed out-of-the-box by sequelize unless defined, so check names broadly
    const roleTitles = getBody.data.roles.map((r: any) => r.title);
    assert.ok(roleTitles.includes('Admin'));
    assert.ok(roleTitles.includes('User'));

    const listRes = await fetch(`${url}/api/crud/user?includeDepth=1`);
    const listBody = (await listRes.json()) as any;
    assert.equal(listBody.success, true);
    assert.equal(listBody.data.length, 2);
    assert.equal(listBody.data[0].company?.name, 'Acme Corp');

    // Test complex filters: same field comma separates as OR
    const filter = 'name:=Alice,name:=Bob';
    const filterRes = await fetch(`${url}/api/crud/user?filters=${encodeURIComponent(filter)}`);
    const filterBody = (await filterRes.json()) as any;
    assert.equal(filterBody.success, true);
    assert.equal(filterBody.data.length, 2); // Both Alice and Bob match

    // Different fields combine as AND
    const filter2 = 'status:=inactive,company_id:=1';
    const filterRes2 = await fetch(`${url}/api/crud/user?filters=${encodeURIComponent(filter2)}`);
    const filterBody2 = (await filterRes2.json()) as any;
    assert.equal(filterBody2.success, true);
    assert.equal(filterBody2.data.length, 1);
    assert.equal(filterBody2.data[0].name, 'Bob');
  } finally {
    close();
    await sequelize.close();
  }
});
