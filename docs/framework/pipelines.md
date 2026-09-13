# EngineJS Framework: Pipeline Architecture

## Introduction
EngineJS use a pluggable Pipeline architecture to transform, validate, and process data during the request lifecycle. Pipelines are composed of discrete "Ops" (operations) that run within specific "Phases" for each CRUD action.

## Pipeline Phases
For `create` and `update` without a bypass, the phases run in the order below. `read` and `list` run only `response`. `delete` runs no phase, and the bypass paths skip some phases.

1. **`beforeValidate`**: Initial data sanitization and transformation (e.g., trimming strings, setting defaults).
2. **`validate`**: Data integrity checks. The phase checks all fields, then throws one `PipelineValidationError` that holds every field error.
3. **`beforePersist`**: Final adjustments before the data is sent to the ORM (e.g., hashing passwords, injecting derived values).
4. **`afterPersist`**: Post-write logic (e.g., clearing caches). The outbox event is not written here: the CRUD service emits it after the `response` phase. The database transaction is committed before this phase if managed by the CRUD service.
5. **`response`**: Transformation of the final result before it is sent to the client (e.g., redacting sensitive fields).

## Built-in Ops
EngineJS provides several highly-optimized built-in operations:

### Sanitization
- **`trim`**: Removes leading/trailing whitespace from specified fields.
- **`lowercase`**: Converts specified fields to lowercase.
- **`strip_unknown_fields`**: Removes fields from the payload that are not defined in the model's DSL. It does nothing when the `restrict_unknown_fields` environment variable is `0`.
- **`coerce_empty_to_null`**: Converts empty strings to `null` for numeric, datetime, and boolean types.

### Data Manipulation
- **`defaults`**: Sets values for fields if they are currently `undefined`.
- **`set`**: Force-sets a field to a specific value.
- **`remove`**: Removes specific fields from the payload.
- **`redact`**: Replaces the value of specific fields with a placeholder (default is `null`).

### DSL Integration
- **`fieldBasedTransform`**: Automatically runs all transforms defined at the field level in the DSL.
- **`fieldBasedValidator`**: Automatically runs all validators defined at the field level in the DSL.

## Field-Level DSL Config
Pipelines can be configured directly on model fields in the DSL:

```json
"email": {
  "type": "string",
  "required": true,
  "transforms": [{ "name": "trim" }, { "name": "lowercase" }],
  "validate": [{ "name": "email" }]
}
```

### Implicit Behavior
- Field-level **transforms** are implicitly executed during the `beforeValidate` phase.
- Field-level **validators** (including the `required` check) are implicitly executed during the `validate` phase.

## Custom Ops & Extensibility
Any code that registers a service can add a custom pipeline operation: a plugin, the `enginehq` autoload of an `ops` export, or the built-in auth router, which registers `hashPassword`.

1. **Register Service**: A plugin registers a service with the name `pipelines.custom.<op_name>`.
2. **Implementation**: The service factory returns a function with the signature `(ctx: PipelineCtx, args: unknown) => void`. The function must change `ctx.input` in place, because the engine ignores its return value.
3. **DSL Usage**: The custom op can then be referenced in the model's pipeline spec using `{ "op": "custom", "name": "<op_name>", "args": { ... } }`.

## Error Handling
- **`PipelineValidationError`**: Thrown when validation fails, containing a map of field-level error messages.
- **`PipelineNotImplementedError`**: Thrown when a pipeline references a custom operation that has not been registered in the service container.
