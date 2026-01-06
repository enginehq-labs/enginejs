# EngineJS Specs — Changelog

## Changelog (recent)

- 2026-01-06: Prepared Technical Preview release docs (root README + ROADMAP) and bumped packages to `0.1.0`.
- 2026-01-02: Initialized EngineJS spec set and moved monolithic spec into `specs/`; established deterministic regeneration contract.
- 2026-01-02: Added testing system spec (unit/integration/e2e) and required regen verification.
- 2026-01-02: Switched publishable package naming to `@enginehq/*` and added unscoped `enginehq` umbrella package.
- 2026-01-02: Added deterministic `npm run gen` workflow (templates → outputs) and updated clean-room regen to use the generator.
- 2026-01-02: Implemented `DslRegistry` in `@enginehq/core` (fragment load, system-field augmentation, Ajv validation, virtual constraints) with unit tests.
- 2026-01-02: Documented AI-assisted spec→code workflow; added `npm run cycle` runner for gen→test iteration.
- 2026-01-02: Added Sequelize ORM adapter in `@enginehq/core` to initialize models/associations (incl. junction tables) from compiled DSL with unit tests.
- 2026-01-02: Added `@enginehq/express` adapter package with envelope/actor/services middleware and minimal CRUD skeleton plus tests.
- 2026-01-02: Added `RlsEngine` to `@enginehq/core` (multi-subject anyOf/allOf + bypass + write guards) with unit tests.
- 2026-01-02: Added QueryParser (filters/sort/includeDepth/page/limit/find) and `EngineConfig.http.hideExistence` toggle for 403 vs 404 policy.
- 2026-01-05: Implemented MVP `AclEngine` (model-level allow/deny) and upgraded `@enginehq/express` CRUD router to execute list/read/create/update/delete with QueryParser + RLS + hideExistence.
- 2026-01-05: Implemented `PipelineEngine` (phases + DSL field transforms/validators + plugin ops) and wired it into CRUD create/update and list/read response phase.
- 2026-01-05: Implemented WorkflowEngine + durable outbox store and enqueued CRUD mutation events after `afterPersist`.
- 2026-01-05: Implemented `createEngine().init()` lifecycle: compile DSL from FS, init Sequelize ORM/models, register core services, and added `@enginehq/express` helper to mount an initialized engine.
- 2026-01-05: Added Docker Postgres integration test that validates HTTP create -> pipelines -> workflow outbox insert (skips when Docker is unavailable).
- 2026-01-05: Added WorkflowRunner (claim/dispatch/execute/retry) with a Postgres integration test proving `db.update` workflow steps run from outbox events.
- 2026-01-05: Specified scheduler + stale-processing replayer behaviors, added `interval|datetime` actions, and defined audited actor modes (`inherit|system|impersonate`).
- 2026-01-05: Added deterministic `.gitignore`/`.npmignore` templates for monorepo root and each workspace package.
- 2026-01-05: Added npm publish allowlists via `"files": ["dist"]` for each publishable package.
- 2026-01-05: Added per-package `README.md` templates and included them in npm tarballs via `"files"` allowlists.
- 2026-01-05: Added MIT `LICENSE` templates (root + packages), included in tarballs, and added deterministic publish scripts (`release:check`, `release:publish`).
- 2026-01-06: Expanded safe-sync spec (snapshot rules, hashed visible indexes) and added migrations runner spec (tracking table + deterministic runner API).
- 2026-01-06: Switched clean-room regen (`verify_regen`) to `npm ci` to prevent lockfile drift during e2e tests.
- 2026-01-06: Added Express admin endpoints spec for `POST /admin/sync` and migrations (`/admin/migrations/*`) with ACL gating + hideExistence behavior.
- 2026-01-06: Added `EngineConfig.migrations` and optional default `migrationRunner` wiring for admin migrations endpoints.
- 2026-01-06: Enforced workflow `db.update` steps through ACL/RLS for non-system actors (audited system bypass).
- 2026-01-06: Implemented RLS `via` join/path scoping and added adapter translation to SQL predicates.
- 2026-01-06: Added workflow outbox retention maintenance (archive/delete/none) for terminal events.
- 2026-01-06: Updated outbox retention semantics: `delete` mode also deletes `archived` rows (supports archive→delete cleanup).
- 2026-01-06: Added auth/sessions specs (JWT HS256 + optional refresh sessions with rotation and revocation).
- 2026-01-06: Implemented `@enginehq/auth` package (JWT + session rotation/revocation + optional Sequelize session store) and added it to deterministic codegen + release flow.
- 2026-01-06: Added core `CrudService` spec (non-HTTP CRUD for workflows/app code) and defined workflow `crud.*` step ops.
