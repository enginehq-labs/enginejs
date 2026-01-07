# EngineJS Specs — HTTP (Express) + Generic CRUD

Implementation note:

- HTTP adapter lives in `@enginehq/express` and MUST provide `req.actor`, `req.services`, and `res.ok/res.fail`.
- Generic CRUD is implemented in `@enginehq/express` and is expected to work against ORM models initialized by the Sequelize adapter (`@enginehq/core`).
- `@enginehq/express` SHOULD provide a helper that mounts CRUD from an initialized engine runtime (no manual wiring of `getDsl/getOrm/getConfig`).

## Hide-existence policy (toggle)

EngineJS MUST support a configurable hide-existence policy (recommended default: true):

- When `hideExistence=true`, RLS/ACL denial on a single-resource read/update/delete SHOULD respond as `404 Not Found` instead of `403 Forbidden`.
- When `hideExistence=false`, denial SHOULD respond as `403 Forbidden`.

This policy MUST be configurable via `EngineConfig.http.hideExistence`.

## Response envelope

All JSON endpoints MUST return:

- success: `{ success: true, code, data, pagination }`
- error: `{ success: false, code, errors, message }`

## Default routes

- `GET /api/:model` (list)
- `GET /api/:model/:id` (read)
- `POST /api/:model` (create)
- `PATCH /api/:model/:id` (update)
- `DELETE /api/:model/:id` (soft delete)

## Admin routes (MVP)

Express adapter MUST expose admin endpoints (basePath-aware):

- `POST /admin/sync` — run safe sync (widening-only, non-destructive)
- `GET /admin/migrations/status` — executed vs pending migrations
- `POST /admin/migrations/up` — run all pending migrations

### Authorization

Admin endpoints MUST be gated by ACL + hideExistence policy:

- The adapter MUST evaluate access using the `dsl` model:
  - allow when actor can `create` OR `update` on model `dsl`
  - deny otherwise
- When `EngineConfig.http.hideExistence=true`, denied requests MUST return 404. Otherwise return 403.

### `/admin/sync` behavior

- MUST call `@enginehq/core` safe sync against the configured DB using the compiled DSL + initialized ORM models.
- MUST respond with a stable JSON report (no timestamps), including at least:
  - created tables
  - added columns
  - widened columns
  - created indexes
  - whether a snapshot was written (when `dsl` model exists)

Request body (JSON) MAY include:

- `dryRun: boolean` — compute report but do not apply schema changes
- `requireSnapshot: boolean` — fail when no prior snapshot exists
- `allowNoSnapshot: boolean` — when false, fail when no prior snapshot exists

Errors MUST be consistent:

- Narrowing blocked: `409` with `errors.root="NarrowingBlocked"`
- Snapshot required: `412` with `errors.root="SnapshotRequired"`

### Migrations endpoints behavior (MVP)

- Adapter MUST use a `migrationRunner` service if present (job-scoped or singleton).
- If no `migrationRunner` service is registered, endpoints MUST return 501 with `Misconfigured`.

## Workflow management (DB-backed workflows)

When `engine.workflows.registry="db"`, EngineJS apps store workflow definitions in the `workflow` meta model and manage workflows through **generic CRUD** (`/api/workflow`) using the `workflow` model’s ACL/RLS.

### Requirements

- Requires `dsl/meta/workflow.json` with fields:
  - `slug` (string, unique) — machine-readable key
  - `name` (string) — display name
  - `description` (text) — optional UI description
  - `enabled` (boolean)
  - `spec` (jsonb) — the workflow spec (triggers/steps/etc.)
- CRUD create/update/delete on the `workflow` model MUST update the in-memory workflow registry in-process (no restart needed for API-driven edits).
- Workflow `spec` MUST be validated during CRUD `validate` phase (so UI gets field-level errors via the normal CRUD error envelope).

### Authorization

Use the normal CRUD authorization:

- model-level ACL from `workflow.access`
- RLS policies for the active actor (if configured)

### Error codes (MVP)

- Invalid workflow spec: `400` with `errors.root="InvalidWorkflowSpec"` and `errors.fields` containing per-path messages.
- Not found: `404` with `errors.root="Not found"`.

## Workflow outbox (when enabled)

When `config.workflows` is enabled, create/update/delete MUST enqueue a durable outbox event after `afterPersist` and before the HTTP response (see `specs/08-workflows-outbox.md`).

## Default filters

List/read default:

- `deleted=false`
- `archived=false`

Overrides:

- `?includeDeleted=1|true`
- `?includeArchived=1|true`

## Filtering grammar (`filters`)

`?filters=field:value,field:>10,other:!=x`

- `field:OPvalue` where OP in `> >= < <= != =`
- range: `field:min..max`, `field:..max`, `field:min..`
- same-field tokens are ORed; different fields are ANDed
- strings with `*` use case-insensitive wildcard (`ILIKE`)

Multi string arrays:

- `field:value` is array-contains
- wildcard uses `array_to_string(field, ' ') ILIKE ...`

Junction-backed multi-int FKs:

- `field:3` includes rows whose join table contains 3
- `field:!=3` excludes rows whose join table contains 3

## Global search (`find`)

`?find=<term>` MUST:

- search across `canfind:true` scalar string/text fields + string arrays + `auto_name`
- support scalar FK `canfind:true` via target `auto_name` (two-phase lookup applying RLS/ACL)
- be ANDed with filters and RLS

## Sorting

`?sort=field,-other`:

- ascending by default; `-` means DESC
- append PK `DESC` as deterministic tiebreaker when absent

## Includes (`includeDepth`)

- default `includeDepth=0`
- `includeDepth=0`: junction-backed multi-int FKs return as arrays of IDs
- `includeDepth>0`: include collections recursively up to depth
- associations with alias starting `$` MUST be skipped by auto-includes
