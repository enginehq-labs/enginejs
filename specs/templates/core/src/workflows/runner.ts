import { Op, type Model, type ModelStatic, type Sequelize } from 'sequelize';

import type { Actor } from '../actors/types.js';
import type { EngineConfig } from '../config/types.js';
import { AclEngine } from '../acl/engine.js';
import { RlsEngine } from '../rls/engine.js';
import type { ServiceRegistry } from '../services/types.js';
import type { WorkflowRegistry } from '../services/types.js';
import type { WorkflowOutboxEvent, WorkflowOutboxStatus } from './types.js';
import type { WorkflowSpec, WorkflowStep, WorkflowValue } from './spec.js';
import type { RlsWhere } from '../rls/where.js';
import { rlsWhereToSequelize } from '../rls/toSequelizeWhere.js';
import { CrudService } from '../crud/service.js';

type Logger = {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
};

class WorkflowNonRetryableError extends Error {
  readonly nonRetryable = true;
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowNonRetryableError';
  }
}

function getPath(obj: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function resolveValue(v: WorkflowValue, ctx: { event: WorkflowOutboxEvent }): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'from' in v) {
    return getPath(ctx.event, String((v as any).from));
  }
  return v;
}

function safeFields(model: ModelStatic<Model>, updates: Record<string, unknown>): Record<string, unknown> {
  const attrs = (model as any).rawAttributes || {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (k in attrs) out[k] = v;
  }
  return out;
}

function safeWhere(model: ModelStatic<Model>, where: Record<string, unknown>): Record<string, unknown> {
  const attrs = (model as any).rawAttributes || {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(where)) {
    if (k in attrs) out[k] = v;
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function backoffMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const raw = baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(maxDelayMs, Math.max(baseDelayMs, Math.floor(raw)));
}

function normalizeWorkflowSpec(name: string, spec: unknown): WorkflowSpec | null {
  if (!spec || typeof spec !== 'object') return null;
  const triggers = (spec as any).triggers;
  const steps = (spec as any).steps;
  if (!Array.isArray(triggers) || !Array.isArray(steps)) return null;
  return { name, ...(spec as any) } as WorkflowSpec;
}

function matchesModelTrigger(spec: WorkflowSpec, evt: WorkflowOutboxEvent): boolean {
  for (const t of spec.triggers || []) {
    if (!t || typeof t !== 'object') continue;
    if ((t as any).type !== 'model') continue;
    if (String((t as any).model) !== evt.model) continue;
    const actions = Array.isArray((t as any).actions) ? (t as any).actions.map(String) : [];
    if (actions.includes(evt.action)) return true;
  }
  return false;
}

function matchesIntervalTrigger(spec: WorkflowSpec, evt: WorkflowOutboxEvent): boolean {
  if (evt.action !== 'interval') return false;
  const payload = evt.after as any;
  const unit = payload && typeof payload === 'object' ? String(payload.unit ?? '') : '';
  const value = payload && typeof payload === 'object' ? Number(payload.value ?? NaN) : NaN;
  if (!unit || !Number.isFinite(value)) return false;

  for (const t of spec.triggers || []) {
    if (!t || typeof t !== 'object') continue;
    if ((t as any).type !== 'interval') continue;
    if (String((t as any).unit) !== unit) continue;
    if (Number((t as any).value) !== value) continue;
    return true;
  }
  return false;
}

function matchesDatetimeTrigger(spec: WorkflowSpec, evt: WorkflowOutboxEvent): boolean {
  if (evt.action !== 'datetime') return false;
  const meta = evt.before as any;
  if (!meta || typeof meta !== 'object') return false;
  const field = String(meta.field ?? '');
  const direction = String(meta.direction ?? '');
  const unit = meta.unit != null ? String(meta.unit) : undefined;
  const value = meta.value != null ? Number(meta.value) : undefined;
  if (!field || !direction) return false;

  for (const t of spec.triggers || []) {
    if (!t || typeof t !== 'object') continue;
    if ((t as any).type !== 'datetime') continue;
    if (String((t as any).field) !== field) continue;
    if (String((t as any).direction) !== direction) continue;
    if (unit != null && String((t as any).unit) !== unit) continue;
    if (value != null && Number((t as any).value) !== value) continue;
    return true;
  }
  return false;
}

function inheritActor(evt: WorkflowOutboxEvent): Actor {
  return (
    (evt.actor as any) ??
    ({
      isAuthenticated: false,
      subjects: {},
      roles: [],
      claims: {},
    } satisfies Actor)
  );
}

function actorFor(spec: WorkflowSpec, evt: WorkflowOutboxEvent): { actor: Actor; mode: NonNullable<WorkflowSpec['actorMode']> } {
  const mode = spec.actorMode ?? 'inherit';
  if (mode === 'inherit') return { actor: inheritActor(evt), mode };
  if (mode === 'system') {
    return {
      actor: {
        isAuthenticated: true,
        subjects: {},
        roles: ['system'],
        claims: { system: true },
      },
      mode,
    };
  }

  const base = inheritActor(evt);
  const imp = spec.impersonate;
  if (!imp) throw new Error('Workflow actorMode=impersonate requires spec.impersonate');
  const id = getPath(evt, String(imp.idFrom));
  if (id == null || id === '') throw new Error(`Impersonation idFrom did not resolve: ${imp.idFrom}`);

  const subject = String(imp.subject);
  const type = String(imp.type ?? subject);
  const model = String(imp.model ?? subject);

  return {
    actor: {
      isAuthenticated: true,
      subjects: {
        ...(base.subjects || {}),
        [subject]: { type, model, id: id as any },
      },
      roles: base.roles || [],
      claims: { ...(base.claims || {}), impersonating: subject },
      ...(base.sessionId ? { sessionId: base.sessionId } : {}),
    },
    mode,
  };
}

export type WorkflowRunnerOptions = {
  claimLimit?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export class WorkflowRunner {
  constructor(
    private readonly deps: {
      sequelize: Sequelize;
      outboxModel: ModelStatic<Model>;
      models: Record<string, ModelStatic<Model>>;
      workflows: WorkflowRegistry;
      services: ServiceRegistry;
      logger: Logger;
    },
  ) {}

  private async setOutboxStatus(id: string | number, updates: Record<string, unknown>) {
    const out = safeFields(this.deps.outboxModel, updates);
    if (!Object.keys(out).length) return;
    await (this.deps.outboxModel as any).update(out, { where: { id } });
  }

  private async claimOne(id: string | number): Promise<boolean> {
    const updates: Record<string, unknown> = {
      status: 'processing',
      updated_at: nowIso(),
    };
    const safe = safeFields(this.deps.outboxModel, updates);
    const [count] = await (this.deps.outboxModel as any).update(safe, { where: { id, status: 'pending' } });
    return count === 1;
  }

  private async loadEventRow(id: string | number): Promise<WorkflowOutboxEvent | null> {
    const row = await (this.deps.outboxModel as any).findOne({ where: { id }, raw: true });
    if (!row) return null;
    const evt: WorkflowOutboxEvent = {
      id: row.id,
      model: String(row.model),
      action: String(row.action) as any,
      before: row.before ?? null,
      after: row.after ?? null,
      changedFields: (row.changed_fields ?? row.changedFields ?? []) as any,
      origin: row.origin ?? undefined,
      originChain: row.origin_chain ?? row.originChain ?? undefined,
      parentEventId: row.parent_event_id ?? row.parentEventId ?? undefined,
      actor: row.actor ?? undefined,
      status: String(row.status || 'pending') as WorkflowOutboxStatus,
      attempts: Number(row.attempts || 0),
      nextRunAt: row.next_run_at ?? row.nextRunAt ?? undefined,
    };
    return evt;
  }

  private listWorkflowNames(): string[] {
    return this.deps.workflows.list();
  }

  private getWorkflowSpec(name: string): WorkflowSpec | null {
    const raw = this.deps.workflows.get(name);
    return normalizeWorkflowSpec(name, raw);
  }

  private async runStep(step: WorkflowStep, ctx: { event: WorkflowOutboxEvent; actor: Actor }): Promise<void> {
    if (step.op === 'log') {
      this.deps.logger.info('[workflow]', step.message);
      return;
    }

    if (step.op === 'crud.create') {
      const crud = this.deps.services.resolve('crudService', { scope: 'singleton' }) as CrudService;
      const isSystem = ctx.actor?.claims?.system === true;
      const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(step.values || {})) values[k] = resolveValue(v, { event: ctx.event });
      try {
        await crud.create({
          actor: ctx.actor,
          modelKey: step.model,
          values,
          options: {
            runPipelines: step.options?.runPipelines !== false,
            runResponsePipeline: false,
            ...(isSystem ? { bypassAclRls: true } : {}),
          },
        });
      } catch (e) {
        const ce = CrudService.toCrudError(e);
        if (ce && ce.code >= 400 && ce.code < 500) throw new WorkflowNonRetryableError(`crud.create failed: ${ce.message}`);
        throw e;
      }
      return;
    }

    if (step.op === 'crud.list') {
      const crud = this.deps.services.resolve('crudService', { scope: 'singleton' }) as CrudService;
      const isSystem = ctx.actor?.claims?.system === true;
      try {
        await crud.list({
          actor: ctx.actor,
          modelKey: step.model,
          query: step.query as any,
          options: {
            runPipelines: step.options?.runPipelines !== false,
            runResponsePipeline: false,
            ...(isSystem ? { bypassAclRls: true } : {}),
          },
        });
      } catch (e) {
        const ce = CrudService.toCrudError(e);
        if (ce && ce.code >= 400 && ce.code < 500) throw new WorkflowNonRetryableError(`crud.list failed: ${ce.message}`);
        throw e;
      }
      return;
    }

    if (step.op === 'db.update') {
      const m = this.deps.models[step.model];
      if (!m) throw new Error(`Unknown model for db.update: ${step.model}`);
      const whereVal = resolveValue(step.where.value, { event: ctx.event });
      const set: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(step.set || {})) set[k] = resolveValue(v, { event: ctx.event });

      const isSystem = ctx.actor?.claims?.system === true;
      if (!isSystem) {
        const dsl = this.deps.services.resolve<any>('dsl', { scope: 'singleton' });
        const config = this.deps.services.resolve<EngineConfig>('config', { scope: 'singleton' });
        const modelSpec = dsl?.[step.model];
        if (!modelSpec) throw new WorkflowNonRetryableError(`Unknown model in DSL: ${step.model}`);

        const acl = new AclEngine();
        const aclRes = acl.can({ actor: ctx.actor, modelKey: step.model, modelSpec, action: 'update' });
        if (!aclRes.allow) throw new WorkflowNonRetryableError(`ACL denied for db.update: ${aclRes.reason}`);

        const rls = new RlsEngine(config.rls);
        const scope = rls.scope({ actor: ctx.actor, modelKey: step.model, action: 'update' });
        if (!scope.allow) throw new WorkflowNonRetryableError(`RLS denied for db.update: ${(scope as any).reason || 'denied'}`);

        const guard = rls.writeGuard({ actor: ctx.actor, modelKey: step.model, action: 'update' });
        if (!guard.allow) throw new WorkflowNonRetryableError(`RLS write denied for db.update: ${(guard as any).reason || 'denied'}`);

        if (guard.kind === 'scoped') {
          for (const [k, v] of Object.entries(guard.enforced)) {
            if (k in set && set[k] !== v) {
              throw new WorkflowNonRetryableError(`RLS write guard mismatch for ${step.model}.${k}`);
            }
            if (guard.mode === 'enforce' && !(k in set)) set[k] = v;
          }
        }

        const parts: any[] = [];
        parts.push(safeWhere(m, { [step.where.field]: whereVal as any }));
        if ((m as any).rawAttributes?.deleted) parts.push({ deleted: false });
        if ((m as any).rawAttributes?.archived) parts.push({ archived: false });
        if ((scope as any).where) parts.push(rlsWhereToSequelize({ sequelize: this.deps.sequelize, models: this.deps.models } as any, step.model, (scope as any).where as RlsWhere));
        if (guard.kind === 'scoped' && Object.keys(guard.enforced).length) parts.push(safeWhere(m, guard.enforced));
        const where = parts.length === 1 ? parts[0]! : { [Op.and]: parts.filter(Boolean) };

        const safeSet = safeFields(m, set);
        const [count] = await (m as any).update(safeSet, { where });
        if (Number(count || 0) === 0) throw new WorkflowNonRetryableError(`db.update updated 0 rows (scoped or not found)`);
        return;
      }

      const safeSet = safeFields(m, set);
      const [count] = await (m as any).update(safeSet, { where: safeWhere(m, { [step.where.field]: whereVal as any }) });
      if (Number(count || 0) === 0) throw new WorkflowNonRetryableError(`db.update updated 0 rows`);
      return;
    }

    if (step.op === 'custom') {
      const serviceName = `workflows.step.${step.name}`;
      if (!this.deps.services.has(serviceName)) throw new Error(`Missing workflow step service: ${serviceName}`);
      const fn = this.deps.services.resolve<any>(serviceName, { scope: 'job' });
      await fn({ event: ctx.event, actor: ctx.actor, args: step.args });
      return;
    }

    throw new Error(`Unknown workflow step op: ${(step as any).op}`);
  }

  private async executeEvent(evt: WorkflowOutboxEvent, opts: WorkflowRunnerOptions) {
    const workflowNames = this.listWorkflowNames();
    const matched: WorkflowSpec[] = [];
    for (const name of workflowNames) {
      const spec = this.getWorkflowSpec(name);
      if (!spec) continue;
      if (evt.originChain && evt.originChain.includes(name)) continue;
      if ((evt.action === 'create' || evt.action === 'update' || evt.action === 'delete') && evt.origin === name) continue;
      if (matchesModelTrigger(spec, evt) || matchesIntervalTrigger(spec, evt) || matchesDatetimeTrigger(spec, evt)) {
        matched.push(spec);
      }
    }

    if (!matched.length) {
      await this.setOutboxStatus(evt.id!, { status: 'done' });
      return;
    }

    for (const wf of matched) {
      const { actor, mode } = actorFor(wf, evt);
      if (mode === 'system') {
        this.deps.logger.info('[workflow] audited system actor', { workflow: wf.name, eventId: evt.id });
      } else if (mode === 'impersonate') {
        this.deps.logger.info('[workflow] audited impersonation', {
          workflow: wf.name,
          eventId: evt.id,
          subject: wf.impersonate?.subject,
        });
      }
      for (const step of wf.steps || []) {
        await this.runStep(step, { event: evt, actor });
      }
    }

    await this.setOutboxStatus(evt.id!, { status: 'done' });
  }

  async runOnce(opts: WorkflowRunnerOptions = {}): Promise<{ processed: number; claimed: number }> {
    const limit = opts.claimLimit ?? 10;
    const now = new Date();
    const dueWhere: any = { status: 'pending' };

    // Only filter by next_run_at when the column exists.
    if ((this.deps.outboxModel as any).rawAttributes?.next_run_at) {
      dueWhere[Op.or] = [{ next_run_at: null }, { next_run_at: { [Op.lte]: now } }];
    }

    const candidates = (await (this.deps.outboxModel as any).findAll({
      where: dueWhere,
      order: [['id', 'ASC']],
      limit,
      raw: true,
    })) as Array<Record<string, any>>;

    let claimed = 0;
    let processed = 0;

    for (const row of candidates) {
      const id = row.id as any;
      const ok = await this.claimOne(id);
      if (!ok) continue;
      claimed++;

      const evt = await this.loadEventRow(id);
      if (!evt) continue;

      const maxAttempts = opts.maxAttempts ?? 5;
      const baseDelayMs = opts.baseDelayMs ?? 1000;
      const maxDelayMs = opts.maxDelayMs ?? 60_000;

      try {
        await this.executeEvent(evt, opts);
        processed++;
      } catch (e) {
        const attempts = (evt.attempts ?? 0) + 1;
        this.deps.logger.error('[workflow] event failed', { id, error: String((e as any)?.message || e) });

        if ((e as any)?.nonRetryable) {
          await this.setOutboxStatus(id, { status: 'failed', attempts });
          continue;
        }

        if (attempts >= maxAttempts) {
          await this.setOutboxStatus(id, { status: 'failed', attempts });
        } else {
          const delay = backoffMs(attempts, baseDelayMs, maxDelayMs);
          const next = new Date(now.getTime() + delay).toISOString();
          await this.setOutboxStatus(id, { status: 'pending', attempts, next_run_at: next });
        }
      }
    }

    return { processed, claimed };
  }
}
