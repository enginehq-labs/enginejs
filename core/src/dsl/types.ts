export type DslIndexSpec = {
  unique?: string[][];
  many?: string[][];
  lower?: string[][];
};

export type DslFieldSpec = {
  type?: string;
  label?: string;
  length?: number;
  max?: number;
  size?: number;
  required?: boolean;
  default?: unknown;
  save?: boolean;

  multi?: boolean;
  unique?: boolean;
  primary?: boolean;
  autoIncrement?: boolean;
  canfind?: boolean;

  source?: string;
  sourceid?: string;
  columnName?: string;
  as?: string;
  inverseAs?: string;
  onDelete?: string;
  onUpdate?: string;

  transforms?: Array<{ name: string; args?: unknown }>;
  validate?: Array<{ name: string; args?: unknown }>;
  ui?: { label?: string; [k: string]: unknown };
};

export type DslModelSpec = {
  table?: string;
  auto_name?: string[];
  pipelines?: Partial<
    Record<
      'list' | 'read' | 'create' | 'update' | 'delete',
      Partial<
        Record<
          'beforeValidate' | 'validate' | 'beforePersist' | 'afterPersist' | 'response',
          Array<{ op: string; [k: string]: unknown }>
        >
      >
    >
  >;
  fields: Record<string, DslFieldSpec>;
  indexes?: DslIndexSpec;
  access?: import('../acl/types.js').DslAccessSpec;
  ui?: { sort?: string[]; [k: string]: unknown };
};

export type DslRoot = {
  $schema?: string;
  [key: string]: unknown;
};

export function isDslModelSpec(v: unknown): v is DslModelSpec {
  if (!v || typeof v !== 'object') return false;
  const fields = (v as any).fields;
  return !!fields && typeof fields === 'object' && !Array.isArray(fields);
}
