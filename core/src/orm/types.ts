import type { Model, ModelStatic, Sequelize } from 'sequelize';

import type { DslRoot } from '../dsl/types.js';

export type OrmInitResult = {
  sequelize: Sequelize;
  dsl: DslRoot;
  models: Record<string, ModelStatic<Model>>;
  junctionModels: Record<string, ModelStatic<Model>>;
};

