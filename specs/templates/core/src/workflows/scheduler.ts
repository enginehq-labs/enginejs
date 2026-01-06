import { Op, type Model, type ModelStatic } from 'sequelize';

import type { WorkflowRegistry } from '../services/types.js';
import type { WorkflowOutboxStore } from './outbox.js';
import type { WorkflowSpec, WorkflowTrigger } from './spec.js';
import type { WorkflowOutboxEvent } from './types.js';
import type { WorkflowSchedulerStore } from './schedulerStore.js';

type Logger = {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
};

function normalizeWorkflowSpec(name: string, spec: unknown): WorkflowSpec | null {
  if (!spec || typeof spec !== 'object') return null;
  const triggers = (spec as any).triggers;
  const steps = (spec as any).steps;
  if (!Array.isArray(triggers) || !Array.isArray(steps)) return null;
  return { name, ...(spec as any) } as WorkflowSpec;
}

function splitModelField(s: string): { modelKey: string; field: string } | null {
  const parts = String(s || '').split('.');
  if (parts.length < 2) return null;
  const modelKey = parts[0]!.trim();
  const field = parts.slice(1).join('.').trim();
  if (!modelKey || !field) return null;
  return { modelKey, field };
}

function getPrimaryKeyField(model: ModelStatic<Model>): string {
  const pk = (model as any).primaryKeyAttribute;
  if (typeof pk === 'string' && pk) return pk;
  const pks = (model as any).primaryKeyAttributes;
  if (Array.isArray(pks) && pks[0]) return String(pks[0]);
  return 'id';
}

function addUnit(date: Date, unit: string, value: number): Date {
  const d = new Date(date.getTime());
  const v = Number(value || 0);
  if (!Number.isFinite(v) || v === 0) return d;
  if (unit === 'minutes') return new Date(d.getTime() + v * 60_000);
  if (unit === 'hours') return new Date(d.getTime() + v * 3_600_000);
  if (unit === 'days') return new Date(d.getTime() + v * 86_400_000);
  if (unit === 'weeks') return new Date(d.getTime() + v * 7 * 86_400_000);
  if (unit === 'months') {
    d.setMonth(d.getMonth() + v);
    return d;
  }
  if (unit === 'years') {
    d.setFullYear(d.getFullYear() + v);
    return d;
  }
  return new Date(d.getTime() + v * 60_000);
}

function activeFilters(model: ModelStatic<Model>): Record<string, unknown> {
  const attrs = (model as any).rawAttributes || {};
  return {
    ...(attrs.deleted ? { deleted: false } : {}),
    ...(attrs.archived ? { archived: false } : {}),
  };
}

export type WorkflowSchedulerOptions = {
  now?: Date;
  lookbackMs?: number;
  lookaheadMs?: number;
  limitPerDatetimeTrigger?: number;
};

export class WorkflowScheduler {
  constructor(
    private readonly deps: {
      outbox: WorkflowOutboxStore;
      workflows: WorkflowRegistry;
      models: Record<string, ModelStatic<Model>>;
      logger: Logger;
      store?: WorkflowSchedulerStore;
    },
  ) {}

  private async enqueue(evt: WorkflowOutboxEvent) {
    await this.deps.outbox.enqueue(evt);
  }

  private async maybeEmitInterval(unit: string, value: number, now: Date): Promise<boolean> {
    const key = `interval:${unit}:${value}`;
    const lastIso = this.deps.store ? await this.deps.store.get(key) : null;
    const due = lastIso ? now.getTime() >= addUnit(new Date(lastIso), unit, value).getTime() : true;
    if (!due) return false;

    await this.enqueue({
      model: '__scheduler',
      action: 'interval',
      before: null,
      after: { unit, value, at: now.toISOString() },
      changedFields: [],
      origin: 'scheduler',
      status: 'pending',
      attempts: 0,
    });
    await this.deps.store?.set(key, now.toISOString());
    return true;
  }

  private async emitDatetimeForTrigger(specName: string, trigger: Extract<WorkflowTrigger, { type: 'datetime' }>, opts: Required<WorkflowSchedulerOptions>) {
    const parsed = splitModelField(trigger.field);
    if (!parsed) {
      this.deps.logger.warn('[scheduler] invalid datetime trigger field', { workflow: specName, field: trigger.field });
      return 0;
    }
    const { modelKey, field } = parsed;
    const model = this.deps.models[modelKey];
    if (!model) {
      this.deps.logger.warn('[scheduler] datetime trigger model not found', { workflow: specName, modelKey });
      return 0;
    }
    if (!(model as any).rawAttributes?.[field]) {
      this.deps.logger.warn('[scheduler] datetime trigger field not found', { workflow: specName, modelKey, field });
      return 0;
    }

    const now = opts.now;
    const fireLower = new Date(now.getTime() - opts.lookbackMs);
    const fireUpper = new Date(now.getTime() + opts.lookaheadMs);

    const direction = trigger.direction;
    const unit = trigger.unit;
    const value = trigger.value;

    let colLower = fireLower;
    let colUpper = fireUpper;
    if (direction === 'before') {
      if (!unit || value == null) {
        this.deps.logger.warn('[scheduler] datetime before trigger missing unit/value', { workflow: specName, field: trigger.field });
        return 0;
      }
      colLower = addUnit(fireLower, unit, value);
      colUpper = addUnit(fireUpper, unit, value);
    } else if (direction === 'after') {
      if (!unit || value == null) {
        this.deps.logger.warn('[scheduler] datetime after trigger missing unit/value', { workflow: specName, field: trigger.field });
        return 0;
      }
      colLower = addUnit(fireLower, unit, -value);
      colUpper = addUnit(fireUpper, unit, -value);
    }

    const rows = (await (model as any).findAll({
      where: {
        ...activeFilters(model),
        [field]: { [Op.ne]: null, [Op.gte]: colLower, [Op.lte]: colUpper },
      },
      order: [[getPrimaryKeyField(model), 'ASC']],
      limit: opts.limitPerDatetimeTrigger,
      raw: true,
    })) as Array<Record<string, any>>;

    const pkField = getPrimaryKeyField(model);
    let emitted = 0;

    for (const row of rows) {
      const tsRaw = row[field];
      const ts = tsRaw instanceof Date ? tsRaw : new Date(String(tsRaw));
      if (!Number.isFinite(ts.getTime())) continue;

      let fireAt = ts;
      if (direction === 'before') fireAt = addUnit(ts, unit!, -value!);
      else if (direction === 'after') fireAt = addUnit(ts, unit!, value!);

      if (fireAt.getTime() < fireLower.getTime() || fireAt.getTime() > fireUpper.getTime()) continue;

      const fireAtIso = fireAt.toISOString();
      const dedupeKey = `datetime:${specName}:${modelKey}:${String(row[pkField] ?? '')}:${trigger.field}:${direction}:${fireAtIso}`;
      if (this.deps.store) {
        const ok = await this.deps.store.setIfAbsent(dedupeKey, now.toISOString());
        if (!ok) continue;
      }

      const meta = {
        field: trigger.field,
        direction,
        ...(unit ? { unit } : {}),
        ...(value != null ? { value } : {}),
        fireAt: fireAtIso,
      };

      await this.enqueue({
        model: modelKey,
        action: 'datetime',
        before: meta,
        after: row,
        changedFields: [],
        origin: 'scheduler',
        status: 'pending',
        attempts: 0,
        nextRunAt: fireAtIso,
      });
      emitted++;
    }

    return emitted;
  }

  async runOnce(opts: WorkflowSchedulerOptions = {}): Promise<{ intervalEmitted: number; datetimeEmitted: number }> {
    const now = opts.now ?? new Date();
    const lookbackMs = opts.lookbackMs ?? 86_400_000;
    const lookaheadMs = opts.lookaheadMs ?? 0;
    const limitPerDatetimeTrigger = opts.limitPerDatetimeTrigger ?? 200;

    const resolved: Required<WorkflowSchedulerOptions> = { now, lookbackMs, lookaheadMs, limitPerDatetimeTrigger };

    const intervalKeys = new Map<string, { unit: string; value: number }>();
    const workflowNames = this.deps.workflows.list();
    const datetimeTriggers: Array<{ workflow: string; trigger: Extract<WorkflowTrigger, { type: 'datetime' }> }> = [];

    for (const name of workflowNames) {
      const spec = normalizeWorkflowSpec(name, this.deps.workflows.get(name));
      if (!spec) continue;
      for (const t of spec.triggers || []) {
        if (!t || typeof t !== 'object') continue;
        if ((t as any).type === 'interval') {
          const unit = String((t as any).unit ?? '');
          const value = Number((t as any).value ?? NaN);
          if (!unit || !Number.isFinite(value)) continue;
          intervalKeys.set(`${unit}:${value}`, { unit, value });
        } else if ((t as any).type === 'datetime') {
          datetimeTriggers.push({ workflow: name, trigger: t as any });
        }
      }
    }

    let intervalEmitted = 0;
    for (const { unit, value } of intervalKeys.values()) {
      if (await this.maybeEmitInterval(unit, value, now)) intervalEmitted++;
    }

    let datetimeEmitted = 0;
    for (const { workflow, trigger } of datetimeTriggers) {
      datetimeEmitted += await this.emitDatetimeForTrigger(workflow, trigger, resolved);
    }

    return { intervalEmitted, datetimeEmitted };
  }
}

