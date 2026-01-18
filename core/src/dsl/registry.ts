import fs from 'node:fs';
import path from 'node:path';

import { Ajv2020 } from 'ajv/dist/2020.js';
import * as addFormats from 'ajv-formats';

import { DslConstraintError, DslLoadError, DslValidationError } from './errors.js';
import { isDslModelSpec, type DslModelSpec, type DslRoot } from './types.js';
import { ENGINEJS_DEFAULT_DSL_SCHEMA } from './schema.js';

export type DslFsConfig = {
  modelsDir: string;
  metaDir: string;
  allowMonolithDslJson?: boolean;
  monolithPath?: string;
};

export type CompiledDsl = {
  dsl: DslRoot;
  sources: Array<{ modelKey: string; filePath: string }>;
};

function readJsonFile(filePath: string): unknown {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    throw new DslLoadError(`Failed to read JSON: ${filePath}`, { filePath, cause: e });
  }
}

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile());
  return entries
    .map((d) => d.name)
    .filter((n) => n.toLowerCase().endsWith('.json'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(dir, name));
}

function fragmentToModels(fragment: unknown, defaultModelKey: string): Record<string, DslModelSpec> {
  if (!fragment || typeof fragment !== 'object' || Array.isArray(fragment)) {
    throw new DslLoadError(`Invalid DSL fragment shape (expected object)`, { defaultModelKey });
  }

  const obj = fragment as Record<string, unknown>;
  const out: Record<string, DslModelSpec> = {};

  // If it looks like a direct ModelSpec, bind it to the default key.
  if (isDslModelSpec(obj)) {
    out[defaultModelKey] = obj;
    return out;
  }

  for (const [k, v] of Object.entries(obj)) {
    if (k === '$schema') continue;
    if (isDslModelSpec(v)) out[k] = v;
  }

  if (!Object.keys(out).length) {
    throw new DslLoadError(`DSL fragment produced no models`, { defaultModelKey });
  }

  return out;
}

export function augmentDslWithSystemFields(dsl: DslRoot): void {
  const modelKeys = Object.keys(dsl)
    .filter((k) => k !== '$schema')
    .sort((a, b) => a.localeCompare(b));

  for (const modelKey of modelKeys) {
    const spec = dsl[modelKey];
    if (!isDslModelSpec(spec)) continue;

    if (!spec.ui || typeof spec.ui !== 'object' || Array.isArray(spec.ui)) spec.ui = {};
    if (!Object.prototype.hasOwnProperty.call(spec.ui, 'sort')) {
      (spec.ui as any).sort = ['-created_at'];
    }

    const fields = (spec.fields ||= {});

    fields.created_at ??= { type: 'datetime' };
    fields.updated_at ??= { type: 'datetime' };
    fields.deleted ??= { type: 'boolean', default: false };
    fields.deleted_at ??= { type: 'datetime' };
    fields.archived ??= { type: 'boolean', default: false };
    fields.archived_at ??= { type: 'datetime' };
    fields.auto_name ??= { type: 'string', length: 512 };
  }
}

export function assertVirtualFieldConstraints(dsl: DslRoot): void {
  for (const [modelKey, spec] of Object.entries(dsl)) {
    if (modelKey === '$schema') continue;
    if (!isDslModelSpec(spec)) continue;

    const fields = spec.fields || {};
    const virtual = new Set(
      Object.entries(fields)
        .filter(([, f]) => !!f && typeof f === 'object' && (f as any).save === false)
        .map(([k]) => k),
    );

    if (virtual.size) {
      for (const vField of virtual) {
        const f = fields[vField] as any;
        const forbidden = [
          'source',
          'sourceid',
          'columnName',
          'multi',
          'unique',
          'primary',
          'autoIncrement',
          'canfind',
        ];
        for (const key of forbidden) {
          if (f?.[key] !== undefined) {
            throw new DslConstraintError(
              `Virtual field cannot define ${key} (${modelKey}.${vField})`,
              { modelKey, field: vField, key },
            );
          }
        }
      }

      const autoName = Array.isArray(spec.auto_name) ? spec.auto_name : [];
      for (const f of autoName) {
        if (virtual.has(f)) {
          throw new DslConstraintError(
            `Virtual field cannot be referenced by auto_name (${modelKey}.${f})`,
            { modelKey, field: f },
          );
        }
      }

      const indexes = spec.indexes || {};
      for (const kind of ['unique', 'many', 'lower'] as const) {
        const lists = Array.isArray((indexes as any)[kind]) ? ((indexes as any)[kind] as string[][]) : [];
        for (const idx of lists) {
          for (const f of idx) {
            if (virtual.has(f)) {
              throw new DslConstraintError(
                `Virtual field cannot be referenced by indexes.${kind} (${modelKey}.${f})`,
                { modelKey, field: f, indexKind: kind },
              );
            }
          }
        }
      }
    }
  }
}

type SchemaInput = string | Record<string, unknown> | undefined;

function resolveSchema(input: SchemaInput): Record<string, unknown> {
  if (!input) return ENGINEJS_DEFAULT_DSL_SCHEMA;
  if (typeof input === 'string') return readJsonFile(input) as any;
  return input;
}

export function validateDslOrThrow(dsl: DslRoot, schemaInput?: SchemaInput): void {
  const schema = resolveSchema(schemaInput);
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  (addFormats as any).default?.(ajv);
  const validate = ajv.compile(schema as any);
  const ok = validate(dsl as any);
  if (!ok) throw new DslValidationError('Invalid DSL schema', validate.errors || []);
}

export function compileDslFromFs(fsConfig: DslFsConfig, schemaInput?: SchemaInput): CompiledDsl {
  const modelsDir = path.resolve(fsConfig.modelsDir);
  const metaDir = path.resolve(fsConfig.metaDir);

  const modelFiles = listJsonFiles(modelsDir);
  const metaFiles = listJsonFiles(metaDir);

  const useFragments = modelFiles.length > 0 || metaFiles.length > 0;
  const allowMonolith = fsConfig.allowMonolithDslJson === true;
  const monolithPath = fsConfig.monolithPath ? path.resolve(fsConfig.monolithPath) : undefined;

  const dsl: DslRoot = {};
  const sources: Array<{ modelKey: string; filePath: string }> = [];

  if (!useFragments) {
    if (!allowMonolith || !monolithPath || !fs.existsSync(monolithPath)) {
      throw new DslLoadError('No DSL fragments found and monolith DSL is not available', {
        modelsDir,
        metaDir,
        monolithPath,
      });
    }

    const monolith = readJsonFile(monolithPath);
    if (!monolith || typeof monolith !== 'object' || Array.isArray(monolith)) {
      throw new DslLoadError('Invalid monolith DSL shape', { monolithPath });
    }
    Object.assign(dsl, monolith as any);
  } else {
    const files = [...metaFiles, ...modelFiles];
    for (const filePath of files) {
      const fragment = readJsonFile(filePath);
      const defaultKey = path.basename(filePath, path.extname(filePath));
      const models = fragmentToModels(fragment, defaultKey);
      const schemaVal =
        fragment && typeof fragment === 'object' && !Array.isArray(fragment)
          ? (fragment as any).$schema
          : undefined;
      if (typeof schemaVal === 'string' && !dsl.$schema) dsl.$schema = schemaVal;

      for (const [modelKey, modelSpec] of Object.entries(models)) {
        dsl[modelKey] = modelSpec;
        sources.push({ modelKey, filePath });
      }
    }
  }

  augmentDslWithSystemFields(dsl);
  validateDslOrThrow(dsl, schemaInput);
  assertVirtualFieldConstraints(dsl);

  return { dsl, sources };
}
