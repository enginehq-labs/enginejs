import test from 'node:test';
import assert from 'node:assert/strict';
import { DefaultServiceRegistry } from '../../../src/services/DefaultServiceRegistry.js';
import { CrudService } from '../../../src/crud/service.js';
import type { DslRoot } from '../../../src/dsl/types.js';
import type { OrmInitResult } from '../../../src/orm/types.js';
import type { EngineConfig } from '../../../src/config/types.js';

test('CrudService: list passes include graph when includeDepth > 0', async () => {
  const dsl: DslRoot = {
    user: {
      fields: {
        id: { type: 'int', primary: true },
        name: { type: 'string' }
      }
    },
    post: {
      fields: {
        id: { type: 'int', primary: true },
        title: { type: 'string' },
        user_id: { type: 'int', source: 'user', sourceid: 'id' } // belongsTo user
      }
    }
  };

  const config = {} as EngineConfig;

  const queryCalls: any[] = [];
  const mockPostModel = {
    primaryKeyAttributes: ['id'],
    associations: {
      user: {
        associationType: 'BelongsTo',
        target: {
          associations: {}
        }
      }
    },
    findAll: async (opts: any) => {
      queryCalls.push(opts);
      return [];
    },
    count: async () => 0
  };

  const mockUserModel = {};

  const orm: OrmInitResult = {
    sequelize: {
      Sequelize: {
        Op: { and: Symbol('and') }
      }
    } as any,
    models: {
      user: mockUserModel,
      post: mockPostModel
    } as any,
    junctionModels: {},
    dsl
  };

  const services = new DefaultServiceRegistry();
  services.register('dsl', 'singleton', () => dsl);
  services.register('orm', 'singleton', () => orm);
  services.register('config', 'singleton', () => config);

  const service = new CrudService({ services });
  const actor = { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {} };

  // Run with includeDepth = 1
  await service.list({
    actor,
    modelKey: 'post',
    query: { includeDepth: 1 },
    options: { bypassAclRls: true, runPipelines: false }
  });

  assert.equal(queryCalls.length, 1);
  const callOpts = queryCalls[0];
  
  // Assert include graph was passed
  assert.ok(callOpts.include, 'Include option should be present');
  assert.equal(callOpts.include.length, 1);
  assert.equal(callOpts.include[0].association, 'user');
  assert.equal(callOpts.include[0].required, false);
});

test('CrudService: list handles junction field filters', async () => {
  const dsl: DslRoot = {
    tag: { fields: { id: { type: 'int', primary: true } } },
    post: {
      fields: {
        id: { type: 'int', primary: true },
        tags: { type: 'int', multi: true, source: 'tag', sourceid: 'id' }
      }
    }
  };

  const orm: OrmInitResult = {
    sequelize: {
      Sequelize: {
        Op: { and: Symbol('and'), in: Symbol('in') },
        literal: (val: string) => `LITERAL(${val})`
      },
      escape: (v: any) => `'${v}'`
    } as any,
    models: {
      post__tags__to__tag__id: {}, // mock junction presence
      post: {
        primaryKeyAttributes: ['id'],
        findAll: async () => [],
        count: async () => 0
      }
    } as any,
    junctionModels: {},
    dsl
  };

  const services = new DefaultServiceRegistry();
  services.register('dsl', 'singleton', () => dsl);
  services.register('orm', 'singleton', () => orm);
  services.register('config', 'singleton', () => ({}));

  const service = new CrudService({ services });
  const actor = { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {} };

  const req = service.list({
    actor,
    modelKey: 'post',
    query: { filters: 'tags:99' },
    options: { bypassAclRls: true, runPipelines: false }
  });

  // If this executes without throwing, the AST correctly parsed and built a query
  try {
    await req;
  } catch (e) {
    console.error(e);
    throw e;
  }
});

test('CrudService: create wraps operation in transaction if junction fields present', async () => {
  const dsl: DslRoot = {
    tag: { fields: { id: { type: 'int', primary: true } } },
    post: {
      fields: {
        id: { type: 'int', primary: true },
        tags: { type: 'int', multi: true, source: 'tag', sourceid: 'id' }
      }
    }
  };

  let transactionCalled = false;
  let joinCreateCalledWithTx = false;

  const orm: OrmInitResult = {
    sequelize: {
      transaction: async (cb: any) => {
        transactionCalled = true;
        return cb({ id: 'mock-tx' });
      },
      Sequelize: { Op: {}, literal: () => '' },
      escape: (v: any) => v
    } as any,
    models: {
      post__tags__to__tag__id: {
        findAll: async () => [], // No existing joins
        create: async (_values: any, opts: any) => {
          if (opts?.transaction?.id === 'mock-tx') joinCreateCalledWithTx = true;
          return {};
        }
      },
      post: {
        primaryKeyAttributes: ['id'],
        create: async (payload: any, opts: any) => {
          return { id: 1, ...payload, get: () => ({ id: 1, ...payload }) };
        }
      }
    } as any,
    junctionModels: {},
    dsl
  };

  const services = new DefaultServiceRegistry();
  services.register('dsl', 'singleton', () => dsl);
  services.register('orm', 'singleton', () => orm);
  services.register('config', 'singleton', () => ({}));
  const service = new CrudService({ services });

  const actor = { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {} };

  await service.create({
    actor,
    modelKey: 'post',
    values: { tags: [99] },
    options: { bypassAclRls: true, runPipelines: false, runResponsePipeline: false }
  });

  assert.ok(transactionCalled, 'Transaction should have been initiated');
  assert.ok(joinCreateCalledWithTx, 'Junction creation should receive the transaction object');
});

/**
 * bypassAclRls is named for ACL and RLS. It must not silently disable pipelines.
 * create() already runs them in its bypass branch; read() did not, which meant a
 * public read, such as a link-shortener redirect, recorded no analytics.
 */
function buildReadHarness() {
  const dsl: DslRoot = {
    link: {
      fields: {
        id: { type: 'int', primary: true },
        slug: { type: 'string' },
        url: { type: 'string' },
      },
    },
  };

  const orm: OrmInitResult = {
    sequelize: { Sequelize: { Op: { and: Symbol('and') } } } as any,
    models: {
      link: {
        primaryKeyAttributes: ['id'],
        rawAttributes: { id: {}, slug: {}, url: {} },
        associations: {},
        findOne: async () => ({ id: 1, slug: 'my-link', url: 'https://example.com' }),
      },
    } as any,
    junctionModels: {},
    dsl,
  };

  const ran: Array<{ action: string; phase: string }> = [];
  const services = new DefaultServiceRegistry();
  services.register('dsl', 'singleton', () => dsl);
  services.register('orm', 'singleton', () => orm);
  services.register('config', 'singleton', () => ({}) as EngineConfig);
  services.register('pipelines', 'singleton', () => ({
    get: () => ({
      read: {
        response: [{ op: 'custom', name: 'recordClick' }],
      },
    }),
  }));
  services.register('pipelines.custom.recordClick', 'singleton', () => (ctx: any) => {
    ran.push({ action: 'read', phase: 'response' });
    return { output: ctx.input };
  });

  return { services, ran };
}

test('CrudService: read with bypassAclRls still runs the response pipeline', async () => {
  const { services, ran } = buildReadHarness();
  const service = new CrudService({ services });

  const row = await service.read({
    actor: { isAuthenticated: false, subjects: {}, roles: [], claims: {} },
    modelKey: 'link',
    id: 1,
    options: { bypassAclRls: true },
  });

  assert.equal(ran.length, 1, 'the read response pipeline should run under bypass');
  assert.equal(row.url, 'https://example.com');
});

test('CrudService: read with bypassAclRls honours runPipelines false', async () => {
  const { services, ran } = buildReadHarness();
  const service = new CrudService({ services });

  await service.read({
    actor: { isAuthenticated: false, subjects: {}, roles: [], claims: {} },
    modelKey: 'link',
    id: 1,
    options: { bypassAclRls: true, runPipelines: false },
  });

  assert.equal(ran.length, 0, 'callers must still be able to opt out');
});

/**
 * The RLS write guard must hold for the payload that is persisted. A `set` op in
 * beforePersist runs after the first guard call, so it could replace an enforced field.
 */
function buildWriteGuardHarness(writeMode: 'enforce' | 'validate') {
  const dsl: DslRoot = {
    task: {
      fields: {
        id: { type: 'int', primary: true },
        customer_id: { type: 'int' },
        name: { type: 'string' },
      },
      access: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'] },
    } as any,
  };

  const persisted: Array<Record<string, unknown>> = [];
  const existing = {
    get: () => ({ id: 1, customer_id: 7, name: 'old' }),
    update: async (payload: any) => {
      persisted.push(payload);
    },
  };

  const orm: OrmInitResult = {
    sequelize: {
      transaction: async (cb: any) => cb({}),
      Sequelize: { Op: { and: Symbol('and'), or: Symbol('or') }, literal: () => '' },
    } as any,
    models: {
      task: {
        primaryKeyAttributes: ['id'],
        rawAttributes: { id: {}, customer_id: {}, name: {} },
        associations: {},
        create: async (payload: any) => {
          persisted.push(payload);
          return { get: () => ({ id: 1, ...payload }) };
        },
        findOne: async () => existing,
      },
    } as any,
    junctionModels: {},
    dsl,
  };

  const rule = { subject: 'customer', field: 'customer_id', writeMode };
  const config = {
    rls: { subjects: {}, policies: { task: { create: rule, update: rule } } },
  } as unknown as EngineConfig;

  const setCustomer = [{ op: 'set', field: 'customer_id', value: 999 }];
  const services = new DefaultServiceRegistry();
  services.register('dsl', 'singleton', () => dsl);
  services.register('orm', 'singleton', () => orm);
  services.register('config', 'singleton', () => config);
  services.register('pipelines', 'singleton', () => ({
    get: () => ({ create: { beforePersist: setCustomer }, update: { beforePersist: setCustomer } }),
  }));

  const actor = {
    isAuthenticated: true,
    subjects: { customer: { type: 'customer', model: 'customer', id: 7 } },
    roles: ['admin'],
    claims: {},
  };

  return { service: new CrudService({ services }), persisted, actor };
}

test('CrudService: create in enforce mode keeps the enforced field after the pipelines', async () => {
  const { service, persisted, actor } = buildWriteGuardHarness('enforce');

  await service.create({ actor, modelKey: 'task', values: { customer_id: 7, name: 'a' } });

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]!.customer_id, 7, 'a pipeline op must not replace an enforced field');
});

test('CrudService: create in validate mode rejects a pipeline value that breaks the guard', async () => {
  const { service, persisted, actor } = buildWriteGuardHarness('validate');

  await assert.rejects(
    service.create({ actor, modelKey: 'task', values: { customer_id: 7, name: 'a' } }),
    (e: any) => e?.name === 'CrudForbiddenError' || /RLS write guard/.test(String(e?.message)),
  );
  assert.equal(persisted.length, 0, 'nothing may be written');
});

test('CrudService: update in enforce mode keeps the enforced field after the pipelines', async () => {
  const { service, persisted, actor } = buildWriteGuardHarness('enforce');

  await service.update({ actor, modelKey: 'task', id: 1, values: { name: 'b' } });

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]!.customer_id, 7, 'a pipeline op must not replace an enforced field');
});
