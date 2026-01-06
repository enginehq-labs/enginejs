import test from 'node:test';
import assert from 'node:assert/strict';

import type { Actor } from '../../src/actors/types.js';
import { AclEngine } from '../../src/acl/engine.js';

const actor: Actor = { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {} };

test('AclEngine: denies by default when access is missing', () => {
  const acl = new AclEngine();
  const res = acl.can({ actor, modelKey: 'x', modelSpec: { fields: {} } as any, action: 'read' });
  assert.equal(res.allow, false);
});

test('AclEngine: allows when actor role is in access list', () => {
  const acl = new AclEngine();
  const res = acl.can({
    actor,
    modelKey: 'x',
    modelSpec: { fields: {}, access: { read: ['admin'] } } as any,
    action: 'read',
  });
  assert.deepEqual(res, { allow: true });
});

test('AclEngine: allows wildcard *', () => {
  const acl = new AclEngine();
  const res = acl.can({
    actor: { ...actor, roles: [] },
    modelKey: 'x',
    modelSpec: { fields: {}, access: { read: ['*'] } } as any,
    action: 'read',
  });
  assert.deepEqual(res, { allow: true });
});

