import { Op, type Model, type ModelStatic } from 'sequelize';

type Logger = {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
};

function safeFields(model: ModelStatic<Model>, updates: Record<string, unknown>): Record<string, unknown> {
  const attrs = (model as any).rawAttributes || {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (k in attrs) out[k] = v;
  }
  return out;
}

export type OutboxRetentionMode = 'none' | 'archive' | 'delete';

export type WorkflowOutboxMaintenanceOptions = {
  mode?: OutboxRetentionMode;
  retentionDays?: number;
  batchLimit?: number;
  now?: Date;
};

export class WorkflowOutboxMaintenance {
  constructor(
    private readonly deps: {
      outboxModel: ModelStatic<Model>;
      logger: Logger;
    },
  ) {}

  async runOnce(opts: WorkflowOutboxMaintenanceOptions = {}): Promise<{ archived: number; deleted: number }> {
    const mode = (opts.mode ?? 'none') as OutboxRetentionMode;
    const days = Number(opts.retentionDays ?? NaN);
    const limit = Number(opts.batchLimit ?? 1000);
    const now = opts.now ?? new Date();

    if (mode === 'none') return { archived: 0, deleted: 0 };
    if (!Number.isFinite(days) || days <= 0) return { archived: 0, deleted: 0 };
    if (!(this.deps.outboxModel as any).rawAttributes?.created_at) {
      this.deps.logger.warn('[outboxMaintenance] outbox missing created_at; skipping retention');
      return { archived: 0, deleted: 0 };
    }

    const terminalStatuses = mode === 'delete' ? ['done', 'failed', 'archived'] : ['done', 'failed'];
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const where: any = {
      status: { [Op.in]: terminalStatuses },
      created_at: { [Op.lte]: cutoff },
    };

    const rows = (await (this.deps.outboxModel as any).findAll({
      where,
      attributes: ['id'],
      order: [['id', 'ASC']],
      limit,
      raw: true,
    })) as Array<{ id: string | number }>;
    if (!rows.length) return { archived: 0, deleted: 0 };
    const ids = rows.map((r) => r.id);

    if (mode === 'delete') {
      const count = await (this.deps.outboxModel as any).destroy({ where: { id: { [Op.in]: ids } } });
      return { archived: 0, deleted: Number(count || 0) };
    }

    const updates = safeFields(this.deps.outboxModel, {
      status: 'archived',
      ...( (this.deps.outboxModel as any).rawAttributes?.archived ? { archived: true } : {}),
      ...( (this.deps.outboxModel as any).rawAttributes?.archived_at ? { archived_at: now } : {}),
    });
    const [count] = await (this.deps.outboxModel as any).update(updates, { where: { id: { [Op.in]: ids } } });
    return { archived: Number(count || 0), deleted: 0 };
  }
}
