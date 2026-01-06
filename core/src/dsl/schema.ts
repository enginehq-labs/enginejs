import type { DslRoot } from './types.js';

// EngineJS-bundled DSL JSON schema (draft 2020-12).
// This schema is intentionally permissive in v0.x, but it is versioned with EngineJS.
export const ENGINEJS_DSL_SCHEMA_2020_12 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    $schema: { type: 'string' },
  },
  propertyNames: {
    anyOf: [{ const: '$schema' }, { pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$' }],
  },
  additionalProperties: {
    type: 'object',
    properties: {
      table: { type: 'string' },
      auto_name: { type: 'array', items: { type: 'string' } },
      fields: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            label: { type: 'string' },
            length: { type: 'number' },
            max: { type: 'number' },
            size: { type: 'number' },
            required: { type: 'boolean' },
            default: {},
            save: { type: 'boolean' },

            multi: { type: 'boolean' },
            unique: { type: 'boolean' },
            primary: { type: 'boolean' },
            autoIncrement: { type: 'boolean' },
            canfind: { type: 'boolean' },

            source: { type: 'string' },
            sourceid: { type: 'string' },
            columnName: { type: 'string' },
            as: { type: 'string' },
            inverseAs: { type: 'string' },
            onDelete: { type: 'string' },
            onUpdate: { type: 'string' },

            transforms: { type: 'array', items: { type: 'object' } },
            validate: { type: 'array', items: { type: 'object' } },
          },
          additionalProperties: true,
        },
      },
      indexes: {
        type: 'object',
        properties: {
          unique: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          many: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          lower: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
        },
        additionalProperties: true,
      },
      access: { type: 'object' },
    },
    required: ['fields'],
    additionalProperties: true,
  },
} as const satisfies Record<string, unknown>;

export const ENGINEJS_DEFAULT_DSL_SCHEMA: Record<string, unknown> = ENGINEJS_DSL_SCHEMA_2020_12;

export function asDslRootSchema(schema: unknown): Record<string, unknown> {
  return (schema && typeof schema === 'object' ? (schema as any) : ENGINEJS_DEFAULT_DSL_SCHEMA) as Record<
    string,
    unknown
  >;
}

export function isProbablyDslRoot(v: unknown): v is DslRoot {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

