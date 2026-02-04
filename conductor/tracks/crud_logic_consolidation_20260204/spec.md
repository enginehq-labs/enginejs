# Spec: CRUD Logic Consolidation & Feature Parity

## Overview
This track aims to consolidate the core CRUD logic (payload processing, relationship handling, and filtering) into `@enginehq/core`, eliminating duplication currently present in `@enginehq/express`. This will ensure that all protocols (HTTP, CLI, Internal) behave identically and benefit from the same security and validation rules.

## Functional Requirements
1.  **Consolidate Utilities:** Move the following functions from `@enginehq/express` to `@enginehq/core`:
    - `pruneUnknownPayload`: Remove fields not present in the DSL.
    - `stripVirtualFields`: Remove fields marked with `save: false`.
    - `parseArrayish`: Unified parsing for CSV and JSON arrays.
    - `normalizePayloadMultiFields`: Handle junction-backed relationship arrays.
2.  **Enhance `CrudService` (@enginehq/core):**
    - Implement recursive relationship expansion using `includeDepth`.
    - Support complex nested filtering (AND/OR logic) directly in the service.
    - Ensure "multi" field updates are atomic and handled within the service layer.
3.  **Refactor Express Router:**
    - Update `@enginehq/express` CRUD router to delegate all payload processing and relationship logic to `CrudService`.
    - Ensure the HTTP API remains backward compatible.

## Non-Functional Requirements
- **Node.js 22+:** Strictly use features compatible with the targeted runtime.
- **Zero Duplication:** Ensure no logic for payload normalization exists in the express package.
- **Performance:** Ensure recursive expansion (`includeDepth`) is optimized to avoid N+1 query issues where possible.

## Acceptance Criteria
- `CrudService` unit tests pass with consolidated utilities.
- Existing `@enginehq/express` integration tests pass without changes to expected output.
- `includeDepth` functionality verified via integration tests.
- Complex filters (e.g., filtering a model by a property of a junction-linked model) work correctly in the service layer.
