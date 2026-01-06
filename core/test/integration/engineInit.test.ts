import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createEngine } from '../../src/engine/createEngine.js';
import type { EnginePlugin } from '../../src/plugins/types.js';

test('createEngine: registers built-in registries and runs plugin hooks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-engine-init-'));
  const dslDir = path.join(root, 'dsl');
  const modelsDir = path.join(dslDir, 'models');
  const metaDir = path.join(dslDir, 'meta');
  fs.mkdirSync(modelsDir, { recursive: true });
  fs.mkdirSync(metaDir, { recursive: true });

  fs.writeFileSync(
    path.join(modelsDir, 'customer.json'),
    JSON.stringify(
      {
        customer: {
          fields: { id: { type: 'int', primary: true, autoIncrement: true }, email: { type: 'string' } },
          access: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'] },
        },
      },
      null,
      2,
    ),
  );

  const engine = createEngine({
    app: { name: 't', env: 'test' },
    db: { url: 'postgres://example.invalid/db' },
    dsl: { fragments: { modelsDir, metaDir } },
    auth: { jwt: { accessSecret: 'x', accessTtl: '1h' }, sessions: { enabled: false, refreshTtlDays: 30, refreshRotate: true } },
    acl: {},
    rls: { subjects: {}, policies: {} },
  });

  const calls: string[] = [];
  let onDsl: any = null;

  const plugin: EnginePlugin = {
    name: 'p',
    registerServices(registry) {
      calls.push('registerServices');
      registry.register('p.service', 'singleton', () => ({ ok: true }));
    },
    registerPipelines(pipelines) {
      calls.push('registerPipelines');
      pipelines.register('customer', { create: { beforeValidate: [{ op: 'trim', field: 'email' }] } });
    },
    registerWorkflows(workflows) {
      calls.push('registerWorkflows');
      workflows.register('wf1', { triggers: [], steps: [] });
    },
    onDslLoaded(dsl) {
      calls.push('onDslLoaded');
      onDsl = dsl;
    },
    onModelsReady() {
      calls.push('onModelsReady');
    },
  };

  engine.registerPlugin(plugin);
  await engine.init();

  const pipelines = engine.services.resolve<any>('pipelines', { scope: 'singleton' });
  const workflows = engine.services.resolve<any>('workflows', { scope: 'singleton' });
  const pService = engine.services.resolve<any>('p.service', { scope: 'singleton' });

  assert.equal(pService.ok, true);
  assert.ok(pipelines.get('customer'));
  assert.ok(workflows.get('wf1'));
  assert.ok(onDsl?.customer);
  assert.ok(engine.dsl?.customer);
  assert.ok(engine.orm?.models?.customer);

  assert.deepEqual(calls, [
    'registerServices',
    'registerPipelines',
    'registerWorkflows',
    'onDslLoaded',
    'onModelsReady',
  ]);
});
