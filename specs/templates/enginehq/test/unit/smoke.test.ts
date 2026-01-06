import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from '../../src/index.js';

test('enginehq exports core public API', () => {
  assert.equal(typeof createEngine, 'function');
});

