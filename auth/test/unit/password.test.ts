import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PipelineEngine } from '@enginehq/core';
import { hashPassword, hashPasswordOp, verifyPasswordHash } from '../../src/password.js';

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

describe('hashPasswordOp', () => {
  function ctxFor(input: Record<string, unknown>): any {
    return {
      action: 'create',
      phase: 'beforePersist',
      modelKey: 'user',
      modelSpec: { fields: {} },
      actor: { isAuthenticated: false, subjects: {}, roles: [], claims: {} },
      input,
      services: { has: () => false, get: () => undefined },
    };
  }

  it('writes a verifiable hash and removes the plain-text password', () => {
    const input: Record<string, unknown> = { email: 'a@example.com', password: 'secr3t' };
    hashPasswordOp(ctxFor(input));
    assert.strictEqual(input.password, undefined);
    assert.ok(verifyPasswordHash('secr3t', String(input.password_hash)));
  });

  it('leaves the input unchanged when no password is present', () => {
    const input: Record<string, unknown> = { email: 'a@example.com', password_hash: 'existing' };
    hashPasswordOp(ctxFor(input));
    assert.deepStrictEqual(input, { email: 'a@example.com', password_hash: 'existing' });
  });

  it('does not write a hash for an empty password', () => {
    const input: Record<string, unknown> = { password: '' };
    hashPasswordOp(ctxFor(input));
    assert.deepStrictEqual(input, {});
  });

  it('uses the from and to field names in args', () => {
    const input: Record<string, unknown> = { secret: 'p1' };
    hashPasswordOp(ctxFor(input), { from: 'secret', to: 'secret_hash' });
    assert.strictEqual(input.secret, undefined);
    assert.ok(verifyPasswordHash('p1', String(input.secret_hash)));
  });

  it('changes the payload when the pipeline engine runs it as a custom op', () => {
    const modelSpec = { fields: { password: { type: 'string', save: false }, password_hash: { type: 'string' } } };
    const engine = new PipelineEngine({ getModelSpec: () => modelSpec as any });
    const { output } = engine.runPhase({
      dsl: {},
      registrySpec: { create: { beforePersist: [{ op: 'custom', name: 'hashPassword' }] } },
      action: 'create',
      phase: 'beforePersist',
      modelKey: 'user',
      actor: { isAuthenticated: false, subjects: {}, roles: [], claims: {} },
      input: { password: 'p2' },
      services: {
        has: (name: string) => name === 'pipelines.custom.hashPassword',
        get: () => hashPasswordOp as any,
      },
    });
    assert.strictEqual(output.password, undefined);
    assert.ok(verifyPasswordHash('p2', String(output.password_hash)));
  });
});
