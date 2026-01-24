# Implementation Plan: System Observability & Structured Logging

## Phase 1: Core Logging & Context Infrastructure [checkpoint: 507c4a8]
- [x] Task: Define Logger interface and Context storage in `@enginehq/core`. 65e9c10
    - [x] Create `Logger` interface in `core/src/observability/types.ts`.
    - [x] Implement `RequestContext` using `AsyncLocalStorage` to store `traceId`.
- [x] Task: Implement Pino-based LogManager. 4152d6a
    - [x] Implement a factory to create `pino` instances with standard EngineJS formatting.
    - [x] Integrate the logger into the `Engine` container.
- [x] Task: Write unit tests for context propagation. 65e9c10
    - [x] Verify that logs correctly pick up the `traceId` from the `AsyncLocalStorage`.
- [x] Task: Conductor - User Manual Verification 'Phase 1: Core Logging & Context Infrastructure' (Protocol in workflow.md) [checkpoint: 507c4a8]

## Phase 2: HTTP & Express Integration
- [ ] Task: Implement Observability Middleware in `@enginehq/express`.
    - [ ] Create middleware to generate `traceId` (if missing) and set up the `RequestContext`.
    - [ ] Implement request/response logging (status, latency, path).
- [ ] Task: Integrate middleware into Express bootstrap.
    - [ ] Update `createExpressApp` to mount the observability middleware as early as possible.
- [ ] Task: Write integration tests for HTTP tracing.
    - [ ] Verify that multiple concurrent requests receive unique `traceId`s and log correctly.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: HTTP & Express Integration' (Protocol in workflow.md)

## Phase 3: Deep Instrumentation (Workflows & DB)
- [ ] Task: Instrument Workflow execution.
    - [ ] Update the workflow runner to retrieve the `traceId` from the triggering event or context.
    - [ ] Ensure workflow logs include the original `traceId`.
- [ ] Task: Instrument Sequelize queries.
    - [ ] Add a Sequelize `beforeFind`, `beforeCreate`, etc., hook to inject the `traceId` as a SQL comment.
- [ ] Task: Write tests for end-to-end tracing.
    - [ ] Create a test case: HTTP Request -> Database Write -> Workflow Trigger -> Workflow Log.
    - [ ] Verify all logs share the same `traceId`.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Deep Instrumentation (Workflows & DB)' (Protocol in workflow.md)

## Phase 4: Finalization & Documentation
- [ ] Task: Documentation update.
    - [ ] Document the new `Logger` API in `conductor/framework/observability.md`.
    - [ ] Provide examples of manual logging within custom routes.
- [ ] Task: CLI log formatting.
    - [ ] Ensure `enginehq dev` provides a way to see "pretty" logs while maintaining JSON output.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Finalization & Documentation' (Protocol in workflow.md)