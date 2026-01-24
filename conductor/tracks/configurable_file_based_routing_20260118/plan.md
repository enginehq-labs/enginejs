# Implementation Plan: Configurable & File-Based Routing

## Phase 1: Core Prefix Configuration
- [x] Task: Update `EngineConfig` type and `createExpressApp`.
    - [x] Sub-task: Add `crudPath`, `adminPath`, and `routesPath` to `EngineConfig.http` in `@enginehq/core`.
    - [x] Sub-task: Update `createExpressApp` in `@enginehq/express` to respect these config values when mounting routers.
    - [x] Sub-task: Ensure default values (`/api`, `/setup`, `/api`) are applied when config is missing.
- [x] Task: Write unit tests for configuration-driven mounting.
    - [x] Sub-task: Verify that setting `crudPath: '/v1'` mounts the CRUD router at `/v1`.
    - [x] Sub-task: Verify that setting `adminPath: '/secret-admin'` mounts the Admin router at `/secret-admin`.
    - [x] Sub-task: Verify that setting `routesPath: '/custom'` is used by the autoloader.
- [x] Task: Conductor - User Manual Verification 'Phase 1: Core Prefix Configuration' (Protocol in workflow.md)

## Phase 2: Next.js-Style Autoloader
- [x] Task: Implement recursive directory walking in `autoloadRoutes`.
    - [x] Sub-task: Refactor `autoloadRoutes` in `enginehq` to recursively traverse the `routes/` directory.
    - [x] Sub-task: Implement `index.ts` resolution (mounting at the parent folder's path).
- [x] Task: Implement dynamic segment conversion.
    - [x] Sub-task: Add logic to convert `[param]` segments in file/folder names to Express `:param` syntax.
    - [x] Sub-task: Verify that `routes/users/[id].ts` becomes `/api/users/:id`.
- [x] Task: Write unit tests for the file-based routing logic.
    - [x] Sub-task: Test deeply nested structures.
    - [x] Sub-task: Test dynamic parameters in both files and folders.
- [x] Task: Conductor - User Manual Verification 'Phase 2: Next.js-Style Autoloader' (Protocol in workflow.md)

## Phase 3: Route Overrides & Integration
- [x] Task: Implement per-route `path` override.
    - [x] Sub-task: Update `autoloadRoutes` to detect `export const path` or `export const prefix` in route modules.
    - [x] Sub-task: If found, use the exported value as the mount point, bypassing automatic path generation.
- [x] Task: Update existing routes and examples.
    - [x] Sub-task: Update `hello-enginejs-app` and `link-shortener` example routes to use the new file-based conventions.
    - [x] Sub-task: Ensure existing integration tests pass with the new default `/api` prefix.
- [x] Task: Conductor - User Manual Verification 'Phase 3: Route Overrides & Integration' (Protocol in workflow.md)

## Phase 4: Documentation & Cleanup
- [x] Task: Update framework documentation.
    - [x] Sub-task: Author documentation for the new routing system in `conductor/framework/routing.md` (or update `adapter.md`).
    - [x] Sub-task: Provide examples of dynamic routing and path overrides.
- [x] Task: Final project-wide verification.
    - [x] Sub-task: Run all workspace tests and verify zero regressions.
- [x] Task: Conductor - User Manual Verification 'Phase 4: Documentation & Cleanup' (Protocol in workflow.md)
