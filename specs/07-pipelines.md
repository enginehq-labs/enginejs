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

## Pipeline spec location (MVP)

Per-model pipeline specs MUST live inside the model DSL under `pipelines`, not in the `pipeline/` folder.

Example:

```json
{
  "customer": {
    "fields": { "email": { "type": "string" } },
    "pipelines": {
      "create": { "beforeValidate": [{ "op": "lowercase", "field": "email" }] }
    }
  }
}
```

## Pipeline spec shape (MVP)

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

EngineJS MUST support user-defined field validators/transforms by reference.

### App authoring surface

In an EngineJS app, the `pipeline/` folder is the single place to put pipeline function code:

- custom pipeline ops
- field-level validators
- field-level transforms

### Loading convention (enginehq runtime)

Each file in `pipeline/` MAY export:

- `validators`: `{ [name: string]: (ctx, args) => unknown }`
- `transforms`: `{ [name: string]: (ctx, args) => unknown }`
- `ops`: `{ [name: string]: (ctx, args) => unknown }`

The runtime MUST register functions into the service registry as:

- `pipelines.validator.<name>`
- `pipelines.transform.<name>`
- `pipelines.custom.<name>`

### DSL reference convention

DSL field specs reference validators/transforms by `name`:

- `fields.<field>.validate = [{ name: "<validatorName>", args?: any }]`
- `fields.<field>.transforms = [{ name: "<transformName>", args?: any }]`

### Execution semantics (MVP)

- Built-ins MUST be supported (`email`, `length`, `min`, `max`, `enum`, etc.)
- Unknown validator/transform names MUST be treated as misconfiguration and fail the request with a “not implemented” error.
- Custom validators MAY:
  - return `false` to fail (`"Invalid"`)
  - return a string to fail with that message
  - throw an error to fail (recommended for structured errors)
- Custom transforms MUST return the transformed value for that field.

Reserved built-in validator names:

- `workflowSpec` — validates that a JSON payload is a valid workflow spec (triggers/steps/actor mode/etc.) and throws `InvalidWorkflowSpec` with per-path `errors.fields`.

Safety:

- SHOULD support a restricted mode controlling access to services/fs/network.

## CRUD helper access

Pipelines MUST be able to call CRUD via services, with explicit flags:

- `skipACL`, `runPipelines`, `emitWorkflowEvent`, `actor` override
