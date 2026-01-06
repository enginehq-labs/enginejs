# EngineJS Specs — Services (DI)

## Service container

EngineJS MUST provide a service container available in:

- HTTP requests
- pipelines
- workflows
- CLI

## Scopes

Minimum supported scopes:

- `singleton`
- `request`
- `job`

## Required services (names)

Core MUST provide at least:

- `logger`
- `config`
- `db`
- `orm`
- `models`
- `dsl`
- `acl`
- `rls`
- `pipelines` (registry of per-model pipeline specs)
- `workflows` (when enabled)

Core MAY additionally provide convenience engines:

- `pipelineEngine`
- `workflowEngine`
- `workflowRunner`
- `workflowScheduler`
- `workflowReplayer`
- `migrationRunner` (optional; adapter can expose admin endpoints)

## Safety rules

- External side effects MUST go through services.
- Plugins MUST register services explicitly.
