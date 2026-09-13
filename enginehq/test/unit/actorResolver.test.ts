import test from 'node:test';
import assert from 'node:assert/strict';

import { signActorAccessTokenHS256 } from '@enginehq/auth';
import type { Actor } from '@enginehq/core';

import { createActorResolver } from '../../src/runtime/actorResolver.js';
import type { EngineJsAppConfig } from '../../src/runtime/config.js';

const SECRET = 'test-secret';

const USER_ACTOR: Actor = {
  isAuthenticated: true,
  subjects: { user: { type: 'user', model: 'user', id: '1' } },
  roles: ['admin'],
  claims: { sub: '1' },
  sessionId: 'sid-1',
};

function makeConfig(extra: Partial<EngineJsAppConfig> = {}, accessSecret: string | null = SECRET): EngineJsAppConfig {
  return {
    http: { port: 3000 },
    engine: {
      auth: accessSecret ? { jwt: { accessSecret, accessTtl: '15m' } } : undefined,
    } as any,
    ...extra,
  };
}

function req(authorization?: string): any {
  return { headers: authorization === undefined ? {} : { authorization } };
}

function sign(opts: { secret?: string; nowSeconds?: number; ttlSeconds?: number } = {}): string {
  return signActorAccessTokenHS256({
    actor: USER_ACTOR,
    secret: opts.secret ?? SECRET,
    ttlSeconds: opts.ttlSeconds ?? 900,
    ...(opts.nowSeconds !== undefined ? { nowSeconds: opts.nowSeconds } : {}),
  });
}

test('actor resolver: a valid token gives the authenticated actor', async () => {
  const resolve = createActorResolver(makeConfig())!;
  const actor = await resolve(req(`Bearer ${sign()}`));
  assert.equal(actor.isAuthenticated, true);
  assert.deepEqual(actor.roles, ['admin']);
  assert.equal(actor.sessionId, 'sid-1');
});

test('actor resolver: tokens that do not verify give the anonymous actor', async () => {
  const resolve = createActorResolver(makeConfig())!;
  const expired = sign({ nowSeconds: Math.floor(Date.now() / 1000) - 7200, ttlSeconds: 60 });

  for (const header of [
    `Bearer ${sign({ secret: 'wrong-secret' })}`,
    'Bearer not-a-jwt',
    'Basic dXNlcjpwYXNz',
    `Bearer ${expired}`,
    undefined,
  ]) {
    const actor = await resolve(req(header));
    assert.equal(actor.isAuthenticated, false, `expected anonymous for header: ${header}`);
  }
});

test('actor resolver: a resolveActor in the config replaces the JWT resolver', async () => {
  const custom: Actor = { isAuthenticated: true, subjects: {}, roles: ['from-config'], claims: {} };
  const resolve = createActorResolver(makeConfig({ resolveActor: () => custom }))!;

  // The request holds a valid JWT, so this proves the config resolver wins.
  const actor = await resolve(req(`Bearer ${sign()}`));
  assert.deepEqual(actor.roles, ['from-config']);
});

test('actor resolver: a resolveActor that returns null gives the anonymous actor', async () => {
  const resolve = createActorResolver(makeConfig({ resolveActor: async () => null }))!;
  const actor = await resolve(req());
  assert.equal(actor.isAuthenticated, false);
});

test('actor resolver: no secret and no resolveActor gives no resolver', () => {
  assert.equal(createActorResolver(makeConfig({}, null)), undefined);
});
