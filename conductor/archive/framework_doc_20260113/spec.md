# Track Spec: Framework Documentation & Technical Specification

## Overview
This track focuses on creating a comprehensive technical specification of the EngineJS framework within the Conductor directory. By exploring the source code and existing tests, we will document the internal logic, request flows, and architectural boundaries of the system. This documentation will serve as the technical source of truth for the framework's behavior.

## Scope of Documentation
We will document the following major modules:
- **Core Engines:** DSL Compilation & Model Init, Durable Workflows & Outbox, ACL & RLS Engine, and Pipeline Architecture (Transforms/Validators).
- **Support Systems:** Core CRUD Service & Express Adapter, Migration Runner & Safe Sync, Auth Module (JWT & Sessions), and Service Container & Plugin System (DI/Lifecycle).

## Functional Requirements
1. **Directory Structure:** Create a new directory `conductor/framework/` to house the module-specific documentation.
2. **Codebase Exploration:**
    - Analyze source code in `core/src`, `express/src`, and `auth/src` to identify canonical logic.
    - Analyze unit and integration tests to verify expected behavior and edge cases.
3. **Module Authoring:** Create dedicated markdown files for each module:
    - `dsl.md`: Compilation rules, system field augmentation, and ORM initialization.
    - `workflows.md`: Outbox durability guarantees, trigger matching, and runner logic.
    - `security.md`: ACL action mapping and multi-subject RLS path scoping.
    - `pipelines.md`: Phase ordering and built-in op behaviors.
    - `adapter.md`: Express middleware flow and the generic CRUD service interface.
    - `lifecycle.md`: Service registration scopes and plugin hook execution order.
    - `maintenance.md`: Safe sync widening rules and migration tracking.
    - `auth.md`: Token verification and session management logic.
4. **Architecture Overview:** Create `conductor/framework/overview.md` to map high-level module boundaries and the system lifecycle.

## Acceptance Criteria
- A `conductor/framework/` directory exists with files covering all specified modules.
- Documentation accurately reflects the implementation logic found in the current codebase.
- Technical descriptions are validated against existing test behaviors.
- The root `conductor/framework/overview.md` provides a clear entry point to the technical specifications.

## Out of Scope
- Authoring new application code or features.
- Writing or refactoring existing tests.
- Creating end-user tutorials or "Quickstart" guides (this track is for technical specification).
