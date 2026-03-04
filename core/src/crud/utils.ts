import type { DslModelSpec, DslFieldSpec } from '../dsl/types.js';

export function isVirtualField(f: DslFieldSpec | undefined): boolean {
  return (f as any)?.save === false;
}

export function isStringArrayField(f: DslFieldSpec | undefined): boolean {
  return (f as any)?.multi === true && String((f as any)?.type || '').toLowerCase() === 'string';
}

export function isJunctionIntFkField(f: DslFieldSpec | undefined): boolean {
  const multi = (f as any)?.multi === true;
  const type = String((f as any)?.type || '').toLowerCase();
  const source = (f as any)?.source;
  const sourceid = (f as any)?.sourceid;
  return multi && (type === 'int' || type === 'integer' || type === 'bigint') && !!source && !!sourceid;
}

export function pruneUnknownPayload(
  spec: DslModelSpec,
  payload: Record<string, unknown>,
  restrictUnknownFields: boolean = process.env.restrict_unknown_fields?.trim() !== '0'
): Record<string, unknown> {
  if (!restrictUnknownFields) return { ...payload };
  const allowed = new Set(Object.keys(spec.fields || {}));
  if (!allowed.size) return { ...payload };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (allowed.has(k)) out[k] = v;
  }
  return out;
}

export function stripVirtualFields(spec: DslModelSpec, payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  for (const [field, f] of Object.entries(spec.fields || {})) {
    if (!f || typeof f !== 'object') continue;
    if (isVirtualField(f as any)) delete out[field];
  }
  return out;
}

export function parseArrayish(raw: unknown): unknown[] {
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

export function normalizePayloadMultiFields(
  spec: DslModelSpec,
  payload: Record<string, unknown>
): {
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

export function computeChangedFields(before: Record<string, unknown> | null, after: Record<string, unknown>): string[] {
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
