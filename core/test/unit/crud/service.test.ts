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

/**
 * Runs a bypass list on one `item` model and records the `where` that findAll receives.
 * The Sequelize stubs return plain objects, so a test can read the built query.
 */
function buildFilterHarness(fields: Record<string, unknown>) {
  const Op = {
    and: Symbol('and'),
    or: Symbol('or'),
    in: Symbol('in'),
    notIn: Symbol('notIn'),
    ne: Symbol('ne'),
    iLike: Symbol('iLike'),
    contains: Symbol('contains'),
    not: Symbol('not'),
    gt: Symbol('gt'),
    gte: Symbol('gte'),
    lt: Symbol('lt'),
    lte: Symbol('lte'),
  };
  const dsl = {
    tag: { fields: { id: { type: 'int', primary: true } } },
    item: { fields: { id: { type: 'int', primary: true }, ...fields } },
  } as unknown as DslRoot;

  const wheres: any[] = [];
  const orm: OrmInitResult = {
    sequelize: {
      Sequelize: {
        Op,
        literal: (sql: string) => `LITERAL(${sql})`,
        where: (left: unknown, cond: unknown) => ({ WHERE: left, cond }),
        fn: (name: string, ...args: unknown[]) => ({ FN: name, args }),
        col: (name: string) => ({ COL: name }),
      },
      escape: (v: unknown) => `'${v}'`,
    } as any,
    models: {
      item__tags__to__tag__id: { findAll: async () => [] },
      item: {
        primaryKeyAttributes: ['id'],
        associations: {},
        findAll: async (opts: any) => {
          wheres.push(opts.where);
          return [];
        },
        count: async () => 0,
      },
    } as any,
    junctionModels: {},
    dsl,
  };

  const services = new DefaultServiceRegistry();
  services.register('dsl', 'singleton', () => dsl);
  services.register('orm', 'singleton', () => orm);
  services.register('config', 'singleton', () => ({}) as EngineConfig);

  const actor = { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {} };
  const list = async (filters: string) => {
    await new CrudService({ services }).list({
      actor,
      modelKey: 'item',
      query: { filters },
      options: { bypassAclRls: true, runPipelines: false },
    });
    return wheres[wheres.length - 1];
  };
  return { list, Op };
}

test('CrudService: a filter on a save: false field adds no where part', async () => {
  const { list } = buildFilterHarness({ nick: { type: 'string', save: false } });

  assert.deepEqual(await list('nick:alice'), {});
});

test('CrudService: a filter on an integer junction field uses the junction subquery', async () => {
  const { list, Op } = buildFilterHarness({ tags: { type: 'integer', multi: true, source: 'tag', sourceid: 'id' } });

  const where = await list('tags:99');

  assert.equal(where.tags, undefined, 'the filter must not reach the tags column');
  assert.match(String(where.id?.[Op.in]), /SELECT "itemId" FROM "item__tags__to__tag__id" WHERE "tagId" = '99'/);
});

test('CrudService: a * in a string filter becomes the ILIKE wildcard', async () => {
  const { list, Op } = buildFilterHarness({ name: { type: 'string' } });

  const where = await list('name:Al*');

  assert.equal(where.name?.[Op.iLike], 'Al%');
});

test('CrudService: a * in a string array filter becomes the ILIKE wildcard', async () => {
  const { list, Op } = buildFilterHarness({ labels: { type: 'string', multi: true } });

  const where = await list('labels:Al*');

  assert.deepEqual(where.WHERE, { FN: 'array_to_string', args: [{ COL: 'labels' }, ' '] });
  assert.equal(where.cond?.[Op.iLike], 'Al%');
});

/**
 * A `node` model with deleted and archived columns. Its mock association points back to
 * the same model, so the include graph can grow as deep as the depth allows.
 */
function buildIncludeHarness() {
  const Op = { and: Symbol('and'), or: Symbol('or') };
  const dsl = {
    node: {
      fields: { id: { type: 'int', primary: true } },
      access: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'] },
    },
  } as unknown as DslRoot;

  const calls: any[] = [];
  const node: any = {
    primaryKeyAttributes: ['id'],
    rawAttributes: { id: {}, deleted: {}, archived: {} },
    findAll: async (opts: any) => {
      calls.push(opts);
      return [];
    },
    count: async () => 0,
    findOne: async (opts: any) => {
      calls.push(opts);
      return { id: 1 };
    },
  };
  node.associations = { parent: { associationType: 'BelongsTo', target: node } };

  const orm: OrmInitResult = {
    sequelize: { Sequelize: { Op, literal: () => '' } } as any,
    models: { node } as any,
    junctionModels: {},
    dsl,
  };

  const services = new DefaultServiceRegistry();
  services.register('dsl', 'singleton', () => dsl);
  services.register('orm', 'singleton', () => orm);
  services.register('config', 'singleton', () => ({ rls: { subjects: {}, policies: {} } }) as unknown as EngineConfig);

  const actor = { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {} };
  const service = new CrudService({ services });
  const last = () => calls[calls.length - 1];
  return { service, actor, Op, last };
}

function includeLevels(include: any[] | undefined): number {
  let levels = 0;
  let current = include;
  while (current && current.length) {
    levels += 1;
    current = current[0].include;
  }
  return levels;
}

test('CrudService: list with includeDeleted "0" keeps the deleted filter', async () => {
  const { service, actor, Op, last } = buildIncludeHarness();

  await service.list({ actor, modelKey: 'node', query: { includeDeleted: '0' } as any, options: { bypassAclRls: true, runPipelines: false } });

  assert.deepEqual(last().where[Op.and], [{ deleted: false }, { archived: false }]);
});

test('CrudService: list with includeDeleted true removes the deleted filter', async () => {
  const { service, actor, last } = buildIncludeHarness();

  await service.list({ actor, modelKey: 'node', query: { includeDeleted: true }, options: { bypassAclRls: true, runPipelines: false } });

  assert.deepEqual(last().where, { archived: false });
});

test('CrudService: read with includeDeleted "0" keeps the deleted filter', async () => {
  const { service, actor, Op, last } = buildIncludeHarness();

  await service.read({ actor, modelKey: 'node', id: 1, query: { includeDeleted: '0' } as any, options: { runPipelines: false } });

  assert.deepEqual(last().where[Op.and], [{ id: 1 }, { deleted: false }, { archived: false }]);
});

test('CrudService: read caps includeDepth at 10', async () => {
  const { service, actor, last } = buildIncludeHarness();

  await service.read({ actor, modelKey: 'node', id: 1, query: { includeDepth: '50' } as any, options: { runPipelines: false } });

  assert.equal(includeLevels(last().include), 10);
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

function recordInfoLogs(services: DefaultServiceRegistry) {
  const lines: Array<{ msg: string; meta: any }> = [];
  services.register('logger', 'singleton', () => ({
    info: (msg: string, meta?: any) => lines.push({ msg, meta }),
    warn: () => {},
    error: () => {},
    debug: () => {},
  }));
  return lines;
}

test('CrudService: a bypassAclRls call writes one audit log line', async () => {
  const { services } = buildReadHarness();
  const lines = recordInfoLogs(services);
  const service = new CrudService({ services });
  const actor = {
    isAuthenticated: true,
    subjects: { user: { type: 'user', model: 'user', id: 5 } },
    roles: ['system'],
    claims: { email: 'person@example.com' },
  };

  await service.read({ actor, modelKey: 'link', id: 1, origin: 'test-origin', options: { bypassAclRls: true } });

  const audits = lines.filter((l) => l.msg === '[crud] audited bypass');
  assert.equal(audits.length, 1);
  // Claims can hold personal data, so the log line must not contain them.
  assert.deepEqual(audits[0]!.meta, { model: 'link', action: 'read', origin: 'test-origin', subjects: ['user:5'], roles: ['system'] });
});

test('CrudService: a call with no bypass writes no audit log line', async () => {
  const { services } = buildReadHarness();
  const lines = recordInfoLogs(services);
  const service = new CrudService({ services });

  // The outcome of the read does not matter here. Only the log matters.
  await service
    .read({ actor: { isAuthenticated: false, subjects: {}, roles: [], claims: {} }, modelKey: 'link', id: 1 })
    .catch(() => {});

  assert.equal(lines.filter((l) => l.msg === '[crud] audited bypass').length, 0);
});

/**
 * Records each pipeline phase that runs. Every action and phase has its own custom op,
 * so a test can check which phases ran and in which order.
 */
function buildPhaseHarness() {
  const dsl: DslRoot = {
    link: {
      fields: {
        id: { type: 'int', primary: true },
        slug: { type: 'string' },
        secret: { type: 'string' },
      },
      access: { read: ['admin'], create: ['admin'], update: ['admin'], delete: ['admin'] },
    } as any,
  };

  const stored = { id: 1, slug: 'my-link', secret: 'hash' };
  const persisted: Array<Record<string, unknown>> = [];
  const instance = {
    get: () => ({ ...stored }),
    update: async (payload: any) => {
      persisted.push(payload);
      Object.assign(stored, payload);
    },
  };

  const orm: OrmInitResult = {
    sequelize: {
      transaction: async (cb: any) => cb({}),
      Sequelize: { Op: { and: Symbol('and'), or: Symbol('or') }, literal: () => '' },
    } as any,
    models: {
      link: {
        primaryKeyAttributes: ['id'],
        rawAttributes: { id: {}, slug: {}, secret: {} },
        associations: {},
        findAll: async () => [{ ...stored }],
        count: async () => 1,
        findOne: async () => instance,
        create: async (payload: any) => {
          persisted.push(payload);
          return { get: () => ({ id: 1, ...payload }) };
        },
      },
    } as any,
    junctionModels: {},
    dsl,
  };

  const ran: string[] = [];
  const actions = ['list', 'read', 'create', 'update', 'delete'];
  const phases = ['beforeValidate', 'validate', 'beforePersist', 'afterPersist', 'response'];
  const spec: Record<string, Record<string, unknown[]>> = {};
  const services = new DefaultServiceRegistry();
  for (const action of actions) {
    spec[action] = {};
    for (const phase of phases) {
      const name = `${action}_${phase}`;
      spec[action]![phase] = [{ op: 'custom', name }];
      services.register(`pipelines.custom.${name}`, 'singleton', () => (ctx: any) => {
        ran.push(`${action}.${phase}`);
        return { output: ctx.input };
      });
    }
  }
  services.register('dsl', 'singleton', () => dsl);
  services.register('orm', 'singleton', () => orm);
  services.register('config', 'singleton', () => ({ rls: { subjects: {}, policies: {} } }) as unknown as EngineConfig);
  services.register('pipelines', 'singleton', () => ({ get: () => spec }));

  const actor = { isAuthenticated: true, subjects: {}, roles: ['admin'], claims: {} };
  return { service: new CrudService({ services }), ran, persisted, spec, actor };
}

test('CrudService: list with bypassAclRls runs the response pipeline', async () => {
  const { service, ran, actor } = buildPhaseHarness();

  await service.list({ actor, modelKey: 'link', options: { bypassAclRls: true } });

  assert.deepEqual(ran, ['list.response']);
});

test('CrudService: list with bypassAclRls honours runResponsePipeline false', async () => {
  const { service, ran, actor } = buildPhaseHarness();

  await service.list({ actor, modelKey: 'link', options: { bypassAclRls: true, runResponsePipeline: false } });

  assert.deepEqual(ran, []);
});

test('CrudService: create with bypassAclRls runs every phase, response included', async () => {
  const { service, ran, actor } = buildPhaseHarness();

  await service.create({ actor, modelKey: 'link', values: { slug: 'a' }, options: { bypassAclRls: true } });

  assert.deepEqual(ran, ['create.beforeValidate', 'create.validate', 'create.beforePersist', 'create.afterPersist', 'create.response']);
});

test('CrudService: create with bypassAclRls honours runResponsePipeline false', async () => {
  const { service, ran, actor } = buildPhaseHarness();

  await service.create({ actor, modelKey: 'link', values: { slug: 'a' }, options: { bypassAclRls: true, runResponsePipeline: false } });

  assert.deepEqual(ran, ['create.beforeValidate', 'create.validate', 'create.beforePersist', 'create.afterPersist']);
});

test('CrudService: update with bypassAclRls runs every phase in order', async () => {
  const { service, ran, actor } = buildPhaseHarness();

  await service.update({ actor, modelKey: 'link', id: 1, values: { slug: 'b' }, options: { bypassAclRls: true } });

  assert.deepEqual(ran, ['update.beforeValidate', 'update.validate', 'update.beforePersist', 'update.afterPersist', 'update.response']);
});

test('CrudService: update with bypassAclRls saves the beforePersist output', async () => {
  const { service, persisted, spec, actor } = buildPhaseHarness();
  // Stands in for hashPassword: an op that writes a field before the row is saved.
  spec.update!.beforePersist!.push({ op: 'set', field: 'secret', value: 'new-hash' });

  await service.update({ actor, modelKey: 'link', id: 1, values: { slug: 'b' }, options: { bypassAclRls: true } });

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]!.secret, 'new-hash');
});

test('CrudService: update with bypassAclRls honours runPipelines false', async () => {
  const { service, ran, actor } = buildPhaseHarness();

  await service.update({ actor, modelKey: 'link', id: 1, values: { slug: 'b' }, options: { bypassAclRls: true, runPipelines: false } });

  assert.deepEqual(ran, []);
});

test('CrudService: delete runs afterPersist, then response', async () => {
  const { service, ran, actor } = buildPhaseHarness();

  await service.delete({ actor, modelKey: 'link', id: 1 });

  assert.deepEqual(ran, ['delete.afterPersist', 'delete.response']);
});

test('CrudService: delete with bypassAclRls runs afterPersist, then response', async () => {
  const { service, ran, actor } = buildPhaseHarness();

  await service.delete({ actor, modelKey: 'link', id: 1, options: { bypassAclRls: true } });

  assert.deepEqual(ran, ['delete.afterPersist', 'delete.response']);
});

test('CrudService: a remove op in delete.response keeps the field out of the returned row', async () => {
  const { service, spec, actor } = buildPhaseHarness();
  spec.delete!.response!.push({ op: 'remove', fields: ['secret'] });

  const row = await service.delete({ actor, modelKey: 'link', id: 1, options: { bypassAclRls: true } });

  assert.equal(row.slug, 'my-link');
  assert.equal('secret' in row, false, 'password_hash style fields must not reach the caller');
});

test('CrudService: delete honours runPipelines false', async () => {
  const { service, ran, actor } = buildPhaseHarness();

  await service.delete({ actor, modelKey: 'link', id: 1, options: { bypassAclRls: true, runPipelines: false } });

  assert.deepEqual(ran, []);
});
