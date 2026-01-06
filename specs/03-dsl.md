# EngineJS Specs — DSL (Schema-as-Code)

## Sources

EngineJS MUST support DSL fragments:

- app fragments: `dsl/models/*.json`
- meta/system fragments: `dsl/meta/*.json`
- optional monolith: `dsl/dsl.json` (only when fragments are absent and compat allows)

Monolith fallback:

- If no fragments exist and monolith fallback is enabled, load `dsl/dsl.json` instead.
- If no fragments exist and monolith fallback is disabled, fail fast with a clear error.

## Compilation rules

- Runtime DSL is a single object `{ [modelKey]: ModelSpec, $schema?: string }`.
- Fragment filename (without `.json`) MUST equal the model key (unless explicitly overridden).
- Compilation MUST be deterministic (stable ordering, no reliance on filesystem ordering).

Deterministic compilation order:

- Load `dsl/meta/*.json` (sorted by filename) then `dsl/models/*.json` (sorted by filename).
- If a model key appears multiple times, **last write wins** in that deterministic order.

## Validation

- Ajv draft 2020-12, `allowUnionTypes: true`
- DSL MUST be augmented with system fields *before* validation (see below).

Validation errors MUST surface Ajv errors for debugging (without leaking secrets).

## System fields (augmented)

Before validation, every model MUST contain:

- `created_at`, `updated_at`
- `deleted`, `deleted_at`
- `archived`, `archived_at`
- `auto_name` (STRING nullable) if missing from fields

## Virtual fields

A field with `"save": false`:

- is validated and can appear in request payloads
- MUST NOT become a DB column
- MUST be stripped from DB writes

Virtual fields MUST NOT specify:

- `source`, `sourceid`, `columnName`, `multi`, `unique`, `primary`, `autoIncrement`, `canfind`

Virtual fields MUST NOT be referenced by:

- `auto_name`
- `indexes.*`

## Relations

### BelongsTo (scalar FK)

If a field defines `{ source, sourceid }` and `multi != true`:

- owner model belongsTo(source)
- source model hasMany(owner)
- default reverse alias is the owner model key
- `as` overrides belongsTo alias; `inverseAs` overrides reverse alias
- alias starting with `$` MUST be skipped by auto-includes

### Multi-valued fields

- `multi: true` + `type: string` => array column (`string[]`), no FK allowed
- `multi: true` + `type: int` + `{ source, sourceid }` => junction table (see `specs/04-orm-sync.md`)

## Indexes

- `indexes.unique` MUST be partial unique with `WHERE deleted=false AND archived=false`
- `indexes.many` MUST be non-unique
- `indexes.lower` MUST be recorded for manual migrations (not auto-created)

## `required`

- enforced at API level only
- MUST NOT implicitly create DB `NOT NULL`

## ACL `access`

Models MAY define an `access` object to control CRUD authorization (see `specs/06-auth-acl-rls.md`).
