import type { DslFieldSpec, DslModelSpec } from '../dsl/types.js';
import { assertWorkflowSpecOrThrow } from '../workflows/validate.js';
import type { PipelineAction, PipelineCtx, PipelineModelSpec, PipelineOp, PipelinePhase, PipelineResult } from './types.js';
import { PipelineNotImplementedError, PipelineValidationError } from './errors.js';

const RESTRICT_UNKNOWN_FIELDS = String(process.env.restrict_unknown_fields ?? '').trim() !== '0';
const NUMERICISH_TYPES = new Set(['int', 'integer', 'bigint', 'float', 'decimal', 'number']);
const DATETIMEISH_TYPES = new Set(['date', 'datetime']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function missingValueForRequired(v: unknown, f: DslFieldSpec): boolean {
  if (v == null) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  if ((f as any).multi === true && Array.isArray(v) && v.length === 0) return true;
  return false;
}

function normalizeEmail(s: string) {
  return s.trim();
}

function isEmail(s: string): boolean {
  const v = normalizeEmail(s);
  // Pragmatic (not RFC-complete) email check.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function applyTrim(obj: Record<string, unknown>, fields: string[]) {
  for (const f of fields) {
    const v = obj[f];
    if (typeof v === 'string') obj[f] = v.trim();
  }
}

function applyLowercase(obj: Record<string, unknown>, fields: string[]) {
  for (const f of fields) {
    const v = obj[f];
    if (typeof v === 'string') obj[f] = v.toLowerCase();
  }
}

function pruneUnknownFields({
  current,
  modelSpec,
}: {
  current: Record<string, unknown>;
  modelSpec: DslModelSpec;
}) {
  if (!RESTRICT_UNKNOWN_FIELDS) return current;
  const allowed = new Set(Object.keys(modelSpec.fields || {}));
  if (!allowed.size) return current;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(current)) {
    if (allowed.has(k)) out[k] = v;
  }
  return out;
}

function coerceEmptyToNull({
  current,
  modelSpec,
  targeted,
}: {
  current: Record<string, unknown>;
  modelSpec: DslModelSpec;
  targeted: string[];
}) {
  const out: Record<string, unknown> = { ...current };
  for (const [field, spec] of Object.entries(modelSpec.fields || {})) {
    if (targeted.length && !targeted.includes(field)) continue;
    const type = String((spec as any)?.type || '').toLowerCase();
    const isNumeric = NUMERICISH_TYPES.has(type);
    const isDatetime = DATETIMEISH_TYPES.has(type);
    const isBool = type === 'boolean';
    if (!isNumeric && !isDatetime && !isBool) continue;
    const val = out[field];
    if (val === '' || (typeof val === 'string' && val.trim() === '')) {
      if (Object.prototype.hasOwnProperty.call(out, field)) out[field] = null;
    }
  }
  return out;
}

function pickFieldsForOp(op: { field?: string; fields?: string[] }): string[] {
  if (op.field) return [String(op.field)];
  if (Array.isArray(op.fields)) return op.fields.map((x) => String(x));
  return [];
}

function runCustomOp(ctx: PipelineCtx, op: { name: string; args?: unknown }) {
  const serviceName = `pipelines.custom.${op.name}`;
  if (!ctx.services.has(serviceName)) {
    throw new PipelineNotImplementedError(`Missing custom pipeline op service: ${serviceName}`);
  }
  const fn = ctx.services.get<(ctx: PipelineCtx, args: unknown) => unknown>(serviceName);
  return fn(ctx, op.args);
}

type FieldTransformFn = (ctx: PipelineCtx, args: { field: string; value: unknown; args?: unknown }) => unknown;
type FieldValidatorFn = (ctx: PipelineCtx, args: { field: string; value: unknown; args?: unknown }) => unknown;

function runFieldBasedTransforms(ctx: PipelineCtx): PipelineResult {
  const out = { ...ctx.input };
  for (const [field, f] of Object.entries(ctx.modelSpec.fields || {})) {
    if (!f || typeof f !== 'object') continue;
    const transforms = (f as any).transforms;
    if (!Array.isArray(transforms)) continue;
    for (const t of transforms) {
      const name = String((t as any)?.name || '');
      const args = (t as any)?.args;
      if (name === 'trim') applyTrim(out, [field]);
      else if (name === 'lowercase') applyLowercase(out, [field]);
      else if (name === 'defaults' && args !== undefined) {
        if (out[field] === undefined) out[field] = args;
      } else if (name === 'set') {
        out[field] = args;
      } else if (name === 'remove' || name === 'redact') {
        delete out[field];
      } else {
        const serviceName = `pipelines.transform.${name}`;
        if (!ctx.services.has(serviceName)) {
          throw new PipelineNotImplementedError(`Missing field transform service: ${serviceName}`);
        }
        const fn = ctx.services.get<FieldTransformFn>(serviceName);
        out[field] = fn({ ...ctx, input: out }, { field, value: out[field], args });
      }
    }
  }
  return { output: out };
}

function runFieldBasedValidators(ctx: PipelineCtx): PipelineResult {
  const errors: Record<string, string> = {};
  const input = ctx.input;

  for (const [field, f] of Object.entries(ctx.modelSpec.fields || {})) {
    if (!f || typeof f !== 'object') continue;

    // Required: create checks all fields; update checks only provided fields.
    if ((f as any).required === true) {
      const shouldCheck = ctx.action === 'create' || field in input;
      if (shouldCheck && missingValueForRequired(input[field], f as any)) errors[field] = 'Required';
    }

    const validators = (f as any).validate;
    if (!Array.isArray(validators)) continue;

    for (const v of validators) {
      const name = String((v as any)?.name || '');
      const args = (v as any)?.args;
      const val = input[field];
      if (val == null) continue;

      if (name === 'email') {
        if (typeof val !== 'string' || !isEmail(val)) errors[field] = 'Invalid email';
      } else if (name === 'workflowSpec') {
        assertWorkflowSpecOrThrow(val);
      } else if (name === 'length') {
        if (typeof val !== 'string') continue;
        const min = isPlainObject(args) ? Number((args as any).min ?? 0) : 0;
        const max = isPlainObject(args) ? Number((args as any).max ?? Number.POSITIVE_INFINITY) : Number(args);
        if (Number.isFinite(min) && val.length < min) errors[field] = `Min length is ${min}`;
        if (Number.isFinite(max) && val.length > max) errors[field] = `Max length is ${max}`;
      } else if (name === 'min') {
        const n = typeof val === 'number' ? val : Number(val);
        const min = Number(args);
        if (Number.isFinite(n) && Number.isFinite(min) && n < min) errors[field] = `Min is ${min}`;
      } else if (name === 'max') {
        const n = typeof val === 'number' ? val : Number(val);
        const max = Number(args);
        if (Number.isFinite(n) && Number.isFinite(max) && n > max) errors[field] = `Max is ${max}`;
      } else if (name === 'enum') {
        const allowed = Array.isArray(args) ? args.map((x) => String(x)) : [];
        if (allowed.length && !allowed.includes(String(val))) errors[field] = 'Invalid value';
      } else {
        const serviceName = `pipelines.validator.${name}`;
        if (!ctx.services.has(serviceName)) {
          throw new PipelineNotImplementedError(`Missing field validator service: ${serviceName}`);
        }
        const fn = ctx.services.get<FieldValidatorFn>(serviceName);
        const res = fn({ ...ctx, input }, { field, value: val, args });
        if (res === false) errors[field] = 'Invalid';
        else if (typeof res === 'string' && res.trim()) errors[field] = res.trim();
      }
    }
  }

  if (Object.keys(errors).length) throw new PipelineValidationError('Validation failed', errors);
  return { output: ctx.input };
}

function opsFor(registrySpec: unknown, action: PipelineAction, phase: PipelinePhase): PipelineOp[] {
  if (!registrySpec || typeof registrySpec !== 'object') return [];
  const spec = registrySpec as PipelineModelSpec;
  const byAction = spec[action];
  if (!byAction || typeof byAction !== 'object') return [];
  const ops = (byAction as any)[phase];
  if (!Array.isArray(ops)) return [];
  return ops as PipelineOp[];
}

export class PipelineEngine {
  constructor(
    private readonly deps: {
      getModelSpec: (dsl: unknown, modelKey: string) => DslModelSpec | null;
    },
  ) {}

  runPhase(args: {
    dsl: unknown;
    registrySpec?: unknown;
    action: PipelineAction;
    phase: PipelinePhase;
    modelKey: string;
    actor: any;
    input: Record<string, unknown>;
    services: PipelineCtx['services'];
  }): PipelineResult {
    const modelSpec = this.deps.getModelSpec(args.dsl, args.modelKey);
    if (!modelSpec) throw new Error(`Unknown model: ${args.modelKey}`);

    let ctx: PipelineCtx = {
      action: args.action,
      phase: args.phase,
      modelKey: args.modelKey,
      modelSpec,
      actor: args.actor,
      input: args.input,
      services: args.services,
    };

    const ops = opsFor(args.registrySpec, args.action, args.phase);
    let current: Record<string, unknown> = { ...ctx.input };

    // Implicit DSL-driven behavior.
    if (args.phase === 'beforeValidate') {
      current = runFieldBasedTransforms({ ...ctx, input: current }).output;
    }
    if (args.phase === 'validate') {
      runFieldBasedValidators({ ...ctx, input: current });
    }

    for (const op of ops) {
      const name = String((op as any).op || '');
      const opName = name.toLowerCase();
      if (opName === 'trim') applyTrim(current, pickFieldsForOp(op as any));
      else if (opName === 'lowercase') applyLowercase(current, pickFieldsForOp(op as any));
      else if (opName === 'defaults') {
        const vals = (op as any).values;
        if (vals && typeof vals === 'object') {
          for (const [k, v] of Object.entries(vals as any)) if (current[k] === undefined) current[k] = v;
        }
      } else if (opName === 'set') {
        current[String((op as any).field)] = (op as any).value;
      } else if (opName === 'remove') {
        for (const f of (op as any).fields || []) delete current[String(f)];
      } else if (opName === 'redact') {
        const val = (op as any).value ?? null;
        for (const f of (op as any).fields || []) current[String(f)] = val;
      } else if (
        opName === 'prune_unknown_fields' ||
        opName === 'pruneunknownfields' ||
        opName === 'dropunknownfields' ||
        opName === 'drop_unknown_fields' ||
        opName === 'stripunknownfields' ||
        opName === 'strip_unknown_fields'
      ) {
        current = pruneUnknownFields({ current, modelSpec: ctx.modelSpec });
      } else if (
        opName === 'coalesce_empty_to_null' ||
        opName === 'coerce_empty_to_null' ||
        opName === 'empty_to_null' ||
        opName === 'nullify_empty'
      ) {
        const targeted = pickFieldsForOp(op as any);
        current = coerceEmptyToNull({ current, modelSpec: ctx.modelSpec, targeted });
      } else if (opName === 'fieldbasedtransform') {
        current = runFieldBasedTransforms({ ...ctx, input: current }).output;
      } else if (opName === 'fieldbasedvalidator') {
        runFieldBasedValidators({ ...ctx, input: current });
      } else if (opName === 'custom') {
        runCustomOp({ ...ctx, input: current }, op as any);
      } else {
        throw new PipelineNotImplementedError(`Unknown pipeline op: ${name}`);
      }
    }

    return { output: current };
  }
}
