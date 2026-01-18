import type { Model, ModelStatic } from 'sequelize';

import type { Actor } from '../actors/types.js';
import type { EngineConfig } from '../config/types.js';
import { AclEngine } from '../acl/engine.js';
import { RlsEngine } from '../rls/engine.js';
import { rlsWhereToSequelize } from '../rls/toSequelizeWhere.js';
import type { OrmInitResult } from '../orm/types.js';
import type { DslModelSpec, DslRoot } from '../dsl/types.js';
import { isDslModelSpec } from '../dsl/types.js';
import { PipelineEngine } from '../pipelines/engine.js';
import type { WorkflowEngine } from '../workflows/engine.js';
import type { PipelineRegistry, ServiceRegistry } from '../services/types.js';
import { parseListQuery } from '../query/parser.js';
import { QueryParseError } from '../query/errors.js';
import type { FilterExpr, ListQueryAst, SortSpec } from '../query/types.js';
import { PipelineValidationError } from '../pipelines/errors.js';

import { CrudBadRequestError, CrudForbiddenError, CrudNotFoundError } from './errors.js';
import type { CrudCallOptions, CrudCtx, CrudListQuery, CrudListResult } from './types.js';

function getSequelizeLib(orm: OrmInitResult) {
  const Seq = (orm.sequelize as any).Sequelize ?? (orm.sequelize as any).constructor;
  const Op = (Seq as any).Op;
  return {
    Op,
  };
}

function getPrimaryKeyField(model: ModelStatic<Model>): string {
  const pk = (model as any).primaryKeyAttributes?.[0];
  return String(pk || 'id');
}

function stripVirtualFields(spec: DslModelSpec, payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  for (const [k, f] of Object.entries(spec.fields || {})) {
    if (f && typeof f === 'object' && (f as any).save === false) delete out[k];
  }
  return out;
}

const RESTRICT_UNKNOWN_FIELDS = String(process.env.restrict_unknown_fields ?? '').trim() !== '0';

function pruneUnknownPayload(spec: DslModelSpec, payload: Record<string, unknown>): Record<string, unknown> {
  if (!RESTRICT_UNKNOWN_FIELDS) return { ...payload };
  const allowed = new Set(Object.keys(spec.fields || {}));
  if (!allowed.size) return { ...payload };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (allowed.has(k)) out[k] = v;
  }
  return out;
}

function parseArrayish(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw == null) return [];
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }
  return [raw];
}

function normalizePayloadMultiFields(spec: DslModelSpec, payload: Record<string, unknown>): {
  body: Record<string, unknown>;
  joinPayloads: Record<string, Array<number>>;
} {
  const body: Record<string, unknown> = { ...payload };
  const joinPayloads: Record<string, Array<number>> = {};

  for (const [field, f] of Object.entries(spec.fields || {})) {
    if (!f || typeof f !== 'object') continue;
    const rawVal = body[field];
    if (rawVal === undefined) continue;

    if ((f as any).multi === true && String((f as any).type || '').toLowerCase() === 'string') {
      const arr = parseArrayish(rawVal).map((v) => String(v));
      body[field] = arr;
      continue;
    }

    const isMultiIntFk =
      (f as any).multi === true &&
      ((f as any).type === 'int' || (f as any).type === 'integer' || (f as any).type === 'bigint') &&
      (f as any).source &&
      (f as any).sourceid;

    if (isMultiIntFk) {
      const arr = parseArrayish(rawVal)
        .map((v) => {
          const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10);
          return Number.isFinite(n) ? n : null;
        })
        .filter((n) => n != null) as number[];
      joinPayloads[field] = arr;
      delete body[field];
    }
  }

  return { body, joinPayloads };
}

function coerceEmptyToNull(spec: DslModelSpec, payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  for (const [field, f] of Object.entries(spec.fields || {})) {
    if (!f || typeof f !== 'object') continue;
    const type = String((f as any).type || '').toLowerCase();
    const isNumeric = ['int', 'integer', 'bigint', 'float', 'decimal', 'number'].includes(type);
    const isDatetime = type === 'date' || type === 'datetime';
    const isBool = type === 'boolean';
    if (!isNumeric && !isDatetime && !isBool) continue;
    const val = out[field];
    if (val === '' || (typeof val === 'string' && val.trim() === '')) out[field] = null;
  }
  return out;
}

function computeAutoName(dsl: DslRoot, modelKey: string, row: Record<string, unknown>): string | null {
  const spec = dsl[modelKey];
  if (!isDslModelSpec(spec)) return null;
  const fields = Array.isArray((spec as any).auto_name) ? ((spec as any).auto_name as string[]) : [];
  const parts: string[] = [];
  for (const f of fields) {
    const v = row?.[f];
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    parts.push(s);
  }
  if (!parts.length) return null;
  return parts.join('_');
}

async function applyJoinUpdates({
  orm,
  modelKey,
  spec,
  instance,
  joinPayloads,
  transaction,
}: {
  orm: OrmInitResult;
  modelKey: string;
  spec: DslModelSpec;
  instance: any;
  joinPayloads: Record<string, number[]>;
  transaction?: any;
}) {
  const { Op } = getSequelizeLib(orm);
  const pk = getPrimaryKeyField(instance.constructor as any);
  const ownerId = instance?.get ? instance.get(pk) : instance?.[pk];
  const now = new Date();
  for (const [field, ids] of Object.entries(joinPayloads)) {
    const f = spec.fields?.[field] as any;
    const isMultiIntFk =
      f &&
      f.multi === true &&
      (f.type === 'int' || f.type === 'integer' || f.type === 'bigint') &&
      f.source &&
      f.sourceid;
    if (!isMultiIntFk) continue;
    const joinName = `${modelKey}__${field}__to__${String(f.source)}__${String(f.sourceid)}`;
    const Join = (orm.models as any)[joinName];
    if (!Join) continue;
    const ownerIdCol = `${modelKey}Id`;
    const sourceIdCol = `${String(f.source)}Id`;
    const desired = new Set(ids || []);

    const rows = (await Join.findAll({
      where: { [ownerIdCol]: ownerId },
      transaction,
    })) as Array<Record<string, any>>;

    const bySource = new Map<any, Array<any>>();
    for (const r of rows) {
      const sid = r?.get ? r.get(sourceIdCol) : r?.[sourceIdCol];
      if (!bySource.has(sid)) bySource.set(sid, []);
      bySource.get(sid)!.push(r);
    }

    for (const sid of desired) {
      const existing = bySource.get(sid) || [];
      const active = existing.find((r) => !r.deleted && !r.archived);
      if (active) continue;
      const archivedRow = existing.find((r) => r.deleted || r.archived);
      if (archivedRow && f.unique) {
        await archivedRow.update(
          { deleted: false, archived: false, deleted_at: null, archived_at: null, updated_at: now },
          { transaction },
        );
      } else {
        await Join.create(
          { [ownerIdCol]: ownerId, [sourceIdCol]: sid, created_at: now, updated_at: now, deleted: false, archived: false },
          { transaction },
        );
      }
    }

    for (const r of rows) {
      const sid = r?.get ? r.get(sourceIdCol) : r?.[sourceIdCol];
      if (!r.deleted && !r.archived && !desired.has(sid)) {
        await r.update({ archived: true, archived_at: now, updated_at: now }, { transaction });
      }
    }
  }
}

async function attachJunctionIds({
  orm,
  modelKey,
  spec,
  pk,
  rows,
}: {
  orm: OrmInitResult;
  modelKey: string;
  spec: DslModelSpec;
  pk: string;
  rows: Array<Record<string, any>>;
}) {
  const { Op } = getSequelizeLib(orm);
  const junctionFields = Object.entries(spec.fields || {}).filter(([, f]) => (f as any)?.multi === true && (f as any)?.source && (f as any)?.sourceid && ['int', 'integer', 'bigint'].includes(String((f as any)?.type || '').toLowerCase()));
  if (!junctionFields.length || !rows.length) return;

  const ownerIdCol = `${modelKey}Id`;
  const ownerIds = [...new Set(rows.map((r) => r[pk]).filter((x) => x != null))] as Array<string | number>;
  if (!ownerIds.length) return;

  for (const [field, f] of junctionFields) {
    const joinName = `${modelKey}__${field}__to__${String((f as any).source)}__${String((f as any).sourceid)}`;
    const joinModel = (orm.models as any)[joinName];
    if (!joinModel) continue;
    const sourceIdCol = `${String((f as any).source)}Id`;

    const joinRows = (await joinModel.findAll({
      where: { [ownerIdCol]: { [Op.in]: ownerIds }, deleted: false, archived: false },
      attributes: [ownerIdCol, sourceIdCol],
      raw: true,
    })) as Array<Record<string, any>>;

    const map = new Map<string | number, Array<string | number>>();
    for (const jr of joinRows) {
      const ownerId = jr[ownerIdCol] as any;
      const sourceId = jr[sourceIdCol] as any;
      if (ownerId == null || sourceId == null) continue;
      const arr = map.get(ownerId) ?? [];
      arr.push(sourceId);
      map.set(ownerId, arr);
    }
    for (const r of rows) {
      const id = r[pk];
      const arr = map.get(id) ?? [];
      arr.sort((a: any, b: any) => (a > b ? 1 : a < b ? -1 : 0));
      r[field] = arr;
    }
  }
}

async function addFkAutoNames({
  orm,
  dsl,
  modelKey,
  rows,
}: {
  orm: OrmInitResult;
  dsl: DslRoot;
  modelKey: string;
  rows: Array<Record<string, any>>;
}) {
  const spec = dsl[modelKey];
  if (!isDslModelSpec(spec)) return;
  const targets: Array<{ field: string; source: string; sourceid: string }> = [];
  for (const [field, f] of Object.entries(spec.fields || {})) {
    if (!f || typeof f !== 'object') continue;
    if ((f as any).multi === true) continue;
    const source = (f as any).source;
    const sourceid = (f as any).sourceid;
    if (source && sourceid) targets.push({ field, source: String(source), sourceid: String(sourceid) });
  }
  if (!targets.length || !rows.length) return;

  for (const target of targets) {
    const targetSpec = dsl[target.source];
    const targetModel = (orm.models as any)[target.source];
    if (!isDslModelSpec(targetSpec) || !targetModel) continue;

    const ids = [...new Set(rows.map((r) => r[target.field]).filter((v) => v != null))];
    if (!ids.length) continue;

    const where: any = { [target.sourceid]: { [getSequelizeLib(orm).Op.in]: ids } };
    if ((targetModel as any).rawAttributes?.deleted) where.deleted = false;
    if ((targetModel as any).rawAttributes?.archived) where.archived = false;

    const found = (await targetModel.findAll({
      where,
      attributes: [target.sourceid, 'auto_name'],
      raw: true,
    })) as Array<Record<string, any>>;
    const map = new Map<any, string | null>();
    for (const r of found) map.set(r[target.sourceid], r.auto_name ?? null);
    for (const row of rows) {
      const v = row[target.field];
      row[`${target.field}_auto_name`] = map.has(v) ? map.get(v) ?? null : null;
    }
  }
}

function pruneRowToDsl(spec: DslModelSpec, row: Record<string, any>): Record<string, any> {
  const allowed = new Set(Object.keys(spec.fields || {}));
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (allowed.has(k) || k.endsWith('_auto_name')) out[k] = v;
  }
  return out;
}

function applyWriteGuard(args: { guard: any; payload: Record<string, unknown> }): Record<string, unknown> {
  const { guard } = args;
  const payload = { ...args.payload };
  if (!guard || guard.kind !== 'scoped') return payload;

  const errors: Record<string, string> = {};
  for (const [k, v] of Object.entries(guard.enforced || {})) {
    if (guard.mode === 'enforce') payload[k] = v;
    else if (k in payload && payload[k] !== v) errors[k] = 'Forbidden';
  }
  if (Object.keys(errors).length) {
    const e = new CrudForbiddenError('RLS write guard');
    (e as any).errors = errors;
    throw e;
  }
  return payload;
}

function modelSpec(dsl: DslRoot, modelKey: string): DslModelSpec {
  const spec = dsl[modelKey];
  if (!isDslModelSpec(spec)) throw new CrudNotFoundError(`Unknown model: ${modelKey}`);
  return spec;
}

function getModel(orm: OrmInitResult, modelKey: string): ModelStatic<Model> {
  const m = (orm.models as any)[modelKey] as ModelStatic<Model> | undefined;
  if (!m) throw new CrudNotFoundError(`Unknown model: ${modelKey}`);
  return m;
}

function filtersToWhere(ast: ListQueryAst, orm: OrmInitResult, model: ModelStatic<Model>): any {
  const { Op } = getSequelizeLib(orm);
  const parts: any[] = [];

  const fieldExists = (field: string) => (model as any).rawAttributes?.[field] != null;

  for (const group of ast.filters || []) {
    const field = String(group.field);
    if (!fieldExists(field)) continue;

    const ors: any[] = [];
    for (const expr of group.or || []) {
      const e = expr as FilterExpr;
      const op = String((e as any).op);
      if (op === 'eq') ors.push({ [field]: (e as any).value });
      else if (op === 'ne') ors.push({ [field]: { [Op.ne]: (e as any).value } });
      else if (op === 'gt') ors.push({ [field]: { [Op.gt]: (e as any).value } });
      else if (op === 'gte') ors.push({ [field]: { [Op.gte]: (e as any).value } });
      else if (op === 'lt') ors.push({ [field]: { [Op.lt]: (e as any).value } });
      else if (op === 'lte') ors.push({ [field]: { [Op.lte]: (e as any).value } });
      else if (op === 'like') {
        const v = String((e as any).value || '').replace(/\*/g, '%');
        ors.push({ [field]: { [Op.iLike]: v } });
      } else if (op === 'range') {
        const ands: any[] = [];
        if ((e as any).min !== undefined) ands.push({ [field]: { [Op.gte]: (e as any).min } });
        if ((e as any).max !== undefined) ands.push({ [field]: { [Op.lte]: (e as any).max } });
        if (ands.length === 1) ors.push(ands[0]);
        else if (ands.length > 1) ors.push({ [Op.and]: ands });
      }
    }

    if (ors.length === 1) parts.push(ors[0]);
    else if (ors.length > 1) parts.push({ [Op.or]: ors });
  }

  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : { [Op.and]: parts };
}

function sortToOrder(sort: SortSpec[], pkField: string, spec?: DslModelSpec): any[] {
  const out: any[] = [];
  const addToken = (field: string, dir: string) => {
    if (!field) return;
    out.push([field, dir]);
  };

  if (Array.isArray(sort) && sort.length) {
    for (const s of sort || []) {
      const field = String(s.field);
      const dir = String(s.dir) === 'desc' ? 'DESC' : 'ASC';
      addToken(field, dir);
    }
  } else if (Array.isArray((spec as any)?.ui?.sort)) {
    for (const tok of ((spec as any)?.ui?.sort as any[]) || []) {
      const t = String(tok || '').trim();
      if (!t) continue;
      const dir = t.startsWith('-') ? 'DESC' : 'ASC';
      const field = t.replace(/^[+-]/, '').trim();
      addToken(field, dir);
    }
  }

  // deterministic tiebreaker
  if (!out.length) out.push([pkField, 'DESC']);
  if (!out.some((x) => String(x?.[0]) === pkField)) out.push([pkField, 'DESC']);
  return out;
}

export class CrudService {
  private readonly pipelines = new PipelineEngine({
    getModelSpec: (dsl: unknown, modelKey: string) => {
      if (!dsl || typeof dsl !== 'object') return null;
      const s = (dsl as any)[modelKey];
      if (!isDslModelSpec(s)) return null;
      return s as any;
    },
  });

  constructor(
    private readonly deps: {
      services: ServiceRegistry;
    },
  ) {}

  private getConfig(): EngineConfig {
    return this.deps.services.resolve('config', { scope: 'singleton' }) as EngineConfig;
  }

  private getDsl(): DslRoot {
    return this.deps.services.resolve('dsl', { scope: 'singleton' }) as DslRoot;
  }

  private getOrm(): OrmInitResult {
    return this.deps.services.resolve('orm', { scope: 'singleton' }) as OrmInitResult;
  }

  private getPipelineRegistry(): PipelineRegistry | null {
    if (!this.deps.services.has('pipelines')) return null;
    return this.deps.services.resolve('pipelines', { scope: 'singleton' }) as PipelineRegistry;
  }

  private pipelineServices() {
    const svcs = this.deps.services;
    return {
      has: (name: string) => svcs.has(name),
      get: <T>(name: string) => svcs.resolve<T>(name, { scope: 'singleton' }),
    };
  }

  private async emitWorkflow(args: { model: string; action: 'create' | 'update' | 'delete'; before: any; after: any; actor?: any }) {
    if (!this.deps.services.has('workflowEngine')) return;
    const engine = this.deps.services.resolve<WorkflowEngine>('workflowEngine', { scope: 'singleton' });
    await engine.emitModelEvent({
      model: args.model,
      action: args.action,
      before: args.before,
      after: args.after,
      actor: args.actor,
    });
  }

  async list(args: CrudCtx & { modelKey: string; query?: CrudListQuery; options?: CrudCallOptions }): Promise<CrudListResult> {
    const orm = this.getOrm();
    const dsl = this.getDsl();
    const config = this.getConfig();
    const spec = modelSpec(dsl, args.modelKey);
    const model = getModel(orm, args.modelKey);
    const { Op } = getSequelizeLib(orm);

    const bypass = args.options?.bypassAclRls === true;
    if (!bypass) {
      const acl = new AclEngine();
      const aclRes = acl.can({ actor: args.actor, modelKey: args.modelKey, modelSpec: spec, action: 'read' });
      if (!aclRes.allow) throw new CrudForbiddenError(aclRes.reason || 'ACL denied');

      const rls = new RlsEngine(config.rls);
      const scope = rls.scope({ actor: args.actor, modelKey: args.modelKey, action: 'list' });
      if (!scope.allow) throw new CrudForbiddenError((scope as any).reason || 'RLS denied');

      const q = args.query || {};
      const ast = parseListQuery({
        ...(q.includeDeleted ? { includeDeleted: '1' } : {}),
        ...(q.includeArchived ? { includeArchived: '1' } : {}),
        ...(q.includeDepth != null ? { includeDepth: String(q.includeDepth) } : {}),
        ...(q.page != null ? { page: String(q.page) } : {}),
        ...(q.limit != null ? { limit: String(q.limit) } : {}),
        ...(q.sort != null ? { sort: String(q.sort) } : {}),
        ...(q.filters != null ? { filters: String(q.filters) } : {}),
        ...(q.find != null ? { find: String(q.find) } : {}),
      });

      const whereParts: any[] = [];
      if (!ast.includeDeleted && (model as any).rawAttributes?.deleted) whereParts.push({ deleted: false });
      if (!ast.includeArchived && (model as any).rawAttributes?.archived) whereParts.push({ archived: false });
      const scopeWhere = rlsWhereToSequelize(orm, args.modelKey, (scope as any).where);
      if (scopeWhere) whereParts.push(scopeWhere);
      const filterWhere = filtersToWhere(ast, orm, model);
      if (filterWhere) whereParts.push(filterWhere);
      const where = whereParts.length <= 1 ? (whereParts[0] ?? {}) : { [Op.and]: whereParts };

      const pk = getPrimaryKeyField(model);
      const limit = ast.limit;
      const offset = limit > 0 ? (ast.page - 1) * limit : undefined;
      const order = sortToOrder(ast.sort, pk, spec);

      const rows = (await (model as any).findAll({
        where,
        ...(limit > 0 ? { limit, offset } : {}),
        order,
        raw: true,
      })) as Array<Record<string, unknown>>;

      if (ast.includeDepth === 0) {
        await attachJunctionIds({ orm, modelKey: args.modelKey, spec, pk, rows: rows as any });
        await addFkAutoNames({ orm, dsl, modelKey: args.modelKey, rows: rows as any });
      }
      const totalCount = (await (model as any).count({ where })) as number;
      const pagination =
        limit === 0
          ? null
          : {
              limit,
              totalCount,
              totalPages: Math.max(1, Math.ceil(totalCount / limit)),
              currentPage: ast.page,
              nextPage: ast.page < Math.max(1, Math.ceil(totalCount / limit)) ? ast.page + 1 : null,
              previousPage: ast.page > 1 ? ast.page - 1 : null,
            };

      let outRows = rows;
      const runPipelines = args.options?.runPipelines !== false;
      const runResponsePipeline = args.options?.runResponsePipeline !== false;
      if (runPipelines && runResponsePipeline) {
        const registry = this.getPipelineRegistry();
        const services = args.options?.services ?? this.pipelineServices();
        const acl = new AclEngine();
        outRows = rows.map((r) => {
          const piped = this.pipelines.runPhase({
            dsl,
            registrySpec: registry?.get?.(args.modelKey),
            action: 'list',
            phase: 'response',
            modelKey: args.modelKey,
            actor: args.actor,
            input: r as any,
            services,
          }).output;
          return pruneRowToDsl(spec, acl.pruneRead(piped));
        });
      } else {
        outRows = rows.map((r) => pruneRowToDsl(spec, r as any));
      }

      return {
        rows: outRows,
        pagination,
      };
    }

    // bypass mode: no ACL/RLS, still apply default filters unless overridden
    let ast: ListQueryAst;
    try {
      const q = args.query || {};
      ast = parseListQuery({
        ...(q.includeDeleted ? { includeDeleted: '1' } : {}),
        ...(q.includeArchived ? { includeArchived: '1' } : {}),
        ...(q.includeDepth != null ? { includeDepth: String(q.includeDepth) } : {}),
        ...(q.page != null ? { page: String(q.page) } : {}),
        ...(q.limit != null ? { limit: String(q.limit) } : {}),
        ...(q.sort != null ? { sort: String(q.sort) } : {}),
        ...(q.filters != null ? { filters: String(q.filters) } : {}),
        ...(q.find != null ? { find: String(q.find) } : {}),
      });
    } catch (e) {
      if (e instanceof QueryParseError) throw new CrudBadRequestError(e.message);
      throw e;
    }

    const whereParts: any[] = [];
    if (!ast.includeDeleted && (model as any).rawAttributes?.deleted) whereParts.push({ deleted: false });
    if (!ast.includeArchived && (model as any).rawAttributes?.archived) whereParts.push({ archived: false });
    const filterWhere = filtersToWhere(ast, orm, model);
    if (filterWhere) whereParts.push(filterWhere);
    const where = whereParts.length <= 1 ? (whereParts[0] ?? {}) : { [Op.and]: whereParts };

    const pk = getPrimaryKeyField(model);
    const limit = ast.limit;
    const offset = limit > 0 ? (ast.page - 1) * limit : undefined;
    const order = sortToOrder(ast.sort, pk, spec);
    const rows = (await (model as any).findAll({
      where,
      ...(limit > 0 ? { limit, offset } : {}),
      order,
      raw: true,
    })) as Array<Record<string, unknown>>;
    if (ast.includeDepth === 0) {
      await attachJunctionIds({ orm, modelKey: args.modelKey, spec, pk, rows: rows as any });
      await addFkAutoNames({ orm, dsl, modelKey: args.modelKey, rows: rows as any });
    }
    const totalCount = (await (model as any).count({ where })) as number;
    const pagination =
      limit === 0
        ? null
        : {
            limit,
            totalCount,
            totalPages: Math.max(1, Math.ceil(totalCount / limit)),
            currentPage: ast.page,
            nextPage: ast.page < Math.max(1, Math.ceil(totalCount / limit)) ? ast.page + 1 : null,
            previousPage: ast.page > 1 ? ast.page - 1 : null,
          };
    const prunedRows = rows.map((r) => pruneRowToDsl(spec, r as any));
    return {
      rows: prunedRows,
      pagination,
    };
  }

  async create(args: CrudCtx & { modelKey: string; values: Record<string, unknown>; options?: CrudCallOptions }): Promise<Record<string, unknown>> {
    const orm = this.getOrm();
    const dsl = this.getDsl();
    const config = this.getConfig();
    const spec = modelSpec(dsl, args.modelKey);
    const model = getModel(orm, args.modelKey);

    const bypass = args.options?.bypassAclRls === true;
    if (!bypass) {
      const acl = new AclEngine();
      const aclRes = acl.can({ actor: args.actor, modelKey: args.modelKey, modelSpec: spec, action: 'create' });
      if (!aclRes.allow) throw new CrudForbiddenError(aclRes.reason || 'ACL denied');

      const rls = new RlsEngine(config.rls);
      const guard = rls.writeGuard({ actor: args.actor, modelKey: args.modelKey, action: 'create' });
      if (!guard.allow) throw new CrudForbiddenError((guard as any).reason || 'RLS denied');

      const runPipelines = args.options?.runPipelines !== false;
      const registry = this.getPipelineRegistry();
      const services = args.options?.services ?? this.pipelineServices();

      let payload = pruneUnknownPayload(spec, { ...args.values });
      const { body: normalizedBody, joinPayloads } = normalizePayloadMultiFields(spec, payload);
      payload = applyWriteGuard({ guard, payload: normalizedBody });
      payload = coerceEmptyToNull(spec, payload);
      const autoName = computeAutoName(dsl, args.modelKey, payload);
      if (autoName !== null) payload.auto_name = autoName;
      if (runPipelines) {
        payload = this.pipelines.runPhase({
          dsl,
          registrySpec: registry?.get?.(args.modelKey),
          action: 'create',
          phase: 'beforeValidate',
          modelKey: args.modelKey,
          actor: args.actor,
          input: payload,
          services,
        }).output;
        this.pipelines.runPhase({
          dsl,
          registrySpec: registry?.get?.(args.modelKey),
          action: 'create',
          phase: 'validate',
          modelKey: args.modelKey,
          actor: args.actor,
          input: payload,
          services,
        });
        payload = this.pipelines.runPhase({
          dsl,
          registrySpec: registry?.get?.(args.modelKey),
          action: 'create',
          phase: 'beforePersist',
          modelKey: args.modelKey,
          actor: args.actor,
          input: payload,
          services,
        }).output;
      }

      payload = stripVirtualFields(spec, payload);
      const created = await (model as any).create(payload);
      let row = (created as any)?.get ? (created as any).get({ plain: true }) : created;

      await applyJoinUpdates({
        orm,
        modelKey: args.modelKey,
        spec,
        instance: created,
        joinPayloads,
      });

      if (runPipelines) {
        row = this.pipelines.runPhase({
          dsl,
          registrySpec: registry?.get?.(args.modelKey),
          action: 'create',
          phase: 'afterPersist',
          modelKey: args.modelKey,
          actor: args.actor,
          input: row,
          services,
        }).output;

        const runResponsePipeline = args.options?.runResponsePipeline !== false;
        if (runResponsePipeline) {
          row = this.pipelines.runPhase({
            dsl,
            registrySpec: registry?.get?.(args.modelKey),
            action: 'create',
            phase: 'response',
            modelKey: args.modelKey,
            actor: args.actor,
            input: row,
            services,
          }).output;
        }
      }

      await addFkAutoNames({ orm, dsl, modelKey: args.modelKey, rows: [row as any] });
      row = pruneRowToDsl(spec, row as any);

      await this.emitWorkflow({ model: args.modelKey, action: 'create', before: null, after: row, actor: args.actor });

      return acl.pruneRead(row);
    }

    // bypass mode: no ACL/RLS; pipelines still optional
    const runPipelines = args.options?.runPipelines !== false;
    const registry = this.getPipelineRegistry();
    const services = args.options?.services ?? this.pipelineServices();
    let payload = pruneUnknownPayload(spec, { ...args.values });
    const { body: normalizedBody, joinPayloads } = normalizePayloadMultiFields(spec, payload);
    payload = coerceEmptyToNull(spec, normalizedBody);
    const autoName = computeAutoName(dsl, args.modelKey, payload);
    if (autoName !== null) payload.auto_name = autoName;

    if (runPipelines) {
      payload = this.pipelines.runPhase({
        dsl,
        registrySpec: registry?.get?.(args.modelKey),
        action: 'create',
        phase: 'beforeValidate',
        modelKey: args.modelKey,
        actor: args.actor,
        input: payload,
        services,
      }).output;
      this.pipelines.runPhase({
        dsl,
        registrySpec: registry?.get?.(args.modelKey),
        action: 'create',
        phase: 'validate',
        modelKey: args.modelKey,
        actor: args.actor,
        input: payload,
        services,
      });
      payload = this.pipelines.runPhase({
        dsl,
        registrySpec: registry?.get?.(args.modelKey),
        action: 'create',
        phase: 'beforePersist',
        modelKey: args.modelKey,
        actor: args.actor,
        input: payload,
        services,
      }).output;
    }

    payload = stripVirtualFields(spec, payload);
    const created = await (model as any).create(payload);
    let row = (created as any)?.get ? (created as any).get({ plain: true }) : created;
    await applyJoinUpdates({
      orm,
      modelKey: args.modelKey,
      spec,
      instance: created,
      joinPayloads,
    });
    if (runPipelines) {
      row = this.pipelines.runPhase({
        dsl,
        registrySpec: registry?.get?.(args.modelKey),
        action: 'create',
        phase: 'afterPersist',
        modelKey: args.modelKey,
        actor: args.actor,
        input: row,
        services,
      }).output;
    }
    await addFkAutoNames({ orm, dsl, modelKey: args.modelKey, rows: [row as any] });
    await this.emitWorkflow({ model: args.modelKey, action: 'create', before: null, after: row, actor: args.actor });
    return pruneRowToDsl(spec, row as any);
  }

  async read(args: CrudCtx & { modelKey: string; id: any; query?: CrudListQuery; options?: CrudCallOptions }): Promise<Record<string, unknown>> {
    const orm = this.getOrm();
    const dsl = this.getDsl();
    const config = this.getConfig();
    const spec = modelSpec(dsl, args.modelKey);
    const model = getModel(orm, args.modelKey);
    const includeDeleted = !!args.query?.includeDeleted;
    const includeArchived = !!args.query?.includeArchived;
    const pk = getPrimaryKeyField(model);

    const bypass = args.options?.bypassAclRls === true;
    if (!bypass) {
      const acl = new AclEngine();
      const aclRes = acl.can({ actor: args.actor, modelKey: args.modelKey, modelSpec: spec, action: 'read' });
      if (!aclRes.allow) throw new CrudForbiddenError(aclRes.reason || 'ACL denied');

      const rls = new RlsEngine(config.rls);
      const scope = rls.scope({ actor: args.actor, modelKey: args.modelKey, action: 'read' });
      if (!scope.allow) throw new CrudForbiddenError((scope as any).reason || 'RLS denied');

      const whereParts: any[] = [{ [pk]: args.id }];
      if (!includeDeleted && (model as any).rawAttributes?.deleted) whereParts.push({ deleted: false });
      if (!includeArchived && (model as any).rawAttributes?.archived) whereParts.push({ archived: false });
      const scopeWhere = rlsWhereToSequelize(orm, args.modelKey, (scope as any).where);
      if (scopeWhere) whereParts.push(scopeWhere);
      const where = whereParts.length === 1 ? whereParts[0]! : { [getSequelizeLib(orm).Op.and]: whereParts };

      const row = (await (model as any).findOne({ where, raw: true })) as Record<string, any> | null;
      if (!row) throw new CrudNotFoundError('Not found');
      await attachJunctionIds({ orm, modelKey: args.modelKey, spec, pk, rows: [row] });
      await addFkAutoNames({ orm, dsl, modelKey: args.modelKey, rows: [row] });

      const runPipelines = args.options?.runPipelines !== false;
      const runResponsePipeline = args.options?.runResponsePipeline !== false;
      const registry = this.getPipelineRegistry();
      const services = args.options?.services ?? this.pipelineServices();
      let outRow = row;
      if (runPipelines && runResponsePipeline) {
        outRow = this.pipelines.runPhase({
          dsl,
          registrySpec: registry?.get?.(args.modelKey),
          action: 'read',
          phase: 'response',
          modelKey: args.modelKey,
          actor: args.actor,
          input: row as any,
          services,
        }).output;
      }
      const aclPruned = new AclEngine().pruneRead(outRow);
      return pruneRowToDsl(spec, aclPruned);
    }

    // bypass
    const whereParts: any[] = [{ [pk]: args.id }];
    if (!includeDeleted && (model as any).rawAttributes?.deleted) whereParts.push({ deleted: false });
    if (!includeArchived && (model as any).rawAttributes?.archived) whereParts.push({ archived: false });
    const where = whereParts.length === 1 ? whereParts[0]! : { [getSequelizeLib(orm).Op.and]: whereParts };
    const row = (await (model as any).findOne({ where, raw: true })) as Record<string, any> | null;
    if (!row) throw new CrudNotFoundError('Not found');
    await attachJunctionIds({ orm, modelKey: args.modelKey, spec, pk, rows: [row] });
    await addFkAutoNames({ orm, dsl, modelKey: args.modelKey, rows: [row] });
    return pruneRowToDsl(spec, row);
  }

  async update(args: CrudCtx & { modelKey: string; id: any; values: Record<string, unknown>; options?: CrudCallOptions }): Promise<Record<string, unknown>> {
    const orm = this.getOrm();
    const dsl = this.getDsl();
    const config = this.getConfig();
    const spec = modelSpec(dsl, args.modelKey);
    const model = getModel(orm, args.modelKey);
    const pk = getPrimaryKeyField(model);

    const bypass = args.options?.bypassAclRls === true;
    if (!bypass) {
      const acl = new AclEngine();
      const aclRes = acl.can({ actor: args.actor, modelKey: args.modelKey, modelSpec: spec, action: 'update' });
      if (!aclRes.allow) throw new CrudForbiddenError(aclRes.reason || 'ACL denied');

      const rls = new RlsEngine(config.rls);
      const scope = rls.scope({ actor: args.actor, modelKey: args.modelKey, action: 'update' });
      if (!scope.allow) throw new CrudForbiddenError((scope as any).reason || 'RLS denied');

      const guard = rls.writeGuard({ actor: args.actor, modelKey: args.modelKey, action: 'update' });
      if (!guard.allow) throw new CrudForbiddenError((guard as any).reason || 'RLS denied');

      const whereParts: any[] = [{ [pk]: args.id }];
      if ((model as any).rawAttributes?.deleted) whereParts.push({ deleted: false });
      if ((model as any).rawAttributes?.archived) whereParts.push({ archived: false });
      const scopeWhere = rlsWhereToSequelize(orm, args.modelKey, (scope as any).where);
      if (scopeWhere) whereParts.push(scopeWhere);
      const where = whereParts.length === 1 ? whereParts[0]! : { [getSequelizeLib(orm).Op.and]: whereParts };

      const existing = await (model as any).findOne({ where });
      if (!existing) throw new CrudNotFoundError('Not found');
      const before = (existing as any)?.get ? (existing as any).get({ plain: true }) : (existing as any);

      const runPipelines = args.options?.runPipelines !== false;
      const registry = this.getPipelineRegistry();
      const services = args.options?.services ?? this.pipelineServices();

      let payload = pruneUnknownPayload(spec, { ...args.values });
      const { body: normalizedBody, joinPayloads } = normalizePayloadMultiFields(spec, payload);
      payload = applyWriteGuard({ guard, payload: normalizedBody });
      payload = coerceEmptyToNull(spec, payload);
      const autoName = computeAutoName(dsl, args.modelKey, { ...before, ...payload });
      if (autoName !== null) payload.auto_name = autoName;
      if (runPipelines) {
        payload = this.pipelines.runPhase({
          dsl,
          registrySpec: registry?.get?.(args.modelKey),
          action: 'update',
          phase: 'beforeValidate',
          modelKey: args.modelKey,
          actor: args.actor,
          input: payload,
          services,
        }).output;
        this.pipelines.runPhase({
          dsl,
          registrySpec: registry?.get?.(args.modelKey),
          action: 'update',
          phase: 'validate',
          modelKey: args.modelKey,
          actor: args.actor,
          input: payload,
          services,
        });
        payload = this.pipelines.runPhase({
          dsl,
          registrySpec: registry?.get?.(args.modelKey),
          action: 'update',
          phase: 'beforePersist',
          modelKey: args.modelKey,
          actor: args.actor,
          input: payload,
          services,
        }).output;
      }

      payload = stripVirtualFields(spec, payload);
      await (existing as any).update(payload);
      let row = (existing as any)?.get ? (existing as any).get({ plain: true }) : existing;

      await applyJoinUpdates({
        orm,
        modelKey: args.modelKey,
        spec,
        instance: existing,
        joinPayloads,
      });

      if (runPipelines) {
        row = this.pipelines.runPhase({
          dsl,
          registrySpec: registry?.get?.(args.modelKey),
          action: 'update',
          phase: 'afterPersist',
          modelKey: args.modelKey,
          actor: args.actor,
          input: row,
          services,
        }).output;

        const runResponsePipeline = args.options?.runResponsePipeline !== false;
        if (runResponsePipeline) {
          row = this.pipelines.runPhase({
            dsl,
            registrySpec: registry?.get?.(args.modelKey),
            action: 'update',
            phase: 'response',
            modelKey: args.modelKey,
            actor: args.actor,
            input: row,
            services,
          }).output;
        }
      }

      await addFkAutoNames({ orm, dsl, modelKey: args.modelKey, rows: [row as any] });
      await this.emitWorkflow({ model: args.modelKey, action: 'update', before, after: row, actor: args.actor });
      return pruneRowToDsl(spec, new AclEngine().pruneRead(row));
    }

    // bypass
    const whereParts: any[] = [{ [pk]: args.id }];
    if ((model as any).rawAttributes?.deleted) whereParts.push({ deleted: false });
    if ((model as any).rawAttributes?.archived) whereParts.push({ archived: false });
    const where = whereParts.length === 1 ? whereParts[0]! : { [getSequelizeLib(orm).Op.and]: whereParts };
    const existing = await (model as any).findOne({ where });
    if (!existing) throw new CrudNotFoundError('Not found');
    const before = (existing as any)?.get ? (existing as any).get({ plain: true }) : (existing as any);

    let payload = pruneUnknownPayload(spec, { ...args.values });
    const { body: normalizedBody, joinPayloads } = normalizePayloadMultiFields(spec, payload);
    payload = coerceEmptyToNull(spec, normalizedBody);
    const autoName = computeAutoName(dsl, args.modelKey, { ...before, ...payload });
    if (autoName !== null) payload.auto_name = autoName;
    payload = stripVirtualFields(spec, payload);
    await (existing as any).update(payload);
    await applyJoinUpdates({
      orm,
      modelKey: args.modelKey,
      spec,
      instance: existing,
      joinPayloads,
    });
    const row = (existing as any)?.get ? (existing as any).get({ plain: true }) : (existing as any);
    await addFkAutoNames({ orm, dsl, modelKey: args.modelKey, rows: [row as any] });
    await this.emitWorkflow({ model: args.modelKey, action: 'update', before, after: row, actor: args.actor });
    return pruneRowToDsl(spec, row as any);
  }

  async delete(args: CrudCtx & { modelKey: string; id: any; options?: CrudCallOptions }): Promise<Record<string, unknown>> {
    const orm = this.getOrm();
    const dsl = this.getDsl();
    const config = this.getConfig();
    const spec = modelSpec(dsl, args.modelKey);
    const model = getModel(orm, args.modelKey);
    const pk = getPrimaryKeyField(model);

    const bypass = args.options?.bypassAclRls === true;
    if (!bypass) {
      const acl = new AclEngine();
      const aclRes = acl.can({ actor: args.actor, modelKey: args.modelKey, modelSpec: spec, action: 'delete' });
      if (!aclRes.allow) throw new CrudForbiddenError(aclRes.reason || 'ACL denied');

      const rls = new RlsEngine(config.rls);
      const scope = rls.scope({ actor: args.actor, modelKey: args.modelKey, action: 'delete' });
      if (!scope.allow) throw new CrudForbiddenError((scope as any).reason || 'RLS denied');

      const whereParts: any[] = [{ [pk]: args.id }];
      if ((model as any).rawAttributes?.deleted) whereParts.push({ deleted: false });
      if ((model as any).rawAttributes?.archived) whereParts.push({ archived: false });
      const scopeWhere = rlsWhereToSequelize(orm, args.modelKey, (scope as any).where);
      if (scopeWhere) whereParts.push(scopeWhere);
      const where = whereParts.length === 1 ? whereParts[0]! : { [getSequelizeLib(orm).Op.and]: whereParts };

      const existing = await (model as any).findOne({ where });
      if (!existing) throw new CrudNotFoundError('Not found');
      await (existing as any).update({ deleted: true, deleted_at: new Date() });
      const row = (existing as any)?.get ? (existing as any).get({ plain: true }) : (existing as any);
      await this.emitWorkflow({ model: args.modelKey, action: 'delete', before: row, after: null, actor: args.actor });
      return pruneRowToDsl(spec, new AclEngine().pruneRead(row));
    }

    const where = { [pk]: args.id } as any;
    const existing = await (model as any).findOne({ where });
    if (!existing) throw new CrudNotFoundError('Not found');
    await (existing as any).update({ deleted: true, deleted_at: new Date() });
    const row = (existing as any)?.get ? (existing as any).get({ plain: true }) : (existing as any);
    await this.emitWorkflow({ model: args.modelKey, action: 'delete', before: row, after: null, actor: args.actor });
    return pruneRowToDsl(spec, row);
  }

  static toCrudError(e: unknown): CrudBadRequestError | CrudForbiddenError | CrudNotFoundError | null {
    if (e instanceof CrudBadRequestError) return e;
    if (e instanceof CrudForbiddenError) return e;
    if (e instanceof CrudNotFoundError) return e;
    if (e instanceof QueryParseError) return new CrudBadRequestError(e.message);
    if (e instanceof PipelineValidationError) {
      const err = new CrudBadRequestError(e.message);
      (err as any).errors = (e as any).errors;
      return err;
    }
    return null;
  }
}
