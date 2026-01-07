import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { initEngineJsApp } from '../../src/cli.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'enginehq-init-'));
}

test('enginehq initEngineJsApp scaffolds required folders/files', () => {
  const root = tmpDir();
  const appDir = path.join(root, 'my-app');

  initEngineJsApp({ dir: appDir });

  for (const p of [
    'dsl',
    'dsl/models',
    'dsl/meta',
    'workflow',
    'pipeline',
    'pipeline/validators.ts',
    'pipeline/transforms.ts',
    'pipeline/ops.ts',
    'routes',
    'enginejs.config.ts',
    'package.json',
    'dsl/meta/dsl.json',
    'dsl/meta/workflow_events_outbox.json',
    'dsl/meta/workflow.json',
  ]) {
    assert.ok(fs.existsSync(path.join(appDir, p)), `missing ${p}`);
  }

  assert.equal(fs.existsSync(path.join(appDir, 'dsl', 'schema.json')), false, 'app should not vendor DSL schema file');

  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  assert.equal(pkg.main, './node_modules/enginehq/dist/runtime/app.js');
  assert.equal(pkg.dependencies.enginehq != null, true);
});

test('enginehq initEngineJsApp refuses non-empty dir unless --force', () => {
  const appDir = tmpDir();
  fs.writeFileSync(path.join(appDir, 'x.txt'), 'x');

  assert.throws(
    () => initEngineJsApp({ dir: appDir }),
    (e: any) => /not empty/i.test(String(e?.message || '')),
  );

  initEngineJsApp({ dir: appDir, force: true });
  assert.ok(fs.existsSync(path.join(appDir, 'enginejs.config.ts')));
});
