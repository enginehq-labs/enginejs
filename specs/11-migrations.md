# EngineJS Specs — Migrations (MVP)

EngineJS MUST provide a minimal migrations runner in `@enginehq/core` so apps can apply data-safe changes that safe-sync cannot.

## Tracking table

Runner MUST track executed migrations in a table.

- Default table name: `engine_migrations`
- Columns:
  - `id` (string, primary)
  - `executed_at` (datetime)

## Migration shape (MVP)

A migration is:

- `id`: stable identifier (string), sortable
- `up(ctx)`: async function applied once

`ctx` MUST provide:

- `sequelize`
- `queryInterface`
- `logger`

## Runner behavior

- Ensure tracking table exists (create if missing).
- `status()` returns:
  - executed ids (sorted)
  - pending ids (sorted)
- `up()` runs pending migrations in order and records each `id` on success.
- Runner MUST be deterministic: stable ordering, no timestamps in logs, no randomness.

## Integrations (future)

Adapters MAY expose:

- HTTP admin endpoints (`/admin/migrations/status`, `/admin/migrations/up`)
- CLI commands (`migrations:status`, `migrations:up`)

## Default wiring (optional)

If `EngineConfig.migrations` is provided, `@enginehq/core` MAY register a default `migrationRunner` service for adapters to use.
