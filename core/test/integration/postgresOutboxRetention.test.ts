import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createEngine } from '../../src/engine/createEngine.js';
import { dockerAvailable, ensureDockerImage, getSharedPgPort, ensurePgDatabase, waitFor } from './helpers/dockerPostgres.js';



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
  const port = getSharedPgPort(image, password);

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

  ensurePgDatabase(dbName);
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
