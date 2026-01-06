import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDurationToSeconds, signJwtHS256, verifyJwtHS256 } from '../../src/jwt.js';

test('parseDurationToSeconds parses s/m/h/d', () => {
  assert.equal(parseDurationToSeconds('10s'), 10);
  assert.equal(parseDurationToSeconds('2m'), 120);
  assert.equal(parseDurationToSeconds('1h'), 3600);
  assert.equal(parseDurationToSeconds('3d'), 259200);
});

test('signJwtHS256/verifyJwtHS256 round-trips payload', () => {
  const token = signJwtHS256({ foo: 'bar' } as any, 'secret', 60);
  const p = verifyJwtHS256<any>(token, 'secret');
  assert.equal(p.foo, 'bar');
  assert.ok(typeof p.iat === 'number');
  assert.ok(typeof p.exp === 'number');
});

