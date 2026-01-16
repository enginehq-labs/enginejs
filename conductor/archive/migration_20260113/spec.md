# Track Spec: Migrate EngineJS to Conductor

## Goal
The goal of this track is to migrate the EngineJS monorepo from a strict "spec-driven codegen" model (where `specs/` is the source of truth and code is generated) to a standard Conductor project structure where the **code is the source of truth**.

## Key Changes

1.  **Eliminate Codegen Workflow:**
    *   Remove the `specs/` directory.
    *   Remove generation scripts from the root `package.json` (`gen`, `gen:clean`, `cycle`, `verify`, `test:e2e`, `gen:check`).
    *   Remove `tools/` scripts related to generation (`gen.mjs`, `cycle.mjs`, `verify_templates.mjs`, `verify_regen.mjs`).

2.  **Preserve Architecture:**
    *   The "Schema-as-Code" architecture (DSL, ACL, RLS, Workflows) remains integral to the project.
    *   The `conductor/` directory (Product Guide, Guidelines, Tech Stack) becomes the new high-level documentation source.

3.  **Update Build & Test:**
    *   Ensure the project builds and tests correctly without the `npm run gen` step.
    *   Update `package.json` scripts to focus on standard development lifecycles (`build`, `test`, `lint`).

4.  **Documentation:**
    *   Update root `README.md` to reflect the new development model (Conductor-driven).
    *   Update `AGENTS.md` to remove references to the old spec-driven model.

## Validation
*   **Build:** `npm run build` must succeed for all workspaces.
*   **Tests:** `npm run test` (unit and integration) must pass.
*   **Cleanliness:** The repository must not contain `specs/` or codegen tools after migration.
