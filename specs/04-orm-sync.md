# EngineJS Specs — ORM Adapter + Safe Sync

## ORM adapter boundary

EngineJS MUST implement an ORM adapter abstraction. Default adapter is Sequelize + Postgres.

Minimum adapter capability (step 2):

- Create Sequelize models and associations from compiled DSL **without** syncing to the database.
- Support:
  - scalar FK `belongsTo` + reverse `hasMany`
  - `multi:true` string arrays (as `ARRAY(STRING)`)
  - `multi:true` int FK junction tables + `belongsToMany` conveniences

## Model init requirements

- exact names (no pluralization)
- `freezeTableName: true`
- timestamps disabled when using explicit system fields

## Safe sync (widening-only)

Safe sync MUST:

- create missing tables and columns
- apply widening-only type changes
- NEVER drop or narrow existing schema

Safe sync MUST be callable from application code as a library function (core), and MAY be exposed via HTTP/CLI by adapters.

Snapshot rules:

- when a prior DSL snapshot exists, narrowing changes MUST be blocked relative to the snapshot
  - narrowing includes: removing a field, decreasing varchar length, changing `text` → `string`, `bigint` → `int`, or any type change not explicitly whitelisted as widening-only.

## DSL snapshot (meta model)

EngineJS requires a DSL snapshot meta model named `dsl` to store the last compiled DSL used for safe sync comparisons.

Minimum schema (suggested):

- `id` (int, primary, autoIncrement)
- `hash` (string, unique)
- `dsl` (jsonb)
- `created_at` (datetime)

Rules:

- Safe sync MUST fail fast if the snapshot model is missing (sync is mandatory).
- Safe sync MUST write a new snapshot row after a successful run.

## Visible index

Must ensure:

```sql
CREATE INDEX IF NOT EXISTS idx_<table>_visible
ON <table>(<pk>)
WHERE deleted=false AND archived=false;
```

Index name MUST be stable and avoid Postgres identifier truncation (63 bytes). If `idx_<table>_visible` would exceed the limit, safe sync MUST use a deterministic hashed name.

## Junction tables for `multi:true` + int FK

When a field is `multi:true`, `type:int`, and has `{ source, sourceid }`:

- do NOT create a scalar column on owner table
- create junction table:
  - `${owner}__${field}__to__${source}__${sourceid}`
- columns:
  - `id`, `${owner}Id`, `${source}Id`
  - system fields
- if field has `unique:true`, create composite unique on (`${owner}Id`, `${source}Id`) scoped to visible rows
- index names MUST be stable + short (hash) to avoid Postgres 63-byte truncation issues

## Auto-name backfill

If `auto_name` definition changes relative to prior snapshot:

- recompute `auto_name` for all rows
- join non-empty values with underscores; if all empty => NULL

Implementation notes:

- Computation MUST mimic request-time behavior (trimmed values; skip null/empty).
- Recompute MUST be in-place and non-destructive.
