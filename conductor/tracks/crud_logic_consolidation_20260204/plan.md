# Plan: CRUD Logic Consolidation & Feature Parity

## Phase 1: Core Utilities Consolidation [checkpoint: 556c1fa]

- [x] Task: Move payload processing utilities to `@enginehq/core`. 83ffc8e
  - [x] Create `core/src/crud/utils.ts` and implement `pruneUnknownPayload`, `stripVirtualFields`, `parseArrayish`, and `normalizePayloadMultiFields`.
  - [x] Write unit tests in `core/test/unit/crud/utils.test.ts`.
- [x] Task: Integrate utilities into `CrudService`. 83ffc8e
  - [x] Update `CrudService` to use these utilities for all mutation operations (`create`, `update`).
  - [x] Ensure `core` unit tests pass.
- [x] Task: Conductor - User Manual Verification 'Phase 1: Core Utilities Consolidation' 556c1fa

## Phase 2: CrudService Feature Parity

- [x] Task: Implement recursive expansion (`includeDepth`) in `CrudService`. ... 4c7fde7
  - [x] Write unit tests for `includeDepth` in `core/test/unit/crud/service.test.ts`. ... 4c7fde7
  - [x] Implement expansion logic in `read` and `list` methods. ... 4c7fde7
- [x] Task: Support complex filtering in `CrudService`. ... 4c7fde7
  - [x] Write unit tests for nested AND/OR and junction-based filters. ... 4c7fde7
  - [x] Implement filter parsing and application in `list` method. ... 4c7fde7
- [x] Task: Implement atomic junction updates. ... 4c7fde7
  - [x] Ensure `multi` field updates use Sequelize transactions correctly within the service. ... 4c7fde7
  - [x] Verify atomicity with unit tests. ... 4c7fde7
- [x] Task: Conductor - User Manual Verification 'Phase 2: CrudService Feature Parity' (Protocol in workflow.md)
      [checkpoint: 4c7fde7]

## Phase 3: Express Router Refactoring [checkpoint: b377a76]

- [x] Task: Integrate `@enginehq/core/crud/utils` in `@enginehq/express`.
  - [x] Update `express/src/routers/crud.ts` to use imported utilities.
  - [x] Remove redundant inline filtering and payload processing logic from `express/src/routers/crud.ts`.
  - [x] Delegate all CRUD operations to `CrudService`. f0de626
- [x] Task: Verify backward compatibility. f0de626
  - [x] Run existing `express` integration tests to ensure no regressions in the HTTP API. f0de626
- [x] Task: Conductor - User Manual Verification 'Phase 3: Express Router Refactoring' (Protocol in workflow.md) [checkpoint: b377a76]

## Phase 4: Integration & Documentation

- [ ] Task: Write end-to-end integration tests for new features.
  - [ ] Verify `includeDepth` and complex filters via HTTP in `express/test/integration/crudConsolidation.test.ts`.
- [ ] Task: Update framework documentation.
  - [ ] Document `includeDepth` and filter capabilities in `conductor/framework/dsl.md`.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Integration & Documentation' (Protocol in workflow.md)
