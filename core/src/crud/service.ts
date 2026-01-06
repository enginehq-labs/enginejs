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

function sortToOrder(sort: SortSpec[], pkField: string): any[] {
  const out: any[] = [];
  for (const s of sort || []) {
    const field = String(s.field);
    const dir = String(s.dir) === 'desc' ? 'DESC' : 'ASC';
    out.push([field, dir]);
  }
  // deterministic tiebreaker
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
      const offset = (ast.page - 1) * limit;
      const order = sortToOrder(ast.sort, pk);

      const rows = (await (model as any).findAll({ where, limit, offset, order, raw: true })) as Array<Record<string, unknown>>;
      const totalCount = (await (model as any).count({ where })) as number;
      const totalPages = Math.max(1, Math.ceil(totalCount / limit));

      let outRows = rows;
      const runPipelines = args.options?.runPipelines !== false;
      const runResponsePipeline = args.options?.runResponsePipeline !== false;
      if (runPipelines && runResponsePipeline) {
        const registry = this.getPipelineRegistry();
        const services = this.pipelineServices();
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
          return acl.pruneRead(piped);
        });
      }

      return {
        rows: outRows,
        pagination: {
          limit,
          totalCount,
          totalPages,
          currentPage: ast.page,
          nextPage: ast.page < totalPages ? ast.page + 1 : null,
          previousPage: ast.page > 1 ? ast.page - 1 : null,
        },
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
    const offset = (ast.page - 1) * limit;
    const order = sortToOrder(ast.sort, pk);
    const rows = (await (model as any).findAll({ where, limit, offset, order, raw: true })) as Array<Record<string, unknown>>;
    const totalCount = (await (model as any).count({ where })) as number;
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    return {
      rows,
      pagination: {
        limit,
        totalCount,
        totalPages,
        currentPage: ast.page,
        nextPage: ast.page < totalPages ? ast.page + 1 : null,
        previousPage: ast.page > 1 ? ast.page - 1 : null,
      },
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
      const services = this.pipelineServices();

      let payload = applyWriteGuard({ guard, payload: { ...args.values } });
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

      return acl.pruneRead(row);
    }

    // bypass mode: no ACL/RLS; pipelines still optional
    const runPipelines = args.options?.runPipelines !== false;
    const registry = this.getPipelineRegistry();
    const services = this.pipelineServices();
    let payload = { ...args.values };

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
    return row as any;
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
