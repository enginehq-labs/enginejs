import test from 'node:test';
import assert from 'node:assert/strict';

import type { EngineConfig } from '@enginehq/core';
import { DefaultServiceRegistry } from '@enginehq/core';
import { InMemoryAuthSessionStore, SequelizeAuthSessionStore } from '@enginehq/auth';

import { resolveAndLogSessionStore } from '../../src/routers/auth.js';

/** Minimal config carrying only what the auth router reads. */
function makeConfig(sessions?: Record<string, unknown>): EngineConfig {
  return {
    app: { name: 'test', env: 'test' },
    db: { url: 'postgres://localhost/none', dialect: 'postgres' },
    dsl: { fragments: { modelsDir: 'dsl/models', metaDir: 'dsl/meta' } },
    auth: {
      jwt: { accessSecret: 'secret', accessTtl: '15m' },
      local: { userModel: 'user' },
      ...(sessions ? { sessions } : {}),
    },
    acl: {},
    rls: { subjects: {}, policies: {} },
  } as unknown as EngineConfig;
}

/** Service registry with an optional orm exposing `models`. */
function makeServices(models?: Record<string, unknown>) {
  const services = new DefaultServiceRegistry();
  services.register('logger', 'singleton', () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }));
  if (models) services.register('orm', 'singleton', () => ({ models }) as any);
  return services;
}

function storeFor(config: EngineConfig, services: any) {
  return resolveAndLogSessionStore({ config, services }).store;
}

test('auth session store: auto-detects the DB model when present', () => {
  const services = makeServices({ auth_session: { name: 'auth_session' } });
  const store = storeFor(makeConfig({ enabled: true, refreshTtlDays: 7, refreshRotate: true }), services);
  assert.ok(store instanceof SequelizeAuthSessionStore, 'should pick the Sequelize store');
});

test('auth session store: falls back to memory when the model is absent', () => {
  const services = makeServices({ user: {} });
  const store = storeFor(makeConfig({ enabled: true, refreshTtlDays: 7, refreshRotate: true }), services);
  assert.ok(store instanceof InMemoryAuthSessionStore, 'should fall back to in-memory');
});

test("auth session store: store 'memory' forces in-memory even when the model exists", () => {
  const services = makeServices({ auth_session: {} });
  const store = storeFor(
    makeConfig({ enabled: true, refreshTtlDays: 7, refreshRotate: true, store: 'memory' }),
    services,
  );
  assert.ok(store instanceof InMemoryAuthSessionStore);
});

test("auth session store: store 'model' throws when the model is missing", () => {
  const services = makeServices({});
  assert.throws(
    () => storeFor(makeConfig({ enabled: true, refreshTtlDays: 7, refreshRotate: true, store: 'model' }), services),
    /auth_session.*missing/s,
  );
});

test('auth session store: honours a custom modelKey', () => {
  const services = makeServices({ my_sessions: {} });
  const store = storeFor(
    makeConfig({ enabled: true, refreshTtlDays: 7, refreshRotate: true, modelKey: 'my_sessions' }),
    services,
  );
  assert.ok(store instanceof SequelizeAuthSessionStore);
});

test('auth session store: an authSessionStore service overrides config', () => {
  const custom = new InMemoryAuthSessionStore();
  const services = makeServices({ auth_session: {} });
  services.register('authSessionStore', 'singleton', () => custom);
  const store = storeFor(
    makeConfig({ enabled: true, refreshTtlDays: 7, refreshRotate: true, store: 'model' }),
    services,
  );
  assert.equal(store, custom, 'the registered service should win over config');
});

test('auth session store: warns when falling back to memory with sessions enabled', () => {
  const warnings: string[] = [];
  const services = new DefaultServiceRegistry();
  services.register('logger', 'singleton', () => ({
    info: () => {},
    warn: (m: string) => warnings.push(m),
    error: () => {},
    debug: () => {},
  }));
  storeFor(makeConfig({ enabled: true, refreshTtlDays: 7, refreshRotate: true }), services);
  assert.equal(warnings.length, 1, 'should warn exactly once');
  assert.match(warnings[0]!, /multi-process/);
});
