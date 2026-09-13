import test from 'node:test';
import assert from 'node:assert/strict';

import type { EngineConfig } from '@enginehq/core';
import { DefaultServiceRegistry } from '@enginehq/core';

import { createExpressApp } from '../../src/http/createExpressApp.js';

function makeServices() {
  const services = new DefaultServiceRegistry();
  services.register('logger', 'singleton', () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }));
  return services;
}

/** Config with the built-in auth routes turned on. */
function makeConfig(accessSecret: string): EngineConfig {
  return {
    app: { name: 'test', env: 'test' },
    db: { url: 'postgres://localhost/none', dialect: 'postgres' },
    dsl: { fragments: { modelsDir: 'dsl/models', metaDir: 'dsl/meta' } },
    auth: {
      jwt: { accessSecret, accessTtl: '15m' },
      local: { userModel: 'user' },
    },
    acl: {},
    rls: { subjects: {}, policies: {} },
  } as unknown as EngineConfig;
}

test('createExpressApp: auth.local with a JWT secret shorter than 32 characters rejects', async () => {
  await assert.rejects(
    createExpressApp({
      services: makeServices(),
      getDsl: () => ({}) as any,
      getOrm: () => ({ models: {} }) as any,
      getConfig: () => makeConfig('x'.repeat(31)),
    }),
    /at least 32 characters/,
  );
});
