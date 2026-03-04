import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createEngine, safeSync, MigrationRunner } from '../../src/index.js';
import { dockerAvailable, ensureDockerImage, getSharedPgPort, ensurePgDatabase, waitFor } from './helpers/dockerPostgres.js';



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
  const port = getSharedPgPort(image, password);

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

  ensurePgDatabase(dbName);
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
