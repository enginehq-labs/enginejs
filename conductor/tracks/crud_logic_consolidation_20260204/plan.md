# Plan: CRUD Logic Consolidation & Feature Parity

## Phase 1: Core Utilities Consolidation

- [x] Task: Move payload processing utilities to `@enginehq/core`. 83ffc8e
  - [x] Create `core/src/crud/utils.ts` and implement `pruneUnknownPayload`, `stripVirtualFields`, `parseArrayish`, and `normalizePayloadMultiFields`.
  - [x] Write unit tests in `core/test/unit/crud/utils.test.ts`.
- [x] Task: Integrate utilities into `CrudService`. 83ffc8e
  - [x] Update `CrudService` to use these utilities for all mutation operations (`create`, `update`).
  - [x] Ensure `core` unit tests pass.
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Core Utilities Consolidation' (Protocol in workflow.md)

## Phase 2: CrudService Feature Parity

- [ ] Task: Implement recursive expansion (`includeDepth`) in `CrudService`.
  - [ ] Write unit tests for `includeDepth` in `core/test/unit/crud/service.test.ts`.
  - [ ] Implement expansion logic in `read` and `list` methods.
- [ ] Task: Support complex filtering in `CrudService`.
  - [ ] Write unit tests for nested AND/OR and junction-based filters.
  - [ ] Implement filter parsing and application in `list` method.
- [ ] Task: Implement atomic junction updates.
  - [ ] Ensure `multi` field updates use Sequelize transactions correctly within the service.
  - [ ] Verify atomicity with unit tests.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: CrudService Feature Parity' (Protocol in workflow.md)

## Phase 3: Express Router Refactoring

- [ ] Task: Refactor Express CRUD router to use `CrudService`.
  - [ ] Remove duplicated payload processing logic from `express/src/routers/crud.ts`.
  - [ ] Delegate all CRUD operations to `CrudService`.
- [ ] Task: Verify backward compatibility.
  - [ ] Run existing `express` integration tests to ensure no regressions in the HTTP API.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Express Router Refactoring' (Protocol in workflow.md)

## Phase 4: Integration & Documentation

- [ ] Task: Write end-to-end integration tests for new features.
  - [ ] Verify `includeDepth` and complex filters via HTTP in `express/test/integration/crudConsolidation.test.ts`.
- [ ] Task: Update framework documentation.
  - [ ] Document `includeDepth` and filter capabilities in `conductor/framework/dsl.md`.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Integration & Documentation' (Protocol in workflow.md)
