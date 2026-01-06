import type { Sequelize } from 'sequelize';

type Logger = {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
};

export type MigrationCtx = {
  sequelize: Sequelize;
  queryInterface: ReturnType<Sequelize['getQueryInterface']>;
  logger: Logger;
};

export type Migration = {
  id: string;
  up: (ctx: MigrationCtx) => Promise<void>;
};

