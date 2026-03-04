import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPasswordHash } from '../../src/password.js';

describe('password', () => {
  it('hashPassword returns a PBKDF2 string', () => {
    const h = hashPassword('secr3t');
    assert.ok(h.startsWith('pbkdf2:sha256:'), `unexpected format: ${h}`);
    const parts = h.split(':');
    assert.strictEqual(parts.length, 5);
  });

  it('verifyPasswordHash returns true for a matching password', () => {
    const plain = 'my-password-123';
    const hash  = hashPassword(plain);
    assert.ok(verifyPasswordHash(plain, hash));
  });

  it('verifyPasswordHash returns false for wrong password', () => {
    const hash = hashPassword('correct');
    assert.strictEqual(verifyPasswordHash('wrong', hash), false);
  });

  it('verifyPasswordHash returns false for garbage input', () => {
    assert.strictEqual(verifyPasswordHash('x', ''), false);
    assert.strictEqual(verifyPasswordHash('x', 'not-a-hash'), false);
    assert.strictEqual(verifyPasswordHash('x', 'pbkdf2:sha256:badformat'), false);
  });

  it('two calls to hashPassword produce different salts', () => {
    const h1 = hashPassword('same');
    const h2 = hashPassword('same');
    assert.notStrictEqual(h1, h2, 'salts should differ');
    assert.ok(verifyPasswordHash('same', h1));
    assert.ok(verifyPasswordHash('same', h2));
  });
});
