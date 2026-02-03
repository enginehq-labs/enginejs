import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import type { DslRoot, ServiceRegistry } from '@enginehq/core';
import { DefaultServiceRegistry } from '@enginehq/core';

import { createExpressApp } from '../../src/http/createExpressApp.js';

function listen(app: any) {
  const server = http.createServer(app);
  return new Promise<{ server: http.Server; url: string; close: () => void }>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('No address'));
      resolve({
        server,
        url: `http://${addr.address}:${addr.port}`,
        close: () => {
          if ('closeAllConnections' in server) {
            (server as any).closeAllConnections();
          }
          server.close();
        },
      });
    });
  });
}

function mockLogger(services: ServiceRegistry) {
  services.register('logger', 'singleton', () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => services.resolve('logger', { scope: 'singleton' }),
  }));
}

async function request(url: string, opts: any = {}) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const reqOpts = {
      method: opts.method || 'GET',
      headers: opts.headers || {},
    };
    const req = http.request(url, reqOpts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 0, body: data ? JSON.parse(data) : null });
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (opts.body) {
      req.write(opts.body);
    }
    req.end();
  });
}

test('createExpressApp: provides res.ok/res.fail and /health', async () => {
  const services: ServiceRegistry = new DefaultServiceRegistry({});
  mockLogger(services);
  const dsl: DslRoot = { customer: { fields: { id: { type: 'int' } } } } as any;

  const config: any = {
    app: { name: 'x', env: 'test' },
    db: { url: 'postgres://user:pass@localhost:5432/db' },
    dsl: { schemaPath: 'x', fragments: { modelsDir: 'x', metaDir: 'x' } },
    auth: { jwt: { accessSecret: 'x', accessTtl: '1h' }, sessions: { enabled: false, refreshTtlDays: 30, refreshRotate: true } },
    acl: {},
    rls: { subjects: {}, policies: {} },
    http: { hideExistence: true },
  };

  const fakeSeq = {
    Op: {
      and: Symbol.for('and'),
      or: Symbol.for('or'),
      in: Symbol.for('in'),
      notIn: Symbol.for('notIn'),
      iLike: Symbol.for('iLike'),
      contains: Symbol.for('contains'),
      not: Symbol.for('not'),
      ne: Symbol.for('ne'),
      gt: Symbol.for('gt'),
      gte: Symbol.for('gte'),
      lt: Symbol.for('lt'),
      lte: Symbol.for('lte'),
    },
    fn: (..._args: any[]) => ({}),
    col: (..._args: any[]) => ({}),
    where: (..._args: any[]) => ({}),
    literal: (sql: string) => ({ $literal: sql }),
  };

  const orm: any = {
    sequelize: { Sequelize: fakeSeq, escape: (v: unknown) => String(v) },
    dsl,
    models: {},
    junctionModels: {},
  };

  const app = await createExpressApp({ services, getDsl: () => dsl, getOrm: () => orm, getConfig: () => config });
  const { url, close } = await listen(app);
  try {
    const { status, body } = await request(`${url}/health`);
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.deepEqual(body.data, { ok: true });
  } finally {
    close();
  }
});

test('createExpressApp: mounts CRUD skeleton and unknown model returns 404 envelope', async () => {
  const services: ServiceRegistry = new DefaultServiceRegistry({});
  mockLogger(services);
  const dsl: DslRoot = { customer: { fields: { id: { type: 'int' } } } } as any;

  const config: any = {
    app: { name: 'x', env: 'test' },
    db: { url: 'postgres://user:pass@localhost:5432/db' },
    dsl: { schemaPath: 'x', fragments: { modelsDir: 'x', metaDir: 'x' } },
    auth: { jwt: { accessSecret: 'x', accessTtl: '1h' }, sessions: { enabled: false, refreshTtlDays: 30, refreshRotate: true } },
    acl: {},
    rls: { subjects: {}, policies: {} },
    http: { hideExistence: true },
  };
  const fakeSeq = {
    Op: { and: Symbol.for('and'), or: Symbol.for('or'), in: Symbol.for('in'), notIn: Symbol.for('notIn'), iLike: Symbol.for('iLike'), contains: Symbol.for('contains'), not: Symbol.for('not') },
    fn: (..._args: any[]) => ({}),
    col: (..._args: any[]) => ({}),
    where: (..._args: any[]) => ({}),
    literal: (sql: string) => ({ $literal: sql }),
  };
  const orm: any = { sequelize: { Sequelize: fakeSeq, escape: (v: unknown) => String(v) }, dsl, models: {}, junctionModels: {} };

  const app = await createExpressApp({ services, getDsl: () => dsl, getOrm: () => orm, getConfig: () => config });
  const { url, close } = await listen(app);
  try {
    const { status, body } = await request(`${url}/api/crud/unknown`);
    assert.equal(status, 404);
    assert.equal(body.success, false);
    assert.equal(body.code, 404);
  } finally {
    close();
  }
});

test('CRUD: list applies default filters and expands junction-backed multi-int to ID arrays when includeDepth=0', async () => {
  const services: ServiceRegistry = new DefaultServiceRegistry({});
  mockLogger(services);

  const dsl: DslRoot = {
    tag: { fields: { id: { type: 'int', primary: true }, deleted: { type: 'boolean' }, archived: { type: 'boolean' }, auto_name: { type: 'string' } }, access: { read: ['admin'] } },
    post: {
      fields: {
        id: { type: 'int', primary: true },
        deleted: { type: 'boolean' },
        archived: { type: 'boolean' },
        auto_name: { type: 'string' },
        tags: { type: 'int', multi: true, source: 'tag', sourceid: 'id' },
      },
      access: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'] },
    },
  } as any;

  const config: any = {
    app: { name: 'x', env: 'test' },
    db: { url: 'postgres://user:pass@localhost:5432/db' },
    dsl: { schemaPath: 'x', fragments: { modelsDir: 'x', metaDir: 'x' } },
    auth: { jwt: { accessSecret: 'x', accessTtl: '1h' }, sessions: { enabled: false, refreshTtlDays: 30, refreshRotate: true } },
    acl: {},
    rls: { subjects: {}, policies: {} },
    http: { hideExistence: true },
  };

  const Op = {
    and: Symbol.for('and'),
    or: Symbol.for('or'),
    in: Symbol.for('in'),
    notIn: Symbol.for('notIn'),
    iLike: Symbol.for('iLike'),
    contains: Symbol.for('contains'),
    not: Symbol.for('not'),
    ne: Symbol.for('ne'),
    gt: Symbol.for('gt'),
    gte: Symbol.for('gte'),
    lt: Symbol.for('lt'),
    lte: Symbol.for('lte'),
  };
  const fakeSeq = {
    Op,
    fn: (..._args: any[]) => ({}),
    col: (..._args: any[]) => ({}),
    where: (..._args: any[]) => ({}),
    literal: (sql: string) => ({ $literal: sql }),
  };

  let lastFindAll: any = null;
  const postModel: any = {
    primaryKeyAttributes: ['id'],
    findAll: async (opts: any) => {
      lastFindAll = opts;
      return [
        { id: 1, deleted: false, archived: false },
        { id: 2, deleted: false, archived: false },
      ];
    },
    count: async (_opts: any) => 2,
  };

  const joinModel: any = {
    findAll: async (_opts: any) => [
      { postId: 1, tagId: 3 },
      { postId: 1, tagId: 2 },
      { postId: 2, tagId: 2 },
    ],
  };

  const orm: any = {
    sequelize: { Sequelize: fakeSeq, escape: (v: unknown) => String(v) },
    dsl,
    models: { post: postModel, tag: {}, post__tags__to__tag__id: joinModel },
    junctionModels: { post__tags__to__tag__id: joinModel },
  };

  const app = await createExpressApp({
    services,
    getDsl: () => dsl,
    getOrm: () => orm,
    getConfig: () => config,
    defaultActor: { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {} },
  });

  const { url, close } = await listen(app);
  try {
    const { status, body } = await request(`${url}/api/crud/post`);
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.pagination.totalCount, 2);
    assert.deepEqual(body.data, [
      { id: 1, deleted: false, archived: false, tags: [2, 3] },
      { id: 2, deleted: false, archived: false, tags: [2] },
    ]);
    assert.ok(lastFindAll?.where, 'missing where');
    assert.ok(lastFindAll.where[Op.and], 'expected Op.and where');
  } finally {
    close();
  }
});

test('CRUD: hideExistence maps ACL deny on read to 404 when enabled', async () => {
  const services: ServiceRegistry = new DefaultServiceRegistry({});
  mockLogger(services);
  const dsl: DslRoot = {
    post: { fields: { id: { type: 'int', primary: true }, deleted: { type: 'boolean' }, archived: { type: 'boolean' }, auto_name: { type: 'string' } }, access: { read: ['admin'] } },
  } as any;

  const config: any = {
    app: { name: 'x', env: 'test' },
    db: { url: 'postgres://user:pass@localhost:5432/db' },
    dsl: { schemaPath: 'x', fragments: { modelsDir: 'x', metaDir: 'x' } },
    auth: { jwt: { accessSecret: 'x', accessTtl: '1h' }, sessions: { enabled: false, refreshTtlDays: 30, refreshRotate: true } },
    acl: {},
    rls: { subjects: {}, policies: {} },
    http: { hideExistence: true },
  };

  const fakeSeq = { Op: { and: Symbol.for('and'), or: Symbol.for('or') }, fn: () => ({}), col: () => ({}), where: () => ({}), literal: (sql: string) => ({ $literal: sql }) };
  const orm: any = {
    sequelize: { Sequelize: fakeSeq, escape: (v: unknown) => String(v) },
    dsl,
    models: { post: { primaryKeyAttributes: ['id'], findOne: async () => ({ id: 1 }) } },
    junctionModels: {},
  };

  const app = await createExpressApp({
    services,
    getDsl: () => dsl,
    getOrm: () => orm,
    getConfig: () => config,
    defaultActor: { isAuthenticated: true, subjects: {}, roles: [], claims: {} },
  });

  const { url, close } = await listen(app);
  try {
    const { status, body } = await request(`${url}/api/crud/post/1`);
    assert.equal(status, 404);
    assert.equal(body.success, false);
    assert.equal(body.code, 404);
  } finally {
    close();
  }
});

test('CRUD: create enqueues workflow outbox event afterPersist when workflows enabled', async () => {
  const services: ServiceRegistry = new DefaultServiceRegistry({});
  mockLogger(services);
  const dsl: DslRoot = {
    post: {
      fields: {
        id: { type: 'int', primary: true },
        deleted: { type: 'boolean' },
        archived: { type: 'boolean' },
        auto_name: { type: 'string' },
        title: { type: 'string', transforms: [{ name: 'trim' }] },
      },
      access: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'] },
    },
    workflow_events_outbox: {
      fields: { id: { type: 'int', primary: true }, model: { type: 'string' }, action: { type: 'string' } },
      access: {},
    },
  } as any;

  const config: any = {
    app: { name: 'x', env: 'test' },
    db: { url: 'postgres://user:pass@localhost:5432/db' },
    dsl: { schemaPath: 'x', fragments: { modelsDir: 'x', metaDir: 'x' } },
    auth: { jwt: { accessSecret: 'x', accessTtl: '1h' }, sessions: { enabled: false, refreshTtlDays: 30, refreshRotate: true } },
    acl: {},
    rls: { subjects: {}, policies: {} },
    http: { hideExistence: true },
    workflows: { enabled: true },
  };

  const Op = { and: Symbol.for('and'), or: Symbol.for('or'), in: Symbol.for('in'), notIn: Symbol.for('notIn'), iLike: Symbol.for('iLike'), contains: Symbol.for('contains'), not: Symbol.for('not') };
  const fakeSeq = { Op, fn: () => ({}), col: () => ({}), where: () => ({}), literal: (sql: string) => ({ $literal: sql }) };

  const createdRows: any[] = [];
  const outboxRows: any[] = [];

  const postModel: any = {
    primaryKeyAttributes: ['id'],
    create: async (payload: any) => {
      createdRows.push(payload);
      return { get: () => ({ id: 1, ...payload }) };
    },
  };
  const outboxModel: any = {
    create: async (payload: any) => {
      outboxRows.push(payload);
      return { get: () => ({ id: 99 }) };
    },
  };

  const orm: any = {
    sequelize: { Sequelize: fakeSeq, escape: (v: unknown) => String(v) },
    dsl,
    models: { post: postModel, workflow_events_outbox: outboxModel },
    junctionModels: {},
  };

  const app = await createExpressApp({
    services,
    getDsl: () => dsl,
    getOrm: () => orm,
    getConfig: () => config,
    defaultActor: { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {} },
  });

  const { url, close } = await listen(app);
  try {
    const { status, body } = await request(`${url}/api/crud/post`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '  Hello  ' }),
    });
    assert.equal(status, 201);
    assert.equal(body.success, true);
    assert.deepEqual(createdRows, [{ title: 'Hello' }]);
    assert.equal(outboxRows.length, 1);
    assert.equal(outboxRows[0].model, 'post');
    assert.equal(outboxRows[0].action, 'create');
    assert.deepEqual(outboxRows[0].after, { id: 1, title: 'Hello' });
  } finally {
    close();
  }
});
