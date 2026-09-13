import test from 'node:test';
import assert from 'node:assert/strict';

import { DataTypes, Sequelize } from 'sequelize';

import type { OrmInitResult } from '../../src/orm/types.js';
import { rlsWhereToSequelize } from '../../src/rls/toSequelizeWhere.js';
import type { RlsWhere } from '../../src/rls/where.js';

// The Sequelize instance never connects. The tests only render SQL.
function makeOrm(): { orm: OrmInitResult; sql: (where: any) => string } {
  const sequelize = new Sequelize('postgres://u:p@127.0.0.1:1/none', { dialect: 'postgres', logging: false });
  const customer = sequelize.define('customer', { id: { type: DataTypes.INTEGER, primaryKey: true } }, { tableName: 'customer', timestamps: false });
  const order = sequelize.define('order', { id: { type: DataTypes.INTEGER, primaryKey: true }, customer_id: DataTypes.INTEGER }, { tableName: 'order', timestamps: false });
  const orderItem = sequelize.define('order_item', { id: { type: DataTypes.INTEGER, primaryKey: true }, order_id: DataTypes.INTEGER }, { tableName: 'order_item', timestamps: false });
  const orm = { sequelize, models: { customer, order, order_item: orderItem }, junctionModels: {}, dsl: {} } as unknown as OrmInitResult;
  const qg = (sequelize.getQueryInterface() as any).queryGenerator;
  return { orm, sql: (where) => qg.selectQuery('order_item', { where }, orderItem) };
}

const validChain = [
  { fromModel: 'order_item', fromField: 'order_id', toModel: 'order', toField: 'id' },
  { fromModel: 'order', fromField: 'customer_id', toModel: 'customer', toField: 'id' },
];

function via(chain: typeof validChain): RlsWhere {
  return { via: { subject: 'customer', subjectId: 7, chain } };
}

test('rlsWhereToSequelize: a valid via chain gives the IN subquery', () => {
  const { orm, sql } = makeOrm();
  const out = sql(rlsWhereToSequelize(orm, 'order_item', via(validChain)));
  assert.match(out, /"id" IN \(SELECT "t0"\."id" FROM "order_item" AS "t0"/);
  assert.match(out, /"t2"\."id" = 7/);
});

test('rlsWhereToSequelize: a via chain that does not start at the root model denies all rows', () => {
  const { orm, sql } = makeOrm();
  const where = rlsWhereToSequelize(orm, 'order_item', via(validChain.slice(1)));
  assert.notEqual(where, null);
  assert.match(sql(where), /WHERE 0 = 1/);
});

test('rlsWhereToSequelize: a via chain with a missing model denies all rows', () => {
  const { orm, sql } = makeOrm();
  const chain = [{ fromModel: 'order_item', fromField: 'order_id', toModel: 'missing', toField: 'id' }];
  const where = rlsWhereToSequelize(orm, 'order_item', via(chain));
  assert.notEqual(where, null);
  assert.match(sql(where), /WHERE 0 = 1/);
});

test('rlsWhereToSequelize: an unknown root model denies all rows', () => {
  const { orm, sql } = makeOrm();
  const where = rlsWhereToSequelize(orm, 'missing', via(validChain));
  assert.notEqual(where, null);
  assert.match(sql(where), /WHERE 0 = 1/);
});

test('rlsWhereToSequelize: an and with one bad via part keeps the deny part', () => {
  const { orm, sql } = makeOrm();
  const where = rlsWhereToSequelize(orm, 'order_item', {
    and: [{ eq: { field: 'order_id', value: 1 } }, via(validChain.slice(1))],
  });
  const out = sql(where);
  assert.match(out, /"order_id" = 1/);
  assert.match(out, /0 = 1/);
});

test('rlsWhereToSequelize: an unknown where shape denies all rows', () => {
  const { orm, sql } = makeOrm();
  const where = rlsWhereToSequelize(orm, 'order_item', { custom: 'x' } as any);
  assert.notEqual(where, null);
  assert.match(sql(where), /WHERE 0 = 1/);
});

test('rlsWhereToSequelize: an empty where still gives no filter', () => {
  const { orm } = makeOrm();
  assert.equal(rlsWhereToSequelize(orm, 'order_item', null), null);
});
