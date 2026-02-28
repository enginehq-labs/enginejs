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
