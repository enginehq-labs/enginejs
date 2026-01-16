import test from 'node:test';
import assert from 'node:assert/strict';

import { Sequelize } from 'sequelize';

import { initSequelizeModelsFromDsl } from '../../src/orm/sequelizeAdapter.js';

test('initSequelizeModelsFromDsl: defines models and scalar belongsTo association', () => {
  const sequelize = new Sequelize('postgres://user:pass@localhost:5432/db', { logging: false });
  const { models } = initSequelizeModelsFromDsl(sequelize, {
    role: {
      fields: {
        id: { type: 'int', primary: true, autoIncrement: true },
        role_name: { type: 'string' },
      },
    },
    customer: {
      fields: {
        email: { type: 'string' },
        role_id: { type: 'int', source: 'role', sourceid: 'id', columnName: 'role_id' },
      },
    },
  });

  assert.ok(models.role);
  assert.ok(models.customer);

  // Association aliases
  assert.ok((models.customer as any).associations?.role, 'customer.belongsTo(role) missing');

  // Column mapping preserved
  const attr = (models.customer as any).rawAttributes.role_id;
  assert.equal(attr.field, 'role_id');
});

test('initSequelizeModelsFromDsl: creates junction for multi-int fk and adds belongsToMany', () => {
  const sequelize = new Sequelize('postgres://user:pass@localhost:5432/db', { logging: false });
  const { models, junctionModels } = initSequelizeModelsFromDsl(sequelize, {
    tag: { fields: { id: { type: 'int', primary: true, autoIncrement: true } } },
    post: {
      fields: {
        title: { type: 'string' },
        tags: { type: 'int', multi: true, source: 'tag', sourceid: 'id' },
      },
    },
  });

  const joinName = 'post__tags__to__tag__id';
  assert.ok(junctionModels[joinName], 'junction model missing');
  assert.ok(models[joinName], 'junction model not registered in models');

  assert.ok((models.post as any).associations?.tags, 'post.belongsToMany(tag, as: tags) missing');
  assert.ok((models.tag as any).associations?.post, 'tag.belongsToMany(post, as: post) missing');
});
