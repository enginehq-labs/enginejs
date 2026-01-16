import express from 'express';
import type { Request } from 'express';

import type { Actor, DslFieldSpec, DslModelSpec, DslRoot, EngineConfig, OrmInitResult } from '@enginehq/core';
import {
  AclEngine,
  PipelineEngine,
  PipelineValidationError,
  QueryParseError,
  RlsEngine,
  rlsWhereToSequelize,
  SequelizeWorkflowOutboxStore,
  validateWorkflowSpec,
  WorkflowEngine,
  isDslModelSpec,
  parseListQuery,
} from '@enginehq/core';

export type CrudRouterDeps = {
  getDsl: () => DslRoot;
  getOrm: () => OrmInitResult;
  getConfig: () => EngineConfig;
};

function getSequelizeLib(orm: OrmInitResult) {
  const Seq = (orm.sequelize as any).Sequelize ?? (orm.sequelize as any).constructor;
  const Op = (Seq as any).Op;
  return {
    Op,
    fn: (Seq as any).fn.bind(Seq),
    col: (Seq as any).col.bind(Seq),
    where: (Seq as any).where.bind(Seq),
    literal: (Seq as any).literal.bind(Seq),
  };
}

function isTruthy(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function httpDenyCode(config: EngineConfig, kind: 'single' | 'collection'): 403 | 404 {
  if (kind === 'collection') return 403;
  return config.http?.hideExistence === false ? 403 : 404;
}

function getPrimaryKeyField(model: any): string {
  const pk = (model as any).primaryKeyAttributes?.[0];
  return String(pk || 'id');
}

function asModelSpec(dsl: DslRoot, modelKey: string): DslModelSpec | null {
  const spec = dsl[modelKey];
  if (!isDslModelSpec(spec)) return null;
  return spec;
}

function getModel(orm: OrmInitResult, modelKey: string): any | null {
  return (orm.models as any)[modelKey] ?? null;
}

function isVirtualField(f: DslFieldSpec | undefined): boolean {
  return (f as any)?.save === false;
}

function stripVirtualFields(spec: DslModelSpec, payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  for (const [field, f] of Object.entries(spec.fields || {})) {
    if (!f || typeof f !== 'object') continue;
    if (isVirtualField(f as any)) delete out[field];
  }
  return out;
}

function isStringArrayField(f: DslFieldSpec | undefined): boolean {
  return (f as any)?.multi === true && String((f as any)?.type || '').toLowerCase() === 'string';
}

function isJunctionIntFkField(f: DslFieldSpec | undefined): boolean {
  const multi = (f as any)?.multi === true;
  const type = String((f as any)?.type || '').toLowerCase();
  const source = (f as any)?.source;
  const sourceid = (f as any)?.sourceid;
  return multi && (type === 'int' || type === 'integer' || type === 'bigint') && !!source && !!sourceid;
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

    if (isStringArrayField(f as any)) {
      const arr = parseArrayish(rawVal).map((v) => String(v));
      body[field] = arr;
      continue;
    }

    if (isJunctionIntFkField(f as any)) {
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
    const isNumeric = type === 'int' || type === 'integer' || type === 'bigint' || type === 'float' || type === 'decimal' || type === 'number';
    const isDatetime = type === 'date' || type === 'datetime';
    const isBool = type === 'boolean';
    if (!isNumeric && !isDatetime && !isBool) continue;
    const val = out[field];
    if (val === '' || (typeof val === 'string' && val.trim() === '')) out[field] = null;
  }
  return out;
}

function computeAutoName(dsl: DslRoot, modelKey: string, row: Record<string, unknown>): string | null {
  const spec = asModelSpec(dsl, modelKey);
  if (!spec) return null;
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

function computeChangedFields(before: Record<string, unknown> | null, after: Record<string, unknown>): string[] {
  const keys = new Set<string>();
  for (const k of Object.keys(after || {})) keys.add(k);
  if (before) for (const k of Object.keys(before)) keys.add(k);
  const changed: string[] = [];
  for (const k of [...keys].sort((a, b) => a.localeCompare(b))) {
    const a = before ? (before as any)[k] : undefined;
    const b = (after as any)[k];
    const same = a === b || (a == null && b == null);
    if (!same) changed.push(k);
  }
  return changed;
}

function pruneRowToDsl(spec: DslModelSpec, row: Record<string, any>): Record<string, any> {
  const allowed = new Set(Object.keys(spec.fields || {}));
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row || {})) {
    if (allowed.has(k) || k.endsWith('_auto_name')) out[k] = v;
  }
  return out;
}

function buildPagination(limit: number, totalCount: number, currentPage: number) {
  if (limit === 0) return null;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return {
    limit,
    totalCount,
    totalPages,
    currentPage,
    nextPage: currentPage < totalPages ? currentPage + 1 : null,
    previousPage: currentPage > 1 ? currentPage - 1 : null,
  };
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
  const pk = getPrimaryKeyField(instance.constructor);
  const ownerId = instance?.get ? instance.get(pk) : instance?.[pk];
  const now = new Date();
  for (const [field, ids] of Object.entries(joinPayloads)) {
    const f = spec.fields?.[field] as DslFieldSpec | undefined;
    if (!f || !isJunctionIntFkField(f)) continue;
    const joinName = `${modelKey}__${field}__to__${String((f as any).source)}__${String((f as any).sourceid)}`;
    const Join = (orm.models as any)[joinName];
    if (!Join) continue;
    const ownerIdCol = `${modelKey}Id`;
    const sourceIdCol = `${String((f as any).source)}Id`;
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
      if (archivedRow && (f as any).unique) {
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

async function addFkAutoNames({
  orm,
  dsl,
  modelKey,
  rows,
  includeDeleted,
  includeArchived,
}: {
  orm: OrmInitResult;
  dsl: DslRoot;
  modelKey: string;
  rows: Array<Record<string, any>>;
  includeDeleted: boolean;
  includeArchived: boolean;
}) {
  const spec = asModelSpec(dsl, modelKey);
  if (!spec) return;
  const targets: Array<{ field: string; source: string; sourceid: string }> = [];
  for (const [field, f] of Object.entries(spec.fields || {})) {
    if (!f || typeof f !== 'object') continue;
    if (isVirtualField(f as any)) continue;
    if ((f as any).multi === true) continue;
    const source = (f as any).source;
    const sourceid = (f as any).sourceid;
    if (source && sourceid) targets.push({ field, source: String(source), sourceid: String(sourceid) });
  }
  if (!targets.length || !rows.length) return;

  for (const target of targets) {
    const targetSpec = asModelSpec(dsl, target.source);
    const targetModel = getModel(orm, target.source);
    if (!targetSpec || !targetModel) continue;

    const ids = [...new Set(rows.map((r) => r[target.field]).filter((v) => v != null))];
    if (!ids.length) continue;

    const where: any = { [target.sourceid]: { [getSequelizeLib(orm).Op.in]: ids } };
    if (!includeDeleted) where.deleted = false;
    if (!includeArchived) where.archived = false;

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

function toLikePattern(raw: string): string {
  const s = raw.trim();
  if (s.includes('*')) return s.replace(/\*/g, '%');
  return `%${s}%`;
}

function buildFilterExpr({
  orm,
  modelKey,
  model,
  spec,
  field,
  expr,
}: {
  orm: OrmInitResult;
  modelKey: string;
  model: any;
  spec: DslModelSpec;
  field: string;
  expr: any;
}): any {
  const { Op, where, fn, col, literal } = getSequelizeLib(orm);
  const f = spec.fields?.[field] as DslFieldSpec | undefined;
  if (!f || isVirtualField(f)) return null;

  if (isJunctionIntFkField(f)) {
    const joinName = `${modelKey}__${field}__to__${String((f as any).source)}__${String((f as any).sourceid)}`;
    const joinModel = (orm.models as any)[joinName];
    if (!joinModel) throw new QueryParseError(`Missing junction model for field: ${modelKey}.${field}`, { field });
    const pk = getPrimaryKeyField(model);
    const ownerIdCol = `${modelKey}Id`;
    const sourceIdCol = `${String((f as any).source)}Id`;

    const v = expr.value;
    const escaped = (orm.sequelize as any).escape(v);
    const sub = `SELECT "${ownerIdCol}" FROM "${joinName}" WHERE "${sourceIdCol}" = ${escaped} AND "deleted" = false AND "archived" = false`;

    if (expr.op === 'ne') return { [pk]: { [Op.notIn]: literal(sub) } };
    if (expr.op !== 'eq') throw new QueryParseError(`Unsupported filter op for junction field: ${expr.op}`, { field });
    return { [pk]: { [Op.in]: literal(sub) } };
  }

  if (isStringArrayField(f)) {
    if (expr.op === 'eq') return { [field]: { [Op.contains]: [expr.value] } };
    if (expr.op === 'ne') return { [Op.not]: { [field]: { [Op.contains]: [expr.value] } } };
    if (expr.op === 'like') {
      return where(
        fn('array_to_string', col(field), ' '),
        { [Op.iLike]: toLikePattern(String(expr.value)) },
      );
    }
    throw new QueryParseError(`Unsupported filter op for string[] field: ${expr.op}`, { field });
  }

  if (expr.op === 'eq') return { [field]: expr.value };
  if (expr.op === 'ne') return { [field]: { [Op.ne]: expr.value } };
  if (expr.op === 'gt') return { [field]: { [Op.gt]: expr.value } };
  if (expr.op === 'gte') return { [field]: { [Op.gte]: expr.value } };
  if (expr.op === 'lt') return { [field]: { [Op.lt]: expr.value } };
  if (expr.op === 'lte') return { [field]: { [Op.lte]: expr.value } };
  if (expr.op === 'like') return { [field]: { [Op.iLike]: toLikePattern(String(expr.value)) } };
  if (expr.op === 'range') {
    const parts: any[] = [];
    if (expr.min !== undefined) parts.push({ [field]: { [Op.gte]: expr.min } });
    if (expr.max !== undefined) parts.push({ [field]: { [Op.lte]: expr.max } });
    if (!parts.length) throw new QueryParseError('Invalid range filter');
    if (parts.length === 1) return parts[0]!;
    return { [Op.and]: parts };
  }

  throw new QueryParseError(`Unsupported filter op: ${expr.op}`, { field });
}

function buildFiltersWhere({
  orm,
  modelKey,
  model,
  spec,
  ast,
}: {
  orm: OrmInitResult;
  modelKey: string;
  model: any;
  spec: DslModelSpec;
  ast: ReturnType<typeof parseListQuery>;
}): any {
  const { Op } = getSequelizeLib(orm);
  const andParts: any[] = [];

  for (const group of ast.filters || []) {
    const orParts = (group.or || [])
      .map((expr: any) => buildFilterExpr({ orm, modelKey, model, spec, field: group.field, expr }))
      .filter(Boolean);
    if (!orParts.length) continue;
    if (orParts.length === 1) andParts.push(orParts[0]!);
    else andParts.push({ [Op.or]: orParts });
  }

  if (!andParts.length) return null;
  if (andParts.length === 1) return andParts[0]!;
  return { [Op.and]: andParts };
}

async function buildFindWhere({
  orm,
  actor,
  acl,
  rls,
  modelKey,
  model,
  spec,
  ast,
}: {
  orm: OrmInitResult;
  actor: Actor;
  acl: AclEngine;
  rls: RlsEngine;
  modelKey: string;
  model: any;
  spec: DslModelSpec;
  ast: ReturnType<typeof parseListQuery>;
}): Promise<any | null> {
  const { Op, where, fn, col } = getSequelizeLib(orm);
  if (!ast.find) return null;
  const term = ast.find.trim();
  if (!term) return null;
  const pattern = toLikePattern(term);

  const orParts: any[] = [];

  // auto_name is always searchable by default.
  orParts.push({ auto_name: { [Op.iLike]: pattern } });

  for (const [field, f] of Object.entries(spec.fields || {})) {
    if (!f || typeof f !== 'object') continue;
    if ((f as any).canfind !== true) continue;
    if (isVirtualField(f as any)) continue;

    if (isStringArrayField(f as any)) {
      orParts.push(
        where(fn('array_to_string', col(field), ' '), {
          [Op.iLike]: pattern,
        }),
      );
      continue;
    }

    const type = String((f as any).type || '').toLowerCase();
    const source = (f as any).source;
    const sourceid = (f as any).sourceid;

    if (source && sourceid) {
      // Two-phase lookup: target IDs by auto_name, applying target RLS + ACL.
      const targetKey = String(source);
      const targetSpec = asModelSpec(orm.dsl, targetKey);
      const targetModel = getModel(orm, targetKey);
      if (!targetSpec || !targetModel) continue;

      const aclRes = acl.can({ actor, modelKey: targetKey, modelSpec: targetSpec, action: 'read' });
      if (!aclRes.allow) continue;

      const scope = rls.scope({ actor, modelKey: targetKey, action: 'list' });
      if (!scope.allow) continue;

      const targetWhereParts: any[] = [];
      // default filters apply to FK lookups too
      if (!ast.includeDeleted) targetWhereParts.push({ deleted: false });
      if (!ast.includeArchived) targetWhereParts.push({ archived: false });
      targetWhereParts.push(rlsWhereToSequelize(orm, targetKey, (scope as any).where));
      targetWhereParts.push({ auto_name: { [Op.iLike]: pattern } });
      const targetWhere = { [Op.and]: targetWhereParts.filter(Boolean) };

      const ids = (await targetModel.findAll({
        attributes: [String(sourceid)],
        where: targetWhere,
        raw: true,
        limit: 500,
      })) as Array<Record<string, unknown>>;

      const values = ids
        .map((r) => r[String(sourceid)])
        .filter((x) => x != null) as Array<string | number>;
      if (values.length) orParts.push({ [field]: { [Op.in]: values } });
      continue;
    }

    if (type === 'string' || type === 'text') {
      orParts.push({ [field]: { [Op.iLike]: pattern } });
      continue;
    }
  }

  if (!orParts.length) return null;
  return { [Op.or]: orParts };
}

function buildOrder(ast: ReturnType<typeof parseListQuery>, pk: string, spec: DslModelSpec): any[] {
  const out: any[] = [];
  const addToken = (token: string) => {
    const t = String(token || '').trim();
    if (!t) return;
    const dir = t.startsWith('-') ? 'DESC' : 'ASC';
    const field = t.replace(/^[+-]/, '').trim();
    if (!field) return;
    out.push([field, dir]);
  };

  if (Array.isArray(ast.sort) && ast.sort.length) {
    for (const s of ast.sort) out.push([s.field, s.dir.toUpperCase()]);
  } else if (Array.isArray((spec as any).ui?.sort)) {
    for (const tok of (spec as any).ui.sort as any[]) addToken(String(tok));
  }

  if (!out.length) out.push([pk, 'DESC']);
  if (!out.some((x) => String(x[0]) === pk)) out.push([pk, 'DESC']);
  return out;
}

function buildIncludeGraph({
  orm,
  model,
  depth,
  includeBelongsTo,
  includeDefaultFilters,
}: {
  orm: OrmInitResult;
  model: any;
  depth: number;
  includeBelongsTo: boolean;
  includeDefaultFilters: boolean;
}): any[] {
  const { Op } = getSequelizeLib(orm);
  if (!depth || depth < 1) return [];
  const out: any[] = [];
  const assocs = (model as any).associations || {};
  const keys = Object.keys(assocs).sort((a, b) => a.localeCompare(b));
  for (const as of keys) {
    if (as.startsWith('$')) continue;
    const assoc = assocs[as];
    const kind = String(assoc?.associationType || '');
    if (!includeBelongsTo && kind === 'BelongsTo') continue;
    const childModel = assoc?.target;
    const include: any = { association: as, required: false };
    if (includeDefaultFilters) include.where = { [Op.and]: [{ deleted: false }, { archived: false }] };
    include.include = buildIncludeGraph({
      orm,
      model: childModel,
      depth: depth - 1,
      includeBelongsTo: true,
      includeDefaultFilters,
    });
    out.push(include);
  }
  return out;
}

function applyWriteGuard({
  guard,
  payload,
}: {
  guard: any;
  payload: Record<string, unknown>;
}): Record<string, unknown> {
  if (!guard.allow) return payload;

  if (guard.mode === 'enforce') {
    return { ...payload, ...guard.enforced };
  }

  if (guard.mode === 'validate') {
    const errors: Record<string, string> = {};
    for (const field of guard.validateFields || []) {
      if (!(field in payload)) continue;
      if (payload[field] !== guard.enforced[field]) errors[field] = 'Forbidden';
    }
    if (Object.keys(errors).length) {
      const e = new Error('RLS write guard failed');
      (e as any).code = 403;
      (e as any).errors = errors;
      throw e;
    }
  }

  return payload;
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
  const junctionFields = Object.entries(spec.fields || {}).filter(([, f]) => isJunctionIntFkField(f as any));
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

function getActor(req: Request): Actor {
  const a = (req as any).actor;
  return (
    a ??
    ({
      isAuthenticated: false,
      subjects: {},
      roles: [],
      claims: {},
    } satisfies Actor)
  );
}

function getModelSpecFromDsl(dsl: unknown, modelKey: string): DslModelSpec | null {
  if (!dsl || typeof dsl !== 'object') return null;
  const spec = (dsl as any)[modelKey];
  if (!isDslModelSpec(spec)) return null;
  return spec as DslModelSpec;
}

function getPipelineRegistry(req: Request): any | null {
  const svcs = (req as any).services;
  if (!svcs?.has?.('pipelines')) return null;
  return svcs.get('pipelines');
}

function workflowsEnabled(config: EngineConfig): boolean {
  return !!config.workflows && (config.workflows as any).enabled !== false;
}

function workflowsUseDbRegistry(config: EngineConfig): boolean {
  return workflowsEnabled(config) && String((config.workflows as any).registry || '') === 'db';
}

function getWorkflowModelKey(config: EngineConfig): string {
  const wk = (config.workflows as any)?.db?.modelKey;
  return String(wk || 'workflow');
}

function getWorkflowRegistry(req: Request): any | null {
  const svcs = (req as any).services;
  if (!svcs?.has?.('workflows')) return null;
  return svcs.get('workflows');
}

function syncWorkflowRegistryFromRow(args: {
  req: Request;
  config: EngineConfig;
  modelKey: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  if (!workflowsUseDbRegistry(args.config)) return;
  if (args.modelKey !== getWorkflowModelKey(args.config)) return;

  const registry = getWorkflowRegistry(args.req);
  if (!registry?.register) return;

  const beforeSlug = args.before ? String((args.before as any).slug || (args.before as any).name || '').trim() : '';
  const slug = args.after ? String((args.after as any).slug || (args.after as any).name || '').trim() : '';
  if (beforeSlug && beforeSlug !== slug) registry.register(beforeSlug, null);

  if (!slug) return;
  const enabled = args.after ? (args.after as any).enabled !== false : false;
  if (!enabled) return registry.register(slug, null);

  const spec = args.after ? ((args.after as any).spec ?? null) : null;
  const val = validateWorkflowSpec(spec);
  if (!val.ok) return registry.register(slug, null);

  registry.register(slug, spec);
}

function getWorkflowEngine(orm: OrmInitResult): WorkflowEngine | null {
  const outboxModel = (orm.models as any).workflow_events_outbox;
  if (!outboxModel) return null;
  return new WorkflowEngine(new SequelizeWorkflowOutboxStore(outboxModel));
}

function getOrigin(req: Request): string {
  const h = (req.headers as any)['x-engine-origin'];
  if (typeof h === 'string' && h.trim()) return h.trim();
  return 'http';
}

function getOriginChain(req: Request): string[] | undefined {
  const h = (req.headers as any)['x-engine-origin-chain'];
  const raw = Array.isArray(h) ? h[0] : h;
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const s = raw.trim();
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) {
      const out = parsed.map((x) => String(x)).map((x) => x.trim()).filter(Boolean);
      return out.length ? out : undefined;
    }
  } catch {}
  const out = s.split(',').map((x) => x.trim()).filter(Boolean);
  return out.length ? out : undefined;
}

function getParentEventId(req: Request): string | number | undefined {
  const h = (req.headers as any)['x-engine-parent-event-id'];
  if (typeof h === 'string' && h.trim()) return h.trim();
  return undefined;
}

function getServicesForPipeline(req: Request) {
  const svcs = (req as any).services;
  return {
    has: (name: string) => !!svcs?.has?.(name),
    get: (name: string) => svcs.get(name),
  };
}

export function createCrudRouter({ getDsl, getOrm, getConfig }: CrudRouterDeps) {
  const router = express.Router();
  const pipelines = new PipelineEngine({ getModelSpec: getModelSpecFromDsl });

  router.get('/:model', async (req, res) => {
    try {
      const dsl = getDsl();
      const orm = getOrm();
      const config = getConfig();
      const actor = getActor(req);
      const { Op } = getSequelizeLib(orm);

      const modelKey = String(req.params.model || '');
      const spec = asModelSpec(dsl, modelKey);
      const model = spec ? getModel(orm, modelKey) : null;
      if (!spec || !model) {
        return res.fail({ code: 404, message: `Unknown model: ${modelKey}`, errors: { root: 'Not found' } });
      }
      const pk = getPrimaryKeyField(model);

      const acl = new AclEngine();
      const aclRes = acl.can({ actor, modelKey, modelSpec: spec, action: 'read' });
      if (!aclRes.allow) return res.fail({ code: 403, message: aclRes.reason, errors: { root: 'Forbidden' } });

      const rls = new RlsEngine(config.rls);
      const scope = rls.scope({ actor, modelKey, action: 'list' });
      if (!scope.allow) return res.fail({ code: 403, message: (scope as any).reason, errors: { root: 'Forbidden' } });

      const ast = parseListQuery(req.query as any);
      const whereParts = [
        !ast.includeDeleted ? { deleted: false } : null,
        !ast.includeArchived ? { archived: false } : null,
        rlsWhereToSequelize(orm, modelKey, (scope as any).where),
        buildFiltersWhere({ orm, modelKey, model, spec, ast }),
        await buildFindWhere({ orm, actor, acl, rls, modelKey, model, spec, ast }),
      ].filter((x) => x && (typeof x !== 'object' || Object.keys(x).length));
      const where = whereParts.length <= 1 ? (whereParts[0] ?? {}) : { [Op.and]: whereParts };

      const limit = ast.limit;
      const offset = limit > 0 ? (ast.page - 1) * limit : undefined;
      const order = buildOrder(ast, pk, spec);
      const include =
        ast.includeDepth > 0
          ? buildIncludeGraph({
              orm,
              model,
              depth: ast.includeDepth,
              includeBelongsTo: true,
              includeDefaultFilters: true,
            })
          : undefined;

      const rows = (await model.findAll({
        where,
        ...(limit > 0 ? { limit, offset } : {}),
        order,
        include,
        raw: ast.includeDepth === 0,
      })) as Array<Record<string, any>>;

      const outRows =
        ast.includeDepth === 0
          ? rows
          : (rows as any[]).map((r) => ((r as any)?.toJSON ? (r as any).toJSON() : r));

      if (ast.includeDepth === 0) {
        await attachJunctionIds({ orm, modelKey, spec, pk, rows: outRows as any });
        await addFkAutoNames({
          orm,
          dsl,
          modelKey,
          rows: outRows as any,
          includeDeleted: ast.includeDeleted,
          includeArchived: ast.includeArchived,
        });
        for (const r of outRows as any[]) Object.assign(r, pruneRowToDsl(spec, r));
      }

      const totalCount = (await model.count({ where })) as number;
      const pagination = buildPagination(limit, totalCount, ast.page);

      const registry = getPipelineRegistry(req);
      const services = getServicesForPipeline(req);
      const pipedRows: any[] = [];
      for (const r of outRows) {
        const piped = pipelines.runPhase({
          dsl,
          registrySpec: registry?.get?.(modelKey),
          action: 'list',
          phase: 'response',
          modelKey,
          actor,
          input: r,
          services,
        }).output;
        pipedRows.push(pruneRowToDsl(spec, piped));
      }

      return res.ok(pipedRows.map((r) => acl.pruneRead(r)), { code: 200, pagination });
    } catch (e: any) {
      if (e instanceof QueryParseError) {
        return res.fail({ code: 400, message: e.message, errors: { root: 'Bad request' } });
      }
      if (e instanceof PipelineValidationError) {
        return res.fail({ code: 400, message: e.message, errors: e.errors });
      }
      const code = (e && typeof e === 'object' && (e as any).code) || 500;
      const errors = (e && typeof e === 'object' && (e as any).errors) || { root: 'Error' };
      return res.fail({ code, message: e?.message || 'Error', errors });
    }
  });

  router.get('/:model/:id', async (req, res) => {
    try {
      const dsl = getDsl();
      const orm = getOrm();
      const config = getConfig();
      const actor = getActor(req);

      const modelKey = String(req.params.model || '');
      const spec = asModelSpec(dsl, modelKey);
      const model = spec ? getModel(orm, modelKey) : null;
      if (!spec || !model) {
        return res.fail({ code: 404, message: `Unknown model: ${modelKey}`, errors: { root: 'Not found' } });
      }

      const acl = new AclEngine();
      const aclRes = acl.can({ actor, modelKey, modelSpec: spec, action: 'read' });
      if (!aclRes.allow) {
        const code = httpDenyCode(config, 'single');
        return res.fail({ code, message: code === 404 ? 'Not found' : aclRes.reason, errors: { root: 'Forbidden' } });
      }

      const rls = new RlsEngine(config.rls);
      const scope = rls.scope({ actor, modelKey, action: 'read' });
      if (!scope.allow) {
        const code = httpDenyCode(config, 'single');
        return res.fail({ code, message: code === 404 ? 'Not found' : (scope as any).reason, errors: { root: 'Forbidden' } });
      }

      const includeDeleted = isTruthy((req.query as any).includeDeleted);
      const includeArchived = isTruthy((req.query as any).includeArchived);
      const includeDepth = Number.parseInt(String((req.query as any).includeDepth ?? '0'), 10) || 0;
      const { Op } = getSequelizeLib(orm);

      const pk = getPrimaryKeyField(model);
      const whereParts: any[] = [{ [pk]: req.params.id }];
      if (!includeDeleted) whereParts.push({ deleted: false });
      if (!includeArchived) whereParts.push({ archived: false });
      const scopeWhere = rlsWhereToSequelize(orm, modelKey, (scope as any).where);
      if (scopeWhere) whereParts.push(scopeWhere);
      const where = whereParts.length === 1 ? whereParts[0]! : { [Op.and]: whereParts };

      const include =
        includeDepth > 0
          ? buildIncludeGraph({
              orm,
              model,
              depth: includeDepth,
              includeBelongsTo: true,
              includeDefaultFilters: true,
            })
          : undefined;

      const row = (await model.findOne({
        where,
        include,
        raw: includeDepth === 0,
      })) as Record<string, any> | null;

      if (!row) return res.fail({ code: 404, message: 'Not found', errors: { root: 'Not found' } });

      const outRow = (row as any)?.toJSON ? (row as any).toJSON() : row;
      if (includeDepth === 0) {
        await attachJunctionIds({ orm, modelKey, spec, pk, rows: [outRow] });
        await addFkAutoNames({
          orm,
          dsl,
          modelKey,
          rows: [outRow],
          includeDeleted,
          includeArchived,
        });
        Object.assign(outRow, pruneRowToDsl(spec, outRow));
      }

      const registry = getPipelineRegistry(req);
      const services = getServicesForPipeline(req);
      const piped = pipelines.runPhase({
        dsl,
        registrySpec: registry?.get?.(modelKey),
        action: 'read',
        phase: 'response',
        modelKey,
        actor,
        input: outRow,
        services,
      }).output;

      return res.ok(acl.pruneRead(pruneRowToDsl(spec, piped)), { code: 200, pagination: null });
    } catch (e: any) {
      if (e instanceof PipelineValidationError) {
        return res.fail({ code: 400, message: e.message, errors: e.errors });
      }
      const code = (e && typeof e === 'object' && (e as any).code) || 500;
      const errors = (e && typeof e === 'object' && (e as any).errors) || { root: 'Error' };
      return res.fail({ code, message: e?.message || 'Error', errors });
    }
  });

  router.post('/:model', async (req, res) => {
    try {
      const dsl = getDsl();
      const orm = getOrm();
      const config = getConfig();
      const actor = getActor(req);

      const modelKey = String(req.params.model || '');
      const spec = asModelSpec(dsl, modelKey);
      const model = spec ? getModel(orm, modelKey) : null;
      if (!spec || !model) {
        return res.fail({ code: 404, message: `Unknown model: ${modelKey}`, errors: { root: 'Not found' } });
      }
      const pk = getPrimaryKeyField(model);

      const acl = new AclEngine();
      const aclRes = acl.can({ actor, modelKey, modelSpec: spec, action: 'create' });
      if (!aclRes.allow) return res.fail({ code: 403, message: aclRes.reason, errors: { root: 'Forbidden' } });

      const rls = new RlsEngine(config.rls);
      const guard = rls.writeGuard({ actor, modelKey, action: 'create' });
      if (!guard.allow) return res.fail({ code: 403, message: (guard as any).reason, errors: { root: 'Forbidden' } });

      const registry = getPipelineRegistry(req);
      const services = getServicesForPipeline(req);

      let payload = pruneUnknownPayload(spec, { ...(req.body as any) });
      const { body: normalizedBody, joinPayloads } = normalizePayloadMultiFields(spec, payload);
      payload = applyWriteGuard({ guard, payload: normalizedBody });
      payload = coerceEmptyToNull(spec, payload);
      const autoName = computeAutoName(dsl, modelKey, payload);
      if (autoName !== null) payload.auto_name = autoName;
      payload = pipelines.runPhase({
        dsl,
        registrySpec: registry?.get?.(modelKey),
        action: 'create',
        phase: 'beforeValidate',
        modelKey,
        actor,
        input: payload,
        services,
      }).output;
      pipelines.runPhase({
        dsl,
        registrySpec: registry?.get?.(modelKey),
        action: 'create',
        phase: 'validate',
        modelKey,
        actor,
        input: payload,
        services,
      });
      payload = pipelines.runPhase({
        dsl,
        registrySpec: registry?.get?.(modelKey),
        action: 'create',
        phase: 'beforePersist',
        modelKey,
        actor,
        input: payload,
        services,
      }).output;

      payload = stripVirtualFields(spec, payload);

      const created = await model.create(payload);
      let row = (created as any)?.get ? (created as any).get({ plain: true }) : created;

      await applyJoinUpdates({
        orm,
        modelKey,
        spec,
        instance: created,
        joinPayloads,
      });

      row = pipelines.runPhase({
        dsl,
        registrySpec: registry?.get?.(modelKey),
        action: 'create',
        phase: 'afterPersist',
        modelKey,
        actor,
        input: row,
        services,
      }).output;

      syncWorkflowRegistryFromRow({ req, config, modelKey, before: null, after: row });

      if (workflowsEnabled(config)) {
        const wf = getWorkflowEngine(orm);
        if (!wf) {
          return res.fail({
            code: 500,
            message: 'Workflow outbox not configured',
            errors: { root: 'Misconfigured' },
          });
        }
        const parentEventId = getParentEventId(req);
        const originChain = getOriginChain(req);
        await wf.emitModelEvent({
          model: modelKey,
          action: 'create',
          before: null,
          after: row,
          changedFields: computeChangedFields(null, row),
          actor,
          origin: getOrigin(req),
          ...(originChain ? { originChain } : {}),
          ...(parentEventId != null ? { parentEventId } : {}),
        });
      }

      row = pipelines.runPhase({
        dsl,
        registrySpec: registry?.get?.(modelKey),
        action: 'create',
        phase: 'response',
        modelKey,
        actor,
        input: row,
        services,
      }).output;

      await addFkAutoNames({
        orm,
        dsl,
        modelKey,
        rows: [row as any],
        includeDeleted: false,
        includeArchived: false,
      });
      await attachJunctionIds({ orm, modelKey, spec, pk, rows: [row as any] });
      const pruned = pruneRowToDsl(spec, row as any);

      return res.ok(acl.pruneRead(pruned), { code: 201, pagination: null });
    } catch (e: any) {
      if (e instanceof PipelineValidationError) {
        return res.fail({ code: 400, message: e.message, errors: e.errors });
      }
      const code = (e && typeof e === 'object' && (e as any).code) || 500;
      const errors = (e && typeof e === 'object' && (e as any).errors) || { root: 'Error' };
      return res.fail({ code, message: e?.message || 'Error', errors });
    }
  });

  router.patch('/:model/:id', async (req, res) => {
    try {
      const dsl = getDsl();
      const orm = getOrm();
      const config = getConfig();
      const actor = getActor(req);

      const modelKey = String(req.params.model || '');
      const spec = asModelSpec(dsl, modelKey);
      const model = spec ? getModel(orm, modelKey) : null;
      if (!spec || !model) {
        return res.fail({ code: 404, message: `Unknown model: ${modelKey}`, errors: { root: 'Not found' } });
      }

      const acl = new AclEngine();
      const aclRes = acl.can({ actor, modelKey, modelSpec: spec, action: 'update' });
      if (!aclRes.allow) {
        const code = httpDenyCode(config, 'single');
        return res.fail({ code, message: code === 404 ? 'Not found' : aclRes.reason, errors: { root: 'Forbidden' } });
      }

      const rls = new RlsEngine(config.rls);
      const scope = rls.scope({ actor, modelKey, action: 'update' });
      if (!scope.allow) {
        const code = httpDenyCode(config, 'single');
        return res.fail({ code, message: code === 404 ? 'Not found' : (scope as any).reason, errors: { root: 'Forbidden' } });
      }

      const guard = rls.writeGuard({ actor, modelKey, action: 'update' });
      if (!guard.allow) {
        const code = httpDenyCode(config, 'single');
        return res.fail({ code, message: code === 404 ? 'Not found' : (guard as any).reason, errors: { root: 'Forbidden' } });
      }

      const pk = getPrimaryKeyField(model);
      const { Op } = getSequelizeLib(orm);
      const scopeWhere = rlsWhereToSequelize(orm, modelKey, (scope as any).where);
      const whereParts = [{ [pk]: req.params.id }, { deleted: false }, { archived: false }, scopeWhere].filter(Boolean);
      const where = whereParts.length === 1 ? whereParts[0]! : { [Op.and]: whereParts };

      const existing = await model.findOne({ where });
      if (!existing) return res.fail({ code: 404, message: 'Not found', errors: { root: 'Not found' } });
      const before = (existing as any)?.get ? (existing as any).get({ plain: true }) : (existing as any);

      const registry = getPipelineRegistry(req);
      const services = getServicesForPipeline(req);

      let payload = pruneUnknownPayload(spec, { ...(req.body as any) });
      const { body: normalizedBody, joinPayloads } = normalizePayloadMultiFields(spec, payload);
      payload = applyWriteGuard({ guard, payload: normalizedBody });
      payload = coerceEmptyToNull(spec, payload);
      const autoName = computeAutoName(dsl, modelKey, { ...before, ...payload });
      if (autoName !== null) payload.auto_name = autoName;
      payload = pipelines.runPhase({
        dsl,
        registrySpec: registry?.get?.(modelKey),
        action: 'update',
        phase: 'beforeValidate',
        modelKey,
        actor,
        input: payload,
        services,
      }).output;
      pipelines.runPhase({
        dsl,
        registrySpec: registry?.get?.(modelKey),
        action: 'update',
        phase: 'validate',
        modelKey,
        actor,
        input: payload,
        services,
      });
      payload = pipelines.runPhase({
        dsl,
        registrySpec: registry?.get?.(modelKey),
        action: 'update',
        phase: 'beforePersist',
        modelKey,
        actor,
        input: payload,
        services,
      }).output;

      payload = stripVirtualFields(spec, payload);

      await (existing as any).update(payload);
      let row = (existing as any)?.get ? (existing as any).get({ plain: true }) : existing;

      await applyJoinUpdates({
        orm,
        modelKey,
        spec,
        instance: existing,
        joinPayloads,
      });

      row = pipelines.runPhase({
        dsl,
        registrySpec: registry?.get?.(modelKey),
        action: 'update',
        phase: 'afterPersist',
        modelKey,
        actor,
        input: row,
        services,
      }).output;

      syncWorkflowRegistryFromRow({ req, config, modelKey, before: before as any, after: row });

      if (workflowsEnabled(config)) {
        const wf = getWorkflowEngine(orm);
        if (!wf) {
          return res.fail({
            code: 500,
            message: 'Workflow outbox not configured',
            errors: { root: 'Misconfigured' },
          });
        }
        const parentEventId = getParentEventId(req);
        const originChain = getOriginChain(req);
        await wf.emitModelEvent({
          model: modelKey,
          action: 'update',
          before: before as any,
          after: row,
          changedFields: computeChangedFields(before as any, row),
          actor,
          origin: getOrigin(req),
          ...(originChain ? { originChain } : {}),
          ...(parentEventId != null ? { parentEventId } : {}),
        });
      }

      row = pipelines.runPhase({
        dsl,
        registrySpec: registry?.get?.(modelKey),
        action: 'update',
        phase: 'response',
        modelKey,
        actor,
        input: row,
        services,
      }).output;

      await addFkAutoNames({
        orm,
        dsl,
        modelKey,
        rows: [row as any],
        includeDeleted: false,
        includeArchived: false,
      });
      await attachJunctionIds({ orm, modelKey, spec, pk, rows: [row as any] });
      const pruned = pruneRowToDsl(spec, row as any);

      return res.ok(acl.pruneRead(pruned), { code: 200, pagination: null });
    } catch (e: any) {
      if (e instanceof PipelineValidationError) {
        return res.fail({ code: 400, message: e.message, errors: e.errors });
      }
      const code = (e && typeof e === 'object' && (e as any).code) || 500;
      const errors = (e && typeof e === 'object' && (e as any).errors) || { root: 'Error' };
      return res.fail({ code, message: e?.message || 'Error', errors });
    }
  });

  router.delete('/:model/:id', async (req, res) => {
    try {
      const dsl = getDsl();
      const orm = getOrm();
      const config = getConfig();
      const actor = getActor(req);

      const modelKey = String(req.params.model || '');
      const spec = asModelSpec(dsl, modelKey);
      const model = spec ? getModel(orm, modelKey) : null;
      if (!spec || !model) {
        return res.fail({ code: 404, message: `Unknown model: ${modelKey}`, errors: { root: 'Not found' } });
      }

      const acl = new AclEngine();
      const aclRes = acl.can({ actor, modelKey, modelSpec: spec, action: 'delete' });
      if (!aclRes.allow) {
        const code = httpDenyCode(config, 'single');
        return res.fail({ code, message: code === 404 ? 'Not found' : aclRes.reason, errors: { root: 'Forbidden' } });
      }

      const rls = new RlsEngine(config.rls);
      const scope = rls.scope({ actor, modelKey, action: 'delete' });
      if (!scope.allow) {
        const code = httpDenyCode(config, 'single');
        return res.fail({ code, message: code === 404 ? 'Not found' : (scope as any).reason, errors: { root: 'Forbidden' } });
      }

      const pk = getPrimaryKeyField(model);
      const { Op } = getSequelizeLib(orm);
      const scopeWhere = rlsWhereToSequelize(orm, modelKey, (scope as any).where);
      const whereParts = [{ [pk]: req.params.id }, { deleted: false }, { archived: false }, scopeWhere].filter(Boolean);
      const where = whereParts.length === 1 ? whereParts[0]! : { [Op.and]: whereParts };

      const existing = await model.findOne({ where });
      if (!existing) return res.fail({ code: 404, message: 'Not found', errors: { root: 'Not found' } });
      const before = (existing as any)?.get ? (existing as any).get({ plain: true }) : (existing as any);

      await (existing as any).update({ deleted: true, deleted_at: new Date() });
      const after = (existing as any)?.get ? (existing as any).get({ plain: true }) : (existing as any);

      syncWorkflowRegistryFromRow({ req, config, modelKey, before: before as any, after: null });

      if (workflowsEnabled(config)) {
        const wf = getWorkflowEngine(orm);
        if (!wf) {
          return res.fail({
            code: 500,
            message: 'Workflow outbox not configured',
            errors: { root: 'Misconfigured' },
          });
        }
        const parentEventId = getParentEventId(req);
        const originChain = getOriginChain(req);
        await wf.emitModelEvent({
          model: modelKey,
          action: 'delete',
          before: before as any,
          after: after as any,
          changedFields: ['deleted', 'deleted_at'],
          actor,
          origin: getOrigin(req),
          ...(originChain ? { originChain } : {}),
          ...(parentEventId != null ? { parentEventId } : {}),
        });
      }

      return res.ok({ ok: true }, { code: 200, pagination: null });
    } catch (e: any) {
      const code = (e && typeof e === 'object' && (e as any).code) || 500;
      const errors = (e && typeof e === 'object' && (e as any).errors) || { root: 'Error' };
      return res.fail({ code, message: e?.message || 'Error', errors });
    }
  });

  return router;
}
