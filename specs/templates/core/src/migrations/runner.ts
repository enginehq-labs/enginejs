import type { Sequelize } from 'sequelize';

import type { Migration, MigrationCtx } from './types.js';

type Logger = {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
};

function defaultLogger(): Logger {
  return {
    info: (...args: any[]) => console.log(...args),
    warn: (...args: any[]) => console.warn(...args),
    error: (...args: any[]) => console.error(...args),
  };
}

async function tableExists(sequelize: Sequelize, tableName: string): Promise<boolean> {
  const qi = sequelize.getQueryInterface();
  try {
    await qi.describeTable(tableName);
    return true;
  } catch {
    return false;
  }
}

export type MigrationStatus = {
  executed: string[];
  pending: string[];
};

export class MigrationRunner {
  constructor(
    private readonly deps: {
      sequelize: Sequelize;
      migrations: Migration[];
      logger?: Logger;
      tableName?: string;
    },
  ) {}

  private get tableName(): string {
    return this.deps.tableName ?? 'engine_migrations';
  }

  private get logger(): Logger {
    return this.deps.logger ?? defaultLogger();
  }

  private sortedMigrations(): Migration[] {
    const ms = [...(this.deps.migrations || [])];
    ms.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return ms;
  }

  private async ensureTable(): Promise<void> {
    const exists = await tableExists(this.deps.sequelize, this.tableName);
    if (exists) return;
    const qi = this.deps.sequelize.getQueryInterface();
    await qi.createTable(this.tableName, {
      id: { type: 'VARCHAR(255)', primaryKey: true, allowNull: false },
      executed_at: { type: 'TIMESTAMP WITH TIME ZONE', allowNull: false },
    } as any);
  }

  private async loadExecutedIds(): Promise<Set<string>> {
    await this.ensureTable();
    const qi = this.deps.sequelize.getQueryInterface();
    const rows = (await (qi as any).select(null, this.tableName, { attributes: ['id'], order: [['id', 'ASC']] })) as Array<
      { id: string }
    >;
    const out = new Set<string>();
    for (const r of rows || []) out.add(String(r.id));
    return out;
  }

  async status(): Promise<MigrationStatus> {
    const executed = await this.loadExecutedIds();
    const migrations = this.sortedMigrations();
    const all = migrations.map((m) => String(m.id));
    return {
      executed: all.filter((id) => executed.has(id)),
      pending: all.filter((id) => !executed.has(id)),
    };
  }

  async up(): Promise<{ applied: string[] }> {
    const qi = this.deps.sequelize.getQueryInterface();
    const executed = await this.loadExecutedIds();
    const migrations = this.sortedMigrations();
    const applied: string[] = [];

    const ctx: MigrationCtx = {
      sequelize: this.deps.sequelize,
      queryInterface: qi,
      logger: this.logger,
    };

    for (const m of migrations) {
      const id = String(m.id);
      if (executed.has(id)) continue;
      if (!id) throw new Error('Migration id is required');
      this.logger.info('[migrations] up', { id });
      await m.up(ctx);
      await (qi as any).insert(null, this.tableName, { id, executed_at: new Date() }, {});
      executed.add(id);
      applied.push(id);
    }

    return { applied };
  }
}

