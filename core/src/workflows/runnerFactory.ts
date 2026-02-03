import type { Model, ModelStatic, Sequelize } from 'sequelize';

import type { ServiceRegistry, WorkflowRegistry } from '../services/types.js';
import type { Logger } from '../observability/types.js';
import { WorkflowRunner } from './runner.js';

export function createWorkflowRunner(deps: {
  sequelize: Sequelize;
  outboxModel: ModelStatic<Model>;
  models: Record<string, ModelStatic<Model>>;
  workflows: WorkflowRegistry;
  services: ServiceRegistry;
  logger: Logger;
}) {
  return new WorkflowRunner(deps);
}

