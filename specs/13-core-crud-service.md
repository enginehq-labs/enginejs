# EngineJS Specs — Core CRUD Service (Non-HTTP)

EngineJS MUST provide a core CRUD service that is callable from:

- workflows (runner steps)
- custom application code (without Express/HTTP)

This avoids duplicating ACL/RLS/pipeline logic inside HTTP adapters.

## Service: `CrudService` (core)

`@enginehq/core` MUST export `CrudService`.

### Required behaviors (MVP)

- Enforce model-level ACL for `list|read|create|update|delete` unless explicitly bypassed.
- Enforce RLS:
  - `scope` for `list|read|update|delete`
  - `writeGuard` for `create|update` (anti-forgery), including `writeMode` behavior
- Default filters (unless overridden):
  - `deleted=false`
  - `archived=false`
- Support pipelines (optional per call):
  - `beforeValidate` → `validate` → `beforePersist` → DB write → `afterPersist` → optional `response`
- Support DSL virtual fields (`save:false`):
  - accepted for pipeline/validation
  - stripped before DB writes

### Options

Each call MAY accept:

- `runPipelines: boolean` (default true)
- `runResponsePipeline: boolean` (default true for read/list; default false for create/update internal usage)
- `bypassAclRls: boolean` (default false; intended for audited system workflows only)

Workflow-event emission is intentionally NOT automatic in this service in the MVP. HTTP adapters (e.g. `@enginehq/express`) remain responsible for emitting outbox events on successful HTTP mutations.

## Workflow steps (built-in)

WorkflowRunner MUST support CRUD-based steps that use `CrudService`.

### Step: `crud.create`

```json
{
  "op": "crud.create",
  "model": "comment",
  "values": {
    "post_id": { "from": "after.id" },
    "body": "Hello"
  },
  "options": { "runPipelines": false }
}
```

Semantics:

- For `actorMode=inherit|impersonate`, this step MUST enforce ACL/RLS like normal CRUD.
- For `actorMode=system`, this step MAY set `bypassAclRls=true` (audited).

### Step: `crud.list` (minimal)

```json
{
  "op": "crud.list",
  "model": "comment",
  "query": { "filters": "post_id:1", "limit": 50 },
  "options": { "runPipelines": false }
}
```

MVP: the result is not yet addressable by subsequent workflow steps (no variable binding). It exists to support custom step handlers and future runner enhancements.

