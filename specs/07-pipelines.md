# EngineJS Specs — Pipelines (Transforms + Validators)

## Canonical phases

EngineJS MUST define stable pipeline phases and ordering:

1) `beforeValidate`
2) `validate`
3) `beforePersist`
4) `afterPersist`
5) `response`

Phases MUST be available per action:

- `list`, `read`, `create`, `update`, `delete`

## Virtual fields

Pipelines MUST be able to validate/consume virtual fields, but virtual fields MUST NOT be persisted.

## Built-in ops (minimum)

Transforms:

- `trim`, `lowercase`, `defaults`, `set`, `remove/redact`
- `fieldBasedTransform` (DSL-driven per-field transform list)

Validators:

- `required` (DSL-driven), `email`, `length`, `min/max`, `enum`
- `fieldBasedValidator` (DSL-driven per-field validators)

## Pipeline registry spec (MVP)

Plugins register per-model pipeline specs via the `pipelines` registry service:

```ts
export type PipelineModelSpec = {
  create?: {
    beforeValidate?: Array<{ op: string; [k: string]: unknown }>;
    validate?: Array<{ op: string; [k: string]: unknown }>;
    beforePersist?: Array<{ op: string; [k: string]: unknown }>;
    afterPersist?: Array<{ op: string; [k: string]: unknown }>;
    response?: Array<{ op: string; [k: string]: unknown }>;
  };
  update?: { /* same phases */ };
  read?: { /* same phases */ };
  list?: { /* same phases */ };
  delete?: { /* same phases */ };
};
```

Notes:

- Registry ops are executed in array order.
- EngineJS MAY run implicit DSL-driven ops:
  - `fieldBasedTransform` during `beforeValidate`
  - `fieldBasedValidator` during `validate`
  even when the registry spec does not explicitly include those ops.

## User-defined functions

EngineJS MUST support user-defined validators/transforms by reference.

Safety:

- SHOULD support a restricted mode controlling access to services/fs/network.

## CRUD helper access

Pipelines MUST be able to call CRUD via services, with explicit flags:

- `skipACL`, `runPipelines`, `emitWorkflowEvent`, `actor` override
