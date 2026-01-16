# Track Plan: Framework Documentation & Technical Specification

## Phase 1: Setup & Initialization
- [ ] Task: Create `conductor/framework/` directory and initialize `overview.md` skeleton.
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Setup & Initialization' (Protocol in workflow.md)

## Phase 2: Core Runtime Specification
- [ ] Task: Document Lifecycle & Service Container (`lifecycle.md`).
    - [ ] Sub-task: Analyze `core/src/services`, `core/src/engine/createEngine.ts`, and plugin interfaces.
    - [ ] Sub-task: Author `lifecycle.md` detailing registration scopes and hook order.
- [ ] Task: Document DSL Compilation & ORM Initialization (`dsl.md`).
    - [ ] Sub-task: Analyze `core/src/dsl`, `core/src/orm`, and corresponding unit tests.
    - [ ] Sub-task: Author `dsl.md` detailing compilation rules and augmentation logic.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Core Runtime Specification' (Protocol in workflow.md)

## Phase 3: Logic Engines Specification
- [ ] Task: Document Security (ACL & RLS) Logic (`security.md`).
    - [ ] Sub-task: Analyze `core/src/acl`, `core/src/rls`, and RLS join path tests.
    - [ ] Sub-task: Author `security.md` detailing rule evaluation and path scoping.
- [ ] Task: Document Pipeline Architecture (`pipelines.md`).
    - [ ] Sub-task: Analyze `core/src/pipelines` and built-in op implementations.
    - [ ] Sub-task: Author `pipelines.md` detailing phase ordering and custom op registration.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Logic Engines Specification' (Protocol in workflow.md)

## Phase 4: Support Systems Specification
- [ ] Task: Document Durable Workflows & Outbox (`workflows.md`).
    - [ ] Sub-task: Analyze `core/src/workflows`, outbox storage logic, and runner retry patterns.
    - [ ] Sub-task: Author `workflows.md` detailing durability guarantees and trigger matching.
- [ ] Task: Document Maintenance (Safe Sync & Migrations) (`maintenance.md`).
    - [ ] Sub-task: Analyze `core/src/orm/safeSync.ts` and `core/src/migrations`.
    - [ ] Sub-task: Author `maintenance.md` detailing widening rules and snapshot logic.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Support Systems Specification' (Protocol in workflow.md)

## Phase 5: Integration & Auth Specification
- [ ] Task: Document Express Adapter & Core CRUD Service (`adapter.md`).
    - [ ] Sub-task: Analyze `express/src`, `core/src/crud`, and request flow integration.
    - [ ] Sub-task: Author `adapter.md` detailing middleware stacks and generic CRUD mapping.
- [ ] Task: Document Auth Module (JWT & Sessions) (`auth.md`).
    - [ ] Sub-task: Analyze `auth/src`, token signing logic, and session rotation tests.
    - [ ] Sub-task: Author `auth.md` detailing subject resolution and HS256 handling.
- [ ] Task: Finalize Architecture Overview (`overview.md`).
    - [ ] Sub-task: Map high-level module boundaries and system lifecycle summary.
- [ ] Task: Conductor - User Manual Verification 'Phase 5: Integration & Finalization' (Protocol in workflow.md)
