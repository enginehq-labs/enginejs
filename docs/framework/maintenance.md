# EngineJS Framework: Maintenance (Safe Sync & Migrations)

## Introduction
EngineJS provides two complementary systems for managing database schema evolution: **Safe Sync** for automated, non-destructive DSL-driven updates, and a **Migration Runner** for explicit, imperative schema changes.

## Safe Sync
Safe Sync is an automated tool that synchronizes the database schema with the compiled DSL. It is designed to be "safe" by only performing widening (additive) schema changes and blocking narrowing (destructive) operations that it finds by a comparison with the last DSL snapshot. With no snapshot, `allowNoSnapshot` defaults to true, so the first sync runs with no check (issue #11).

### Widening Rules
Safe Sync only permits changes that do not risk data loss:
- **Create Table**: Automatically creates tables for new models in the DSL.
- **Add Column**: Automatically adds new fields to existing tables.
- **Widen Column**: Permits type changes that increase capacity (e.g., `VARCHAR(50)` -> `VARCHAR(100)`, `VARCHAR` -> `TEXT`, `INT` -> `BIGINT`).
- **Create Index**: Automatically creates missing unique and many indexes defined in the DSL. It creates the visible index only for a model with both `deleted` and `archived` columns, and then the indexes are partial.

### Destructive Change Blocking
Safe Sync uses a **DSL Snapshot** mechanism to detect and block narrowing changes:
- **Blocked**: Removing a model or field.
- **Blocked**: Reducing column length or narrowing types (e.g., `TEXT` -> `VARCHAR`).
- **Not detected**: Removing an index. The snapshot comparison checks models and field types only (issue #11).

Safe Sync also recomputes the `auto_name` column on existing rows when the `auto_name` definition of a model changes.

To perform destructive changes, developers must use the imperative Migration Runner. No CLI command runs migrations: use the `migrationRunner` service or the admin routes.

### DSL Snapshotting
Successful Safe Sync operations write a snapshot of the current DSL to the database (usually in the `dsl` meta model). This snapshot is used as the baseline for the next sync operation to ensure safety guarantees.

## Migration Runner
The Migration Runner is used for explicit schema changes that cannot be handled automatically by Safe Sync, or for operations that are intentionally destructive.

### Migration Lifecycle
1. **Definition**: Migrations are defined as an array of objects with a unique `id` and an `up` function.
2. **Status Tracking**: Executed migrations are tracked in the `engine_migrations` table.
3. **Execution**: The runner sorts migrations by ID and executes only those that have not been applied yet.

### Context
The `up` function receives a context containing:
- `sequelize`: The initialized Sequelize instance.
- `queryInterface`: The low-level Sequelize QueryInterface.
- `logger`: The system logger.

## Recommended Workflow
1. **Development**: Use Safe Sync for rapid iteration on the data model.
2. **Production/Breaking Changes**: Use the Migration Runner for complex migrations, data transformations, or destructive schema changes.
3. **Hybrid**: Safe Sync can be run alongside the Migration Runner to handle boilerplate additions automatically.
