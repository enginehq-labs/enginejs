import type { Model, ModelStatic } from 'sequelize';

import type { WorkflowsConfig } from '../config/types.js';
import type { WorkflowRegistry } from '../services/types.js';

type Logger = {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
};

function isWorkflowSpecLike(spec: unknown): boolean {
  if (!spec || typeof spec !== 'object') return false;
  const triggers = (spec as any).triggers;
  const steps = (spec as any).steps;
  return Array.isArray(triggers) && Array.isArray(steps);
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
  }
  return fallback;
}

export class SequelizeWorkflowRegistryLoader {
  constructor(
    private readonly deps: {
      workflowModel: ModelStatic<Model>;
      registry: WorkflowRegistry;
      logger: Logger;
      strict: boolean;
    },
  ) {}

  async loadFromDb(): Promise<{ loaded: number; skipped: number }> {
    let rows: any[] = [];
    const maxAttempts = 40;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        rows = await (this.deps.workflowModel as any).findAll({
          where: { deleted: false, archived: false },
          raw: true,
        });
        break;
      } catch (e: any) {
        const code = e?.original?.code || e?.parent?.code;
        if (code === '42P01') {
          const msg = '[workflows] DB registry requires workflow table; run `enginehq sync` before `enginehq start`';
          if (this.deps.strict) throw new Error(msg);
          this.deps.logger.warn(msg);
          return { loaded: 0, skipped: 0 };
        }

        const name = String(e?.name || '');
        const msg = String(e?.message || '');
        const transient =
          name.includes('SequelizeConnection') ||
          msg.includes('Connection terminated unexpectedly') ||
          msg.includes('ECONNREFUSED') ||
          msg.includes('server closed the connection unexpectedly') ||
          msg.includes('the database system is starting up');

        if (!transient || attempt === maxAttempts) throw e;
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    let loaded = 0;
    let skipped = 0;

    for (const row of rows || []) {
      const name = String((row as any).name || '').trim();
      if (!name) {
        skipped++;
        continue;
      }

      const enabled = asBool((row as any).enabled, true);
      if (!enabled) continue;

      const spec = (row as any).spec ?? null;
      if (!isWorkflowSpecLike(spec)) {
        const msg = `[workflows] Invalid workflow spec in DB for "${name}" (expected {triggers[], steps[]})`;
        if (this.deps.strict) throw new Error(msg);
        this.deps.logger.warn(msg);
        skipped++;
        continue;
      }

      this.deps.registry.register(name, spec);
      loaded++;
    }

    return { loaded, skipped };
  }
}

export function normalizeWorkflowsConfig(cfg: WorkflowsConfig | undefined): Required<Pick<WorkflowsConfig, 'enabled' | 'registry' | 'strict'>> & {
  db: { modelKey: string };
} {
  const enabled = cfg ? cfg.enabled !== false : false;
  const registry = cfg?.registry === 'db' ? 'db' : 'fs';
  const strict = cfg?.strict === true;
  const modelKey = String(cfg?.db?.modelKey || 'workflow');
  return { enabled, registry, strict, db: { modelKey } };
}
