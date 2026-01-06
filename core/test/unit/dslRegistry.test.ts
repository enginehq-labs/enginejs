import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  compileDslFromFs,
  DslConstraintError,
  DslLoadError,
  DslValidationError,
} from '../../src/dsl/index.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'enginejs-dsl-'));
}

function writeJson(p: string, v: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

test('compileDslFromFs: loads fragments deterministically and last-wins on duplicate keys', () => {
  const root = tmpDir();
  const modelsDir = path.join(root, 'dsl', 'models');
  const metaDir = path.join(root, 'dsl', 'meta');

  writeJson(path.join(modelsDir, '02-customer.json'), {
    customer: { fields: { email: { type: 'string' }, full_name: { type: 'string' } } },
  });
  writeJson(path.join(modelsDir, '01-customer.json'), {
    customer: { fields: { email: { type: 'string' }, full_name: { type: 'string', label: 'Old' } } },
  });
  writeJson(path.join(metaDir, 'role.json'), {
    role: { fields: { id: { type: 'int' }, role_name: { type: 'string' } } },
  });

  const schemaPath = path.join(root, 'schema.json');
  writeJson(schemaPath, { type: 'object' });

  const { dsl, sources } = compileDslFromFs({ modelsDir, metaDir }, schemaPath);

  assert.ok(dsl.customer);
  assert.ok(dsl.role);
  assert.equal(
    (dsl as any).customer.fields.full_name.label,
    undefined,
    '01-customer should be overridden by 02-customer',
  );
  assert.ok(sources.length >= 2);
});

test('compileDslFromFs: augments system fields', () => {
  const root = tmpDir();
  const modelsDir = path.join(root, 'dsl', 'models');
  const metaDir = path.join(root, 'dsl', 'meta');
  writeJson(path.join(modelsDir, 'customer.json'), { customer: { fields: { email: { type: 'string' } } } });
  const schemaPath = path.join(root, 'schema.json');
  writeJson(schemaPath, { type: 'object' });

  const { dsl } = compileDslFromFs({ modelsDir, metaDir }, schemaPath);
  const f = (dsl as any).customer.fields;
  for (const k of ['created_at', 'updated_at', 'deleted', 'deleted_at', 'archived', 'archived_at', 'auto_name']) {
    assert.ok(f[k], `missing ${k}`);
  }
});

test('compileDslFromFs: errors when no fragments and monolith disabled', () => {
  const root = tmpDir();
  const modelsDir = path.join(root, 'dsl', 'models');
  const metaDir = path.join(root, 'dsl', 'meta');
  const schemaPath = path.join(root, 'schema.json');
  writeJson(schemaPath, { type: 'object' });

  assert.throws(
    () => compileDslFromFs({ modelsDir, metaDir }, schemaPath),
    (e: any) => e instanceof DslLoadError && /No DSL fragments/i.test(e.message),
  );
});

test('compileDslFromFs: loads monolith when enabled and fragments absent', () => {
  const root = tmpDir();
  const modelsDir = path.join(root, 'dsl', 'models');
  const metaDir = path.join(root, 'dsl', 'meta');
  const monolithPath = path.join(root, 'dsl.json');
  writeJson(monolithPath, { customer: { fields: { email: { type: 'string' } } } });
  const schemaPath = path.join(root, 'schema.json');
  writeJson(schemaPath, { type: 'object' });

  const { dsl } = compileDslFromFs(
    { modelsDir, metaDir, allowMonolithDslJson: true, monolithPath },
    schemaPath,
  );
  assert.ok((dsl as any).customer);
});

test('compileDslFromFs: throws DslValidationError when schema rejects DSL', () => {
  const root = tmpDir();
  const modelsDir = path.join(root, 'dsl', 'models');
  const metaDir = path.join(root, 'dsl', 'meta');
  writeJson(path.join(modelsDir, 'customer.json'), { customer: { fields: { email: { type: 'string' } } } });
  const schemaPath = path.join(root, 'schema.json');
  writeJson(schemaPath, { type: 'object', required: ['missing'] });

  assert.throws(
    () => compileDslFromFs({ modelsDir, metaDir }, schemaPath),
    (e: any) => e instanceof DslValidationError && Array.isArray(e.ajvErrors),
  );
});

test('compileDslFromFs: enforces virtual field constraints', () => {
  const root = tmpDir();
  const modelsDir = path.join(root, 'dsl', 'models');
  const metaDir = path.join(root, 'dsl', 'meta');
  writeJson(path.join(modelsDir, 'customer.json'), {
    customer: {
      fields: {
        email: { type: 'string' },
        v: { type: 'string', save: false, canfind: true },
      },
    },
  });
  const schemaPath = path.join(root, 'schema.json');
  writeJson(schemaPath, { type: 'object' });

  assert.throws(
    () => compileDslFromFs({ modelsDir, metaDir }, schemaPath),
    (e: any) => e instanceof DslConstraintError && /Virtual field cannot define canfind/i.test(e.message),
  );
});

