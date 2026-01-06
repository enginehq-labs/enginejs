# EngineJS Specs — Architecture

## Goals

- EngineJS is a reusable backend framework: apps are composed from **DSL + plugins + configuration**.
- Core must be runnable in multiple modes:
  - HTTP server (Express adapter)
  - CLI (sync/migrations/seed)
  - Workers (workflow/outbox/scheduler)

## Module boundaries (conceptual)

- `Config` — typed config + validation
- `DslRegistry` — fragment discovery, compile/validate, snapshots, diffs
- `OrmAdapter` — ORM init, associations, safe sync
- `CrudEngine` — list/read/create/update/delete; query parsing; include graph
- `AclEngine` — role-based allow/deny + response pruning
- `RlsEngine` — multi-subject row scoping + anti-forgery write guards
- `PipelineEngine` — pipeline phases + built-in ops + user functions
- `WorkflowEngine` — outbox durability, dispatcher/executor, scheduler
- `ServiceContainer` — DI for core + plugins + pipelines + workflows

## Lifecycle

EngineJS MUST initialize in this order:

1) Load + validate config
2) Create service container and register core services
3) Load plugins and allow them to register services
4) Compile + validate DSL (in-memory augmentation before validation)
5) Initialize ORM models and relations from DSL
6) Create engines (ACL/RLS/Pipelines/CRUD/Workflows) and register them as services
7) Let plugins observe `onDslLoaded` and `onModelsReady`
8) Start runtime entrypoint (HTTP / CLI / worker)

`createEngine().init()` is responsible for steps 2–7 and MUST leave the runtime with:

- `engine.dsl` populated (compiled DSL)
- `engine.orm` populated (initialized Sequelize models)
- core services registered (`db`, `dsl`, `models`, `acl`, `rls`, `pipelines`, `workflows`, etc.)

## Public vs internal API

EngineJS MUST define a stable “public API surface” for:

- types (`EngineConfig`, `Actor`, `RlsConfig`, plugin interfaces)
- service container API
- plugin registration hooks

Anything outside the public surface is internal and may change without notice.
