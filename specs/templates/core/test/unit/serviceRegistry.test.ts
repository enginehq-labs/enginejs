import test from 'node:test';
import assert from 'node:assert/strict';

import { DefaultServiceRegistry } from '../../src/services/DefaultServiceRegistry.js';

test('DefaultServiceRegistry: singleton service resolves once', () => {
  const reg = new DefaultServiceRegistry({ hello: 'world' });

  let calls = 0;
  reg.register('x', 'singleton', () => {
    calls++;
    return { ok: true };
  });

  const a = reg.resolve<{ ok: boolean }>('x', { scope: 'request' });
  const b = reg.resolve<{ ok: boolean }>('x', { scope: 'request' });

  assert.deepEqual(a, { ok: true });
  assert.deepEqual(b, { ok: true });
  assert.equal(calls, 1);
});

test('DefaultServiceRegistry: rejects duplicate registration', () => {
  const reg = new DefaultServiceRegistry();
  reg.register('x', 'singleton', () => 1);
  assert.throws(() => reg.register('x', 'singleton', () => 2), /already registered/i);
});

test('DefaultServiceRegistry: throws on unknown service', () => {
  const reg = new DefaultServiceRegistry();
  assert.throws(() => reg.resolve('missing', { scope: 'request' }), /Unknown service/i);
});

