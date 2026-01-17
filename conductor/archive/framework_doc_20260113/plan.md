# Track Plan: Framework Documentation & Technical Specification

## Phase 1: Setup & Initialization [checkpoint: 8a909c1]
- [x] Task: Create `conductor/framework/` directory and initialize `overview.md` skeleton. 046e5fb
- [x] Task: Conductor - User Manual Verification 'Phase 1: Setup & Initialization' (Protocol in workflow.md) 8a909c1

## Phase 2: Core Runtime Specification [checkpoint: fc3876f]
- [x] Task: Document Lifecycle & Service Container (`lifecycle.md`). 0b99563
    - [x] Sub-task: Analyze `core/src/services`, `core/src/engine/createEngine.ts`, and plugin interfaces.
    - [x] Sub-task: Author `lifecycle.md` detailing registration scopes and hook order.
- [x] Task: Document DSL Compilation & ORM Initialization (`dsl.md`). 0b99563
    - [x] Sub-task: Analyze `core/src/dsl`, `core/src/orm`, and corresponding unit tests.
    - [x] Sub-task: Author `dsl.md` detailing compilation rules and augmentation logic.
- [x] Task: Conductor - User Manual Verification 'Phase 2: Core Runtime Specification' (Protocol in workflow.md) fc3876f

## Phase 3: Logic Engines Specification [checkpoint: c669e94]
- [x] Task: Document Security (ACL & RLS) Logic (`security.md`). 0b99563
    - [x] Sub-task: Analyze `core/src/acl`, `core/src/rls`, and RLS join path tests.
    - [x] Sub-task: Author `security.md` detailing rule evaluation and path scoping.
- [x] Task: Document Pipeline Architecture (`pipelines.md`). 0b99563
    - [x] Sub-task: Analyze `core/src/pipelines` and built-in op implementations.
    - [x] Sub-task: Author `pipelines.md` detailing phase ordering and custom op registration.
- [x] Task: Conductor - User Manual Verification 'Phase 3: Logic Engines Specification' (Protocol in workflow.md) c669e94

## Phase 4: Support Systems Specification [checkpoint: 4dccc41]
- [x] Task: Document Durable Workflows & Outbox (`workflows.md`). f550ffd
    - [x] Sub-task: Analyze `core/src/workflows`, outbox storage logic, and runner retry patterns.
    - [x] Sub-task: Author `workflows.md` detailing durability guarantees and trigger matching.
- [x] Task: Document Maintenance (Safe Sync & Migrations) (`maintenance.md`). f550ffd
    - [x] Sub-task: Analyze `core/src/orm/safeSync.ts` and `core/src/migrations`.
    - [x] Sub-task: Author `maintenance.md` detailing widening rules and snapshot logic.
- [x] Task: Conductor - User Manual Verification 'Phase 4: Support Systems Specification' (Protocol in workflow.md) 4dccc41

## Phase 5: Integration & Finalization [checkpoint: 62b69e3]
- [x] Task: Document Express Adapter & Core CRUD Service (`adapter.md`). 0b99563
    - [x] Sub-task: Analyze `express/src`, `core/src/crud`, and request flow integration.
    - [x] Sub-task: Author `adapter.md` detailing middleware stacks and generic CRUD mapping.
- [x] Task: Document Auth Module (JWT & Sessions) (`auth.md`). 0b99563
    - [x] Sub-task: Analyze `auth/src`, token signing logic, and session rotation tests.
    - [x] Sub-task: Author `auth.md` detailing subject resolution and HS256 handling.
- [x] Task: Finalize Architecture Overview (`overview.md`). 0b99563
    - [x] Sub-task: Map high-level module boundaries and system lifecycle summary.
- [x] Task: Conductor - User Manual Verification 'Phase 5: Integration & Finalization' (Protocol in workflow.md) 62b69e3
