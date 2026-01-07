import { DataTypes, Op, type Model, type ModelStatic, type Sequelize } from 'sequelize';

import type { DslRoot } from '../dsl/types.js';
import { isDslModelSpec } from '../dsl/types.js';
import type { OrmInitResult } from './types.js';

type Logger = {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
};

export class SafeSyncError extends Error {
  readonly code: number;
  readonly errors: Record<string, unknown>;

  constructor(message: string, opts: { code: number; errors: Record<string, unknown> }) {
    super(message);
    this.name = 'SafeSyncError';
    this.code = opts.code;
    this.errors = opts.errors;
  }
}

export class SafeSyncNarrowingBlockedError extends SafeSyncError {
  constructor(message: string) {
    super(message, { code: 409, errors: { root: 'NarrowingBlocked' } });
    this.name = 'SafeSyncNarrowingBlockedError';
  }
}

export class SafeSyncSnapshotRequiredError extends SafeSyncError {
  constructor(message: string) {
    super(message, { code: 412, errors: { root: 'SnapshotRequired' } });
    this.name = 'SafeSyncSnapshotRequiredError';
  }
}

export type SafeSyncReport = {
  dryRun: boolean;
  createdTables: string[];
  addedColumns: Array<{ table: string; column: string }>;
  widenedColumns: Array<{ table: string; column: string; from: string; to: string }>;
  createdIndexes: Array<{ table: string; name: string }>;
  snapshotWritten: boolean;
  autoNameRecomputed: string[];
};

function stableIdentHash(input: unknown) {
  const s = String(input ?? '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function stableJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const norm = (v: any): any => {
    if (v == null) return v;
    if (typeof v !== 'object') return v;
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(norm);
    if (seen.has(v)) return null;
    seen.add(v);
    const out: any = {};
    for (const k of Object.keys(v).sort((a, b) => a.localeCompare(b))) out[k] = norm(v[k]);
    return out;
  };
  return JSON.stringify(norm(value));
}

function parseColumnType(t: unknown): { kind: string; len?: number } {
  const s = String(t ?? '').toLowerCase();
  const m = s.match(/^character varying\((\d+)\)/) || s.match(/^varchar\((\d+)\)/);
  if (m) return { kind: 'varchar', len: Number(m[1]) };
  if (s.includes('text')) return { kind: 'text' };
  if (s.includes('bigint')) return { kind: 'bigint' };
  if (s.includes('integer') || s.includes('int4')) return { kind: 'int' };
  if (s.includes('boolean')) return { kind: 'boolean' };
  if (s.includes('jsonb')) return { kind: 'jsonb' };
  if (s.includes('timestamp')) return { kind: 'datetime' };
  if (s.includes('double precision') || s.includes('float')) return { kind: 'number' };
  return { kind: s.split('(')[0] || s };
}

function desiredTypeFromAttr(attr: any): { kind: string; len?: number; sql: string } {
  const type = attr?.type;
  const sql = typeof type?.toSql === 'function' ? String(type.toSql()) : String(type ?? '');
  const parsed = parseColumnType(sql);

  // Sequelize may use VARCHAR(255) for DataTypes.STRING.
  if (type && typeof type === 'object' && (type as any).key === 'STRING') {
    const len = Number((type as any)._length ?? NaN);
    return { kind: 'varchar', len: Number.isFinite(len) ? len : 255, sql };
  }
  if (type && typeof type === 'object' && (type as any).key === 'TEXT') return { kind: 'text', sql };
  if (type && typeof type === 'object' && (type as any).key === 'INTEGER') return { kind: 'int', sql };
  if (type && typeof type === 'object' && (type as any).key === 'BIGINT') return { kind: 'bigint', sql };
  return { ...parsed, sql };
}

function isWidening(from: { kind: string; len?: number }, to: { kind: string; len?: number }): boolean {
  if (from.kind === to.kind) {
    if (from.kind === 'varchar') return (to.len ?? 0) >= (from.len ?? 0);
    return true;
  }
  if (from.kind === 'varchar' && to.kind === 'text') return true;
  if (from.kind === 'int' && to.kind === 'bigint') return true;
  return false;
}

function fieldTypeForDsl(f: any): { kind: string; len?: number } {
  const t = String(f?.type ?? '').toLowerCase();
  if (t === 'text') return { kind: 'text' };
  if (t === 'string') return { kind: 'varchar', len: Number(f?.length ?? f?.max ?? 255) };
  if (t === 'int' || t === 'integer') return { kind: 'int' };
  if (t === 'bigint') return { kind: 'bigint' };
  if (t === 'boolean') return { kind: 'boolean' };
  if (t === 'jsonb' || t === 'json') return { kind: 'jsonb' };
  if (t === 'date' || t === 'datetime') return { kind: 'datetime' };
  return { kind: t || 'unknown' };
}

function equalAutoName(a: unknown, b: unknown): boolean {
  const aa = Array.isArray(a) ? a.map(String) : [];
  const bb = Array.isArray(b) ? b.map(String) : [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
  return true;
}

function getPkField(model: ModelStatic<Model>): string {
  const pk = (model as any).primaryKeyAttribute;
  if (typeof pk === 'string' && pk) return pk;
  const pks = (model as any).primaryKeyAttributes;
  if (Array.isArray(pks) && pks[0]) return String(pks[0]);
  return 'id';
}

function computeAutoName(row: Record<string, any>, fields: string[]): string | null {
  const parts: string[] = [];
  for (const f of fields) {
    const v = row[f];
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    parts.push(s);
  }
  if (!parts.length) return null;
  return parts.join('_');
}

function defaultLogger(): Logger {
  return {
    info: (...args: any[]) => console.log(...args),
    warn: (...args: any[]) => console.warn(...args),
    error: (...args: any[]) => console.error(...args),
  };
}

function topoSortModels(modelKeys: string[], dsl: DslRoot): string[] {
  const deps = new Map<string, Set<string>>();
  for (const k of modelKeys) deps.set(k, new Set());

  for (const modelKey of modelKeys) {
    const spec = dsl[modelKey];
    if (!isDslModelSpec(spec)) continue;
    for (const f of Object.values(spec.fields || {})) {
      if (!f || typeof f !== 'object') continue;
      const source = (f as any).source;
      if (source) deps.get(modelKey)?.add(String(source));
    }
  }

  const out: string[] = [];
  const perm = new Set<string>();
  const temp = new Set<string>();

  const visit = (n: string) => {
    if (perm.has(n)) return;
    if (temp.has(n)) return; // cycle: fall back to lexical
    temp.add(n);
    for (const d of deps.get(n) || []) if (deps.has(d)) visit(d);
    temp.delete(n);
    perm.add(n);
    out.push(n);
  };

  for (const n of [...modelKeys].sort((a, b) => a.localeCompare(b))) visit(n);
  return out;
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

async function getLatestSnapshotRow(model: ModelStatic<Model>) {
  if (!(model as any).rawAttributes?.dsl) return null;
  const rows = await (model as any).findAll({ order: [['id', 'DESC']], limit: 1, raw: true });
  return rows?.[0] ?? null;
}

function assertNoNarrowing(prevDsl: DslRoot, nextDsl: DslRoot) {
  for (const [modelKey, prevSpec] of Object.entries(prevDsl)) {
    if (modelKey === '$schema') continue;
    if (!isDslModelSpec(prevSpec)) continue;
    const nextSpec = nextDsl[modelKey];
    if (!isDslModelSpec(nextSpec)) throw new SafeSyncNarrowingBlockedError(`SafeSync: model removed (narrowing): ${modelKey}`);

    const prevFields = prevSpec.fields || {};
    const nextFields = nextSpec.fields || {};

    for (const [fieldKey, prevField] of Object.entries(prevFields)) {
      if (!prevField || typeof prevField !== 'object') continue;
      if ((prevField as any).save === false) continue;
      const nextField = nextFields[fieldKey];
      if (!nextField) throw new SafeSyncNarrowingBlockedError(`SafeSync: field removed (narrowing): ${modelKey}.${fieldKey}`);
      const from = fieldTypeForDsl(prevField);
      const to = fieldTypeForDsl(nextField);
      if (!isWidening(from, to)) {
        throw new SafeSyncNarrowingBlockedError(
          `SafeSync: narrowing type change blocked: ${modelKey}.${fieldKey} (${from.kind}${from.len ? `(${from.len})` : ''} -> ${to.kind}${to.len ? `(${to.len})` : ''})`,
        );
      }
    }
  }
}

export type SafeSyncOptions = {
  sequelize: Sequelize;
  orm: OrmInitResult;
  dsl: DslRoot;
  logger?: Logger;
  snapshotModelKey?: string;
  snapshot?: { modelKey?: string; requireSnapshot?: boolean; allowNoSnapshot?: boolean };
  dryRun?: boolean;
};

export async function safeSync(opts: SafeSyncOptions): Promise<SafeSyncReport> {
  const logger = opts.logger ?? defaultLogger();
  const dryRun = opts.dryRun === true;
  const snapshotModelKey = opts.snapshot?.modelKey ?? opts.snapshotModelKey ?? 'dsl';
  const requireSnapshot = opts.snapshot?.requireSnapshot === true;
  const allowNoSnapshot = opts.snapshot?.allowNoSnapshot !== undefined ? opts.snapshot.allowNoSnapshot === true : true;

  const models = opts.orm.models;
  const modelKeys = Object.keys(models).sort((a, b) => a.localeCompare(b));
  const ordered = topoSortModels(modelKeys, opts.dsl);

  const qi = opts.sequelize.getQueryInterface();
  const report: SafeSyncReport = {
    dryRun,
    createdTables: [],
    addedColumns: [],
    widenedColumns: [],
    createdIndexes: [],
    snapshotWritten: false,
    autoNameRecomputed: [],
  };

  // Snapshot-based narrowing checks (mandatory: snapshot model required).
  const snapshotModel = (models as any)[snapshotModelKey] as ModelStatic<Model> | undefined;
  let prevSnapshotDsl: DslRoot | null = null;
  if (!snapshotModel) {
    throw new SafeSyncSnapshotRequiredError(`SafeSync requires a DSL snapshot model: ${snapshotModelKey}`);
  }
  if (snapshotModel) {
    const tn = (snapshotModel as any).getTableName?.() ?? snapshotModelKey;
    const table = typeof tn === 'string' ? tn : (tn as any).tableName;
    if (await tableExists(opts.sequelize, table)) {
      const row = await getLatestSnapshotRow(snapshotModel);
      if (row?.dsl) prevSnapshotDsl = row.dsl as any;
      if (!prevSnapshotDsl && (!allowNoSnapshot || requireSnapshot)) {
        throw new SafeSyncSnapshotRequiredError('SafeSync requires an existing DSL snapshot');
      }
    } else if (!allowNoSnapshot || requireSnapshot) {
      throw new SafeSyncSnapshotRequiredError('SafeSync requires an existing DSL snapshot table');
    }
  }
  if (prevSnapshotDsl) assertNoNarrowing(prevSnapshotDsl, opts.dsl);

  // Create/alter tables in FK dependency order.
  for (const modelKey of ordered) {
    const model = models[modelKey];
    if (!model) continue;
    const tableName = (model as any).getTableName?.() ?? modelKey;
    const table = typeof tableName === 'string' ? tableName : (tableName as any).tableName;

    const exists = await tableExists(opts.sequelize, table);
    const attrs = (model as any).getAttributes ? (model as any).getAttributes() : (model as any).rawAttributes;
    if (!exists) {
      if (!dryRun) await qi.createTable(table, attrs);
      report.createdTables.push(table);
    }

    let described: any = {};
    if (exists) described = await qi.describeTable(table);
    else if (!dryRun) described = await qi.describeTable(table);

    for (const [attrKey, attr] of Object.entries(attrs || {})) {
      const col = (attr as any).field || attrKey;
      if (!described[col]) {
        if (!dryRun) await qi.addColumn(table, col, attr as any);
        report.addedColumns.push({ table, column: col });
        continue;
      }

      const current = parseColumnType((described as any)[col]?.type);
      const desired = desiredTypeFromAttr(attr);
      if (!isWidening(current, desired)) {
        // Do nothing (non-destructive), but snapshot check above should have blocked narrowing in DSL-driven cases.
        continue;
      }

      const currentSql = String((described as any)[col]?.type);
      if (currentSql.toLowerCase() === desired.sql.toLowerCase()) continue;

      // Only widen when it is actually a change (varchar len, varchar->text, int->bigint).
      if (current.kind === desired.kind && current.kind !== 'varchar') continue;
      if (current.kind === desired.kind && current.kind === 'varchar' && (desired.len ?? 0) === (current.len ?? 0)) continue;

      if (!dryRun) await qi.changeColumn(table, col, attr as any);
      report.widenedColumns.push({ table, column: col, from: currentSql, to: desired.sql });
    }

    // Visible index
    const pk = getPkField(model);
    const idxBase = `idx_${table}_visible`;
    const idxName = idxBase.length <= 60 ? idxBase : `idx_${stableIdentHash(table)}_visible`;
    const hasDeleted = !!(model as any).rawAttributes?.deleted;
    const hasArchived = !!(model as any).rawAttributes?.archived;
    if (hasDeleted && hasArchived) {
      const sql = `CREATE INDEX IF NOT EXISTS ${idxName} ON ${table}(${pk}) WHERE deleted=false AND archived=false`;
      if (!dryRun) await opts.sequelize.query(sql);
      report.createdIndexes.push({ table, name: idxName });
    }

    // DSL-defined indexes (unique/many)
    const dslSpec = opts.dsl[modelKey];
    if (isDslModelSpec(dslSpec)) {
      const idx = dslSpec.indexes || ({} as any);
      const unique = Array.isArray((idx as any).unique) ? ((idx as any).unique as string[][]) : [];
      const many = Array.isArray((idx as any).many) ? ((idx as any).many as string[][]) : [];

      const mkName = (prefix: string, cols: string[]) => {
        const base = `${prefix}_${table}_${cols.join('_')}`;
        return base.length <= 60 ? base : `${prefix}_${stableIdentHash(base)}`;
      };

      const mapCol = (k: string) => {
        const a = (attrs as any)[k];
        return a?.field || k;
      };

      for (const cols of unique) {
        const mapped = cols.map(mapCol);
        const name = mkName('uidx', mapped);
        if (hasDeleted && hasArchived) {
          const sql = `CREATE UNIQUE INDEX IF NOT EXISTS ${name} ON ${table}(${mapped.join(
            ',',
          )}) WHERE deleted=false AND archived=false`;
          if (!dryRun) await opts.sequelize.query(sql);
        } else {
          const sql = `CREATE UNIQUE INDEX IF NOT EXISTS ${name} ON ${table}(${mapped.join(',')})`;
          if (!dryRun) await opts.sequelize.query(sql);
        }
        report.createdIndexes.push({ table, name });
      }

      for (const cols of many) {
        const mapped = cols.map(mapCol);
        const name = mkName('idx', mapped);
        if (hasDeleted && hasArchived) {
          const sql = `CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${mapped.join(',')}) WHERE deleted=false AND archived=false`;
          if (!dryRun) await opts.sequelize.query(sql);
        } else {
          const sql = `CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${mapped.join(',')})`;
          if (!dryRun) await opts.sequelize.query(sql);
        }
        report.createdIndexes.push({ table, name });
      }

      // Auto-name recompute (optional, requires snapshot)
      if (prevSnapshotDsl) {
        const prevSpec = prevSnapshotDsl[modelKey];
        if (isDslModelSpec(prevSpec)) {
          const prevAuto = (prevSpec as any).auto_name;
          const nextAuto = (dslSpec as any).auto_name;
          if (!equalAutoName(prevAuto, nextAuto) && Array.isArray(nextAuto) && nextAuto.length) {
            const fields = nextAuto.map(String);
            if ((model as any).rawAttributes?.auto_name) {
              const pkField = getPkField(model);
              const rows = (await (model as any).findAll({
                where: {
                  ...(hasDeleted ? { deleted: false } : {}),
                  ...(hasArchived ? { archived: false } : {}),
                },
                attributes: [pkField, 'auto_name', ...fields],
                raw: true,
              })) as Array<Record<string, any>>;
              for (const row of rows) {
                const v = computeAutoName(row, fields);
                if (!dryRun) await (model as any).update({ auto_name: v }, { where: { [pkField]: row[pkField] } });
              }
              report.autoNameRecomputed.push(modelKey);
            }
          }
        }
      }
    }
  }

  // Write snapshot after success (optional).
  if (snapshotModel && !dryRun) {
    const json = stableJsonStringify(opts.dsl);
    const hash = stableIdentHash(json);

    const attrs = (snapshotModel as any).rawAttributes || {};
    const row: Record<string, unknown> = {
      ...(attrs.hash ? { hash } : {}),
      ...(attrs.dsl ? { dsl: opts.dsl } : {}),
      ...(attrs.created_at ? { created_at: new Date() } : {}),
    };

    if (Object.keys(row).length) {
      await (snapshotModel as any).create(row);
      report.snapshotWritten = true;
      logger.info('[safeSync] snapshot stored', { hash });
    }
  }

  return report;
}
