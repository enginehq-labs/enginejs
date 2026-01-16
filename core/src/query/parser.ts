import { QueryParseError } from './errors.js';
import type { FilterExpr, FilterGroup, ListQueryAst, Scalar, SortSpec } from './types.js';

function first(v: unknown): unknown {
  if (Array.isArray(v)) return v[0];
  return v;
}

function str(v: unknown): string | undefined {
  const x = first(v);
  if (x == null) return undefined;
  return String(x);
}

function parseBool(v: unknown): boolean {
  const s = String(first(v) ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function parseIntSafe(v: unknown): number | undefined {
  const s = String(first(v) ?? '').trim();
  if (!s) return undefined;
  if (!/^-?\d+$/.test(s)) return undefined;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function parseScalar(v: string): Scalar {
  const s = v.trim();
  const lower = s.toLowerCase();
  if (lower === 'null') return null;
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return s;
}

function isValidField(field: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field);
}

export function parseSort(sortParam: unknown): SortSpec[] {
  const s = str(sortParam);
  if (!s) return [];
  const parts = s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  const out: SortSpec[] = [];
  for (const p of parts) {
    const dir = p.startsWith('-') ? 'desc' : 'asc';
    const field = p.replace(/^[+-]/, '').trim();
    if (!field) continue;
    if (!isValidField(field)) throw new QueryParseError(`Invalid sort field: ${field}`, { field });
    out.push({ field, dir });
  }
  return out;
}

function parseFilterToken(token: string): { field: string; expr: FilterExpr } {
  const t = token.trim();
  if (!t) throw new QueryParseError('Empty filter token');

  const idx = t.indexOf(':');
  if (idx <= 0) throw new QueryParseError(`Invalid filter token (missing field): ${token}`, { token });

  const field = t.slice(0, idx).trim();
  let rest = t.slice(idx + 1);
  if (!field || !isValidField(field)) throw new QueryParseError(`Invalid filter field: ${field}`, { field });

  if (rest.includes('..')) {
    const [a, b] = rest.split('..');
    const minRaw = (a ?? '').trim();
    const maxRaw = (b ?? '').trim();
    if (!minRaw && !maxRaw) {
      throw new QueryParseError(`Invalid range filter: ${token}`, { token });
    }
    const expr: FilterExpr = {
      op: 'range',
      field,
      ...(minRaw ? { min: parseScalar(minRaw) } : {}),
      ...(maxRaw ? { max: parseScalar(maxRaw) } : {}),
    };
    return { field, expr };
  }

  const ops = ['>=', '<=', '!=', '>', '<', '='] as const;
  let opToken: (typeof ops)[number] | undefined;
  for (const o of ops) {
    if (rest.startsWith(o)) {
      opToken = o;
      rest = rest.slice(o.length);
      break;
    }
  }

  const valueRaw = rest.trim();
  const value = parseScalar(valueRaw);
  const op =
    opToken === '!='
      ? 'ne'
      : opToken === '>='
        ? 'gte'
        : opToken === '<='
          ? 'lte'
          : opToken === '>'
            ? 'gt'
            : opToken === '<'
              ? 'lt'
              : 'eq';

  if (op === 'eq' && typeof value === 'string' && value.includes('*')) {
    return { field, expr: { op: 'like', field, value } };
  }

  return { field, expr: { op, field, value } };
}

export function parseFilters(filtersParam: unknown): FilterGroup[] {
  const s = str(filtersParam);
  if (!s) return [];

  const tokens = s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  const byField = new Map<string, FilterExpr[]>();
  for (const tok of tokens) {
    const { field, expr } = parseFilterToken(tok);
    const arr = byField.get(field) ?? [];
    arr.push(expr);
    byField.set(field, arr);
  }

  const fields = [...byField.keys()].sort((a, b) => a.localeCompare(b));
  return fields.map((field) => ({ field, or: byField.get(field)! }));
}

export type ParseListQueryOptions = {
  defaultLimit?: number;
  maxLimit?: number;
  defaultPage?: number;
  defaultIncludeDepth?: number;
  maxIncludeDepth?: number;
};

export function parseListQuery(
  query: Record<string, unknown>,
  opts: ParseListQueryOptions = {},
): ListQueryAst {
  const includeDeleted = parseBool(query.includeDeleted);
  const includeArchived = parseBool(query.includeArchived);

  const includeDepthRaw = parseIntSafe(query.includeDepth);
  const defaultIncludeDepth = opts.defaultIncludeDepth ?? 0;
  const maxIncludeDepth = opts.maxIncludeDepth ?? 10;
  const includeDepth = Math.max(
    0,
    Math.min(maxIncludeDepth, includeDepthRaw ?? defaultIncludeDepth),
  );

  const defaultPage = opts.defaultPage ?? 1;
  const page = Math.max(1, parseIntSafe(query.page) ?? defaultPage);

  const defaultLimit = opts.defaultLimit ?? 50;
  const maxLimit = opts.maxLimit ?? 200;
  const limitRaw = parseIntSafe(query.limit);
  const limit =
    limitRaw === 0
      ? 0
      : Math.max(1, Math.min(maxLimit, limitRaw ?? defaultLimit));

  const sort = parseSort(query.sort);
  const filters = parseFilters(query.filters);
  const find = str(query.find)?.trim() || undefined;

  const out: ListQueryAst = {
    includeDeleted,
    includeArchived,
    includeDepth,
    page,
    limit,
    sort,
    filters,
  };
  if (find) out.find = find;
  return out;
}
