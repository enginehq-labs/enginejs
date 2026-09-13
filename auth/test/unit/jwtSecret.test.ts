import test from 'node:test';
import assert from 'node:assert/strict';

import { assertJwtSecret } from '../../src/jwt.js';

test('assertJwtSecret: a secret of 32 characters passes', () => {
  assert.doesNotThrow(() => assertJwtSecret('x'.repeat(32)));
});

test('assertJwtSecret: an empty, short or missing secret throws', () => {
  for (const secret of ['', 'x'.repeat(31), undefined, null, 32]) {
    assert.throws(() => assertJwtSecret(secret), /auth\.jwt\.accessSecret must be at least 32 characters/, `secret: ${String(secret)}`);
  }
});
