import type { WorkflowActorMode, WorkflowSpec, WorkflowStep, WorkflowTrigger } from './spec.js';

export type WorkflowSpecValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type WorkflowSpecValidationResult = {
  ok: boolean;
  issues: WorkflowSpecValidationIssue[];
  fields: Record<string, string>;
};

function addIssue(out: WorkflowSpecValidationResult, issue: WorkflowSpecValidationIssue) {
  out.issues.push(issue);
  if (!out.fields[issue.path]) out.fields[issue.path] = issue.message;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function validateActorMode(spec: Record<string, unknown>, out: WorkflowSpecValidationResult) {
  const mode = spec.actorMode as WorkflowActorMode | undefined;
  if (mode == null) return;
  if (mode !== 'inherit' && mode !== 'system' && mode !== 'impersonate') {
    addIssue(out, { path: 'actorMode', code: 'InvalidEnum', message: 'actorMode must be inherit|system|impersonate' });
    return;
  }
  if (mode === 'impersonate') {
    const imp = spec.impersonate;
    if (!isPlainObject(imp)) {
      addIssue(out, { path: 'impersonate', code: 'Required', message: 'impersonate is required when actorMode=impersonate' });
      return;
    }
    if (!asString(imp.subject).trim()) addIssue(out, { path: 'impersonate.subject', code: 'Required', message: 'impersonate.subject is required' });
    if (!asString(imp.idFrom).trim()) addIssue(out, { path: 'impersonate.idFrom', code: 'Required', message: 'impersonate.idFrom is required' });
  }
}

function validateTrigger(t: WorkflowTrigger, i: number, out: WorkflowSpecValidationResult) {
  const base = `triggers[${i}]`;
  const type = (t as any)?.type;
  if (type !== 'model' && type !== 'interval' && type !== 'datetime') {
    addIssue(out, { path: `${base}.type`, code: 'InvalidEnum', message: 'trigger.type must be model|interval|datetime' });
    return;
  }

  if (type === 'model') {
    const model = asString((t as any).model).trim();
    if (!model) addIssue(out, { path: `${base}.model`, code: 'Required', message: 'trigger.model is required' });
    const actions: string[] = Array.isArray((t as any).actions) ? (t as any).actions.map((x: any) => String(x)) : [];
    const ok = actions.filter((a: string) => a === 'create' || a === 'update' || a === 'delete');
    if (!actions.length) addIssue(out, { path: `${base}.actions`, code: 'Required', message: 'trigger.actions must be a non-empty array' });
    else if (ok.length !== actions.length) {
      addIssue(out, { path: `${base}.actions`, code: 'InvalidEnum', message: 'trigger.actions may only include create|update|delete' });
    }
    return;
  }

  if (type === 'interval') {
    const unit = asString((t as any).unit);
    const allowed = ['minutes', 'hours', 'days', 'weeks', 'months', 'years'];
    if (!allowed.includes(unit)) {
      addIssue(out, { path: `${base}.unit`, code: 'InvalidEnum', message: `trigger.unit must be one of ${allowed.join('|')}` });
    }
    const value = asNumber((t as any).value);
    if (value == null || value <= 0) addIssue(out, { path: `${base}.value`, code: 'InvalidNumber', message: 'trigger.value must be a positive number' });
    return;
  }

  // datetime
  const field = asString((t as any).field).trim();
  if (!field) addIssue(out, { path: `${base}.field`, code: 'Required', message: 'trigger.field is required' });
  const direction = asString((t as any).direction);
  if (direction !== 'exact' && direction !== 'before' && direction !== 'after') {
    addIssue(out, { path: `${base}.direction`, code: 'InvalidEnum', message: 'trigger.direction must be exact|before|after' });
  }
  if (direction === 'before' || direction === 'after') {
    const unit = asString((t as any).unit);
    const allowed = ['minutes', 'hours', 'days', 'weeks', 'months', 'years'];
    if (!allowed.includes(unit)) {
      addIssue(out, { path: `${base}.unit`, code: 'Required', message: `trigger.unit is required for ${direction} and must be one of ${allowed.join('|')}` });
    }
    const value = asNumber((t as any).value);
    if (value == null || value <= 0) addIssue(out, { path: `${base}.value`, code: 'Required', message: `trigger.value is required for ${direction} and must be positive` });
  }
}

function validateStep(step: WorkflowStep, i: number, out: WorkflowSpecValidationResult) {
  const base = `steps[${i}]`;
  const op = asString((step as any)?.op);
  const allowed = ['db.update', 'crud.create', 'crud.list', 'log', 'custom'];
  if (!allowed.includes(op)) {
    addIssue(out, { path: `${base}.op`, code: 'InvalidEnum', message: `step.op must be one of ${allowed.join('|')}` });
    return;
  }

  if (op === 'log') {
    if (!asString((step as any).message).trim()) addIssue(out, { path: `${base}.message`, code: 'Required', message: 'log.message is required' });
    return;
  }

  if (op === 'custom') {
    if (!asString((step as any).name).trim()) addIssue(out, { path: `${base}.name`, code: 'Required', message: 'custom.name is required' });
    return;
  }

  if (!asString((step as any).model).trim()) addIssue(out, { path: `${base}.model`, code: 'Required', message: 'step.model is required' });

  if (op === 'db.update') {
    const where = (step as any).where;
    if (!isPlainObject(where)) {
      addIssue(out, { path: `${base}.where`, code: 'Required', message: 'db.update.where is required' });
    } else if (!asString(where.field).trim()) {
      addIssue(out, { path: `${base}.where.field`, code: 'Required', message: 'db.update.where.field is required' });
    }
    const set = (step as any).set;
    if (!isPlainObject(set) || !Object.keys(set).length) {
      addIssue(out, { path: `${base}.set`, code: 'Required', message: 'db.update.set must be a non-empty object' });
    }
    return;
  }

  if (op === 'crud.create') {
    const values = (step as any).values;
    if (!isPlainObject(values)) addIssue(out, { path: `${base}.values`, code: 'Required', message: 'crud.create.values is required' });
    const opts = (step as any).options;
    if (opts != null && !isPlainObject(opts)) addIssue(out, { path: `${base}.options`, code: 'InvalidType', message: 'options must be an object' });
    if (isPlainObject(opts) && opts.runPipelines != null && typeof opts.runPipelines !== 'boolean') {
      addIssue(out, { path: `${base}.options.runPipelines`, code: 'InvalidType', message: 'options.runPipelines must be boolean' });
    }
    return;
  }

  if (op === 'crud.list') {
    const query = (step as any).query;
    if (query != null && !isPlainObject(query)) addIssue(out, { path: `${base}.query`, code: 'InvalidType', message: 'crud.list.query must be an object' });
    const opts = (step as any).options;
    if (opts != null && !isPlainObject(opts)) addIssue(out, { path: `${base}.options`, code: 'InvalidType', message: 'options must be an object' });
    if (isPlainObject(opts) && opts.runPipelines != null && typeof opts.runPipelines !== 'boolean') {
      addIssue(out, { path: `${base}.options.runPipelines`, code: 'InvalidType', message: 'options.runPipelines must be boolean' });
    }
  }
}

export function validateWorkflowSpec(input: unknown): WorkflowSpecValidationResult {
  const out: WorkflowSpecValidationResult = { ok: true, issues: [], fields: {} };

  if (!isPlainObject(input)) {
    addIssue(out, { path: 'root', code: 'InvalidType', message: 'Workflow spec must be an object' });
    out.ok = false;
    return out;
  }

  const spec = input as Record<string, unknown>;
  validateActorMode(spec, out);

  const triggers = spec.triggers;
  if (!Array.isArray(triggers) || !triggers.length) {
    addIssue(out, { path: 'triggers', code: 'Required', message: 'triggers must be a non-empty array' });
  } else {
    triggers.forEach((t, i) => {
      if (!isPlainObject(t)) {
        addIssue(out, { path: `triggers[${i}]`, code: 'InvalidType', message: 'trigger must be an object' });
        return;
      }
      validateTrigger(t as any, i, out);
    });
  }

  const steps = spec.steps;
  if (!Array.isArray(steps) || !steps.length) {
    addIssue(out, { path: 'steps', code: 'Required', message: 'steps must be a non-empty array' });
  } else {
    steps.forEach((s, i) => {
      if (!isPlainObject(s)) {
        addIssue(out, { path: `steps[${i}]`, code: 'InvalidType', message: 'step must be an object' });
        return;
      }
      validateStep(s as any, i, out);
    });
  }

  const retry = spec.retry;
  if (retry != null) {
    if (!isPlainObject(retry)) addIssue(out, { path: 'retry', code: 'InvalidType', message: 'retry must be an object' });
    else {
      const maxAttempts = asNumber((retry as any).maxAttempts);
      if (maxAttempts != null && (maxAttempts < 0 || !Number.isInteger(maxAttempts))) {
        addIssue(out, { path: 'retry.maxAttempts', code: 'InvalidNumber', message: 'retry.maxAttempts must be an integer >= 0' });
      }
      for (const k of ['baseDelayMs', 'maxDelayMs'] as const) {
        const v = asNumber((retry as any)[k]);
        if (v != null && v < 0) addIssue(out, { path: `retry.${k}`, code: 'InvalidNumber', message: `retry.${k} must be >= 0` });
      }
    }
  }

  out.ok = out.issues.length === 0;
  return out;
}

export function assertWorkflowSpecOrThrow(input: unknown): WorkflowSpec {
  const res = validateWorkflowSpec(input);
  if (res.ok) return input as WorkflowSpec;
  const err: any = new Error('Invalid workflow spec');
  err.code = 400;
  err.errors = { root: 'InvalidWorkflowSpec', fields: res.fields };
  err.issues = res.issues;
  throw err;
}
