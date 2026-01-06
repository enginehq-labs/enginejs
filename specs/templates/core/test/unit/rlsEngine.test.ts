import test from 'node:test';
import assert from 'node:assert/strict';

import type { Actor } from '../../src/actors/types.js';
import { RlsEngine } from '../../src/rls/engine.js';

const baseActor: Actor = {
  isAuthenticated: true,
  subjects: {},
  roles: [],
  claims: {},
};

test('RlsEngine: unscoped when no policy exists for model/action', () => {
  const eng = new RlsEngine({ subjects: {}, policies: {} });
  const res = eng.scope({ actor: baseActor, modelKey: 'x', action: 'list' });
  assert.deepEqual(res, { kind: 'unscoped', allow: true, where: null });
});

test('RlsEngine: deny when rule references missing subject', () => {
  const eng = new RlsEngine({
    subjects: {},
    policies: {
      customer_daily_task: { list: { subject: 'customer', field: 'customer_id' } as any },
    },
  });
  const res = eng.scope({ actor: baseActor, modelKey: 'customer_daily_task', action: 'list' });
  assert.equal(res.allow, false);
  assert.equal(res.kind, 'denied');
});

test('RlsEngine: direct FK rule produces eq where', () => {
  const actor: Actor = {
    ...baseActor,
    subjects: { customer: { type: 'customer', model: 'customer', id: 123 } },
  };
  const eng = new RlsEngine({
    subjects: {},
    policies: {
      customer_daily_task: { list: { subject: 'customer', field: 'customer_id' } as any },
    },
  });
  const res = eng.scope({ actor, modelKey: 'customer_daily_task', action: 'list' });
  assert.equal(res.allow, true);
  assert.equal(res.kind, 'scoped');
  assert.deepEqual((res as any).where, { eq: { field: 'customer_id', value: 123 } });
});

test('RlsEngine: anyOf combines matches and ignores missing-subject branches', () => {
  const actor: Actor = {
    ...baseActor,
    subjects: { customer: { type: 'customer', model: 'customer', id: 7 } },
  };
  const eng = new RlsEngine({
    subjects: {},
    policies: {
      x: {
        list: {
          anyOf: [
            { subject: 'customer', field: 'customer_id' },
            { subject: 'user', field: 'user_id' },
          ],
        } as any,
      },
    },
  });
  const res = eng.scope({ actor, modelKey: 'x', action: 'list' });
  assert.equal(res.allow, true);
  assert.equal(res.kind, 'scoped');
  assert.deepEqual((res as any).where, { eq: { field: 'customer_id', value: 7 } });
});

test('RlsEngine: allOf requires all branches to match', () => {
  const actor: Actor = {
    ...baseActor,
    subjects: {
      customer: { type: 'customer', model: 'customer', id: 7 },
      user: { type: 'user', model: 'user', id: 9 },
    },
  };
  const eng = new RlsEngine({
    subjects: {},
    policies: {
      x: {
        list: {
          allOf: [
            { subject: 'customer', field: 'customer_id' },
            { subject: 'user', field: 'user_id' },
          ],
        } as any,
      },
    },
  });
  const res = eng.scope({ actor, modelKey: 'x', action: 'list' });
  assert.equal(res.allow, true);
  assert.equal(res.kind, 'scoped');
  assert.deepEqual((res as any).where, {
    and: [
      { eq: { field: 'customer_id', value: 7 } },
      { eq: { field: 'user_id', value: 9 } },
    ],
  });
});

test('RlsEngine: bypass by role', () => {
  const actor: Actor = { ...baseActor, roles: ['super_admin'] };
  const eng = new RlsEngine({
    subjects: {},
    bypass: { roles: ['super_admin'] },
    policies: { x: { list: { subject: 'customer', field: 'customer_id' } as any } },
  });
  const res = eng.scope({ actor, modelKey: 'x', action: 'list' });
  assert.deepEqual(res, { kind: 'bypass', allow: true, where: null });
});

test('RlsEngine: writeGuard enforce mode produces enforced fields', () => {
  const actor: Actor = {
    ...baseActor,
    subjects: { customer: { type: 'customer', model: 'customer', id: 55 } },
  };
  const eng = new RlsEngine({
    subjects: {},
    policies: {
      customer_daily_task: {
        create: { subject: 'customer', field: 'customer_id', writeMode: 'enforce' } as any,
      },
    },
  });
  const res = eng.writeGuard({ actor, modelKey: 'customer_daily_task', action: 'create' });
  assert.equal(res.allow, true);
  assert.equal(res.kind, 'scoped');
  assert.equal((res as any).mode, 'enforce');
  assert.deepEqual((res as any).enforced, { customer_id: 55 });
});

test('RlsEngine: writeGuard validate mode provides enforced values and validate fields', () => {
  const actor: Actor = {
    ...baseActor,
    subjects: { customer: { type: 'customer', model: 'customer', id: 55 } },
  };
  const eng = new RlsEngine({
    subjects: {},
    policies: {
      customer_daily_task: {
        create: { subject: 'customer', field: 'customer_id', writeMode: 'validate' } as any,
      },
    },
  });
  const res = eng.writeGuard({ actor, modelKey: 'customer_daily_task', action: 'create' });
  assert.equal(res.allow, true);
  assert.equal(res.kind, 'scoped');
  assert.equal((res as any).mode, 'validate');
  assert.deepEqual((res as any).enforced, { customer_id: 55 });
  assert.deepEqual((res as any).validateFields, ['customer_id']);
});
