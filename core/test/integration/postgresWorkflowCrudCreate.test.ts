import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createEngine } from '../../src/engine/createEngine.js';
import { dockerAvailable, ensureDockerImage, getSharedPgPort, ensurePgDatabase, waitFor } from './helpers/dockerPostgres.js';



test('docker postgres: workflow can run crud.create step (no HTTP) to create a related row', async (t) => {
  if (!dockerAvailable()) return t.skip('Docker not available');

  const image = process.env.ENGINEJS_TEST_PG_IMAGE || 'postgres:16-alpine';
  if (!ensureDockerImage(image)) {
    return t.skip(`Docker image not available: ${image} (pre-pull it, or set ENGINEJS_DOCKER_PULL=1)`);
  }

  const password = 'enginejs';
  const dbName = 'enginejs_wf_crud_create';
  const port = getSharedPgPort(image, password);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-wf-crud-create-'));
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
            changed_fields: { type: 'string', multi: true },
            actor: { type: 'jsonb' },
            origin: { type: 'string' },
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
    app: { name: 'enginejs-wf-crud-create', env: 'test' },
    db: { url: `postgres://postgres:${password}@127.0.0.1:${port}/${dbName}`, dialect: 'postgres' },
    dsl: { fragments: { modelsDir, metaDir } },
    auth: { jwt: { accessSecret: 'x', accessTtl: '1h' } },
    acl: {},
    rls: { subjects: {}, policies: {} },
    workflows: { enabled: true },
  });

  engine.registerPlugin({
    name: 'wf',
    registerWorkflows(registry: any) {
      registry.register('comment-on-post-create', {
        actorMode: 'inherit',
        triggers: [{ type: 'model', model: 'post', actions: ['create'] }],
        steps: [
          {
            op: 'crud.create',
            model: 'comment',
            values: {
              post_id: { from: 'after.id' },
              body: 'auto',
            },
            options: { runPipelines: false },
          },
        ],
      });
    },
  } as any);

  ensurePgDatabase(dbName);
  await engine.init();

  const sequelize = engine.services.resolve<any>('db', { scope: 'singleton' });
  await waitFor(() => sequelize.authenticate(), 30_000);

  await sequelize.sync({ force: true });

  const Post = (engine.orm as any).models.post;
  const Comment = (engine.orm as any).models.comment;
  const outbox = (engine.orm as any).models.workflow_events_outbox;

  const created = await Post.create({ title: 'hello' });
  const after = (created as any)?.get ? (created as any).get({ plain: true }) : created;

  const wfEngine = engine.services.resolve<any>('workflowEngine', { scope: 'singleton' });
  await wfEngine.emitModelEvent({
    model: 'post',
    action: 'create',
    before: null,
    after,
    changedFields: ['title'],
    actor: { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {} },
    origin: 'test',
  });

  const runner = engine.services.resolve<any>('workflowRunner', { scope: 'singleton' });
  const ran = await runner.runOnce({ claimLimit: 10 });
  assert.equal(ran.claimed, 1);

  const comments = await Comment.findAll({ raw: true });
  assert.equal(comments.length, 1);
  assert.equal(comments[0].post_id, after.id);
  assert.equal(comments[0].body, 'auto');

  const events = await outbox.findAll({ raw: true });
  assert.equal(events.length, 2);
  const postEvent = events.find((e: any) => e.model === 'post');
  assert.equal(postEvent?.status, 'done');
  const commentEvent = events.find((e: any) => e.model === 'comment');
  assert.equal(commentEvent?.status, 'pending');

  await sequelize.close();
});
