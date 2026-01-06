# EngineJS Roadmap

EngineJS is currently a **Technical Preview**. This roadmap is intentionally short and oriented around getting to a stable `1.0`.

## 0.1.x (Technical Preview)

- Stabilize exported API surface for:
  - DSL registry + ORM init + safe sync
  - ACL/RLS (incl. `via` join scoping)
  - pipelines + workflows/outbox runner/scheduler/replayer/retention
- Improve docs and examples (non–pf-backend-specific).
- Expand `CrudService` parity (read/update/delete, includeDepth, find, junction behaviors) and reduce duplication between core and HTTP.

## 0.2.x

- Express-first auth helpers:
  - optional DB-backed sessions (`auth_session`) with refresh rotation + revocation
  - middleware + ergonomic `resolveActor` helpers
- More built-in workflow steps:
  - `crud.update`, `crud.read`
  - `db.insert`, `db.delete` (scoped and audited)

## 0.3.x

- Observability hooks:
  - structured logger interface
  - metrics/events around CRUD, pipeline phases, workflow execution, retries
- Better migration ergonomics (runner UX and CLI patterns).

## 1.0.0

- Versioned, documented public API stability guarantees.
- Compatibility/migration guides for selected reference apps (including `pf-backend` as a separate guide after EngineJS is stable).

