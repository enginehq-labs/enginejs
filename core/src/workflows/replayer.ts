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

function nowIso() {
  return new Date().toISOString();
}

export type WorkflowReplayerOptions = {
  staleMs?: number;
  limit?: number;
  now?: Date;
};

export class WorkflowReplayer {
  constructor(
    private readonly deps: {
      outboxModel: ModelStatic<Model>;
      logger: Logger;
    },
  ) {}

  async requeueStaleProcessing(opts: WorkflowReplayerOptions = {}): Promise<{ requeued: number }> {
    const staleMs = opts.staleMs ?? 5 * 60_000;
    const limit = opts.limit ?? 500;
    const now = opts.now ?? new Date();

    if (!(this.deps.outboxModel as any).rawAttributes?.updated_at) {
      this.deps.logger.warn('[replayer] outbox missing updated_at; skipping stale requeue');
      return { requeued: 0 };
    }

    const cutoff = new Date(now.getTime() - staleMs);

    const rows = (await (this.deps.outboxModel as any).findAll({
      where: { status: 'processing', updated_at: { [Op.lte]: cutoff } },
      order: [['id', 'ASC']],
      limit,
      raw: true,
    })) as Array<Record<string, any>>;

    if (!rows.length) return { requeued: 0 };

    const ids = rows.map((r) => r.id);
    const updates = safeFields(this.deps.outboxModel, {
      status: 'pending',
      ...( (this.deps.outboxModel as any).rawAttributes?.next_run_at ? { next_run_at: null } : {}),
      updated_at: nowIso(),
    });

    const [count] = await (this.deps.outboxModel as any).update(updates, { where: { id: { [Op.in]: ids } } });
    return { requeued: Number(count || 0) };
  }
}

