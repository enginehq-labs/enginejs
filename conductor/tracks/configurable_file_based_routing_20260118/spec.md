# Specification: Configurable & File-Based Routing

## Overview
Refactor the EngineJS routing system to provide better defaults, high configurability, and a modern file-based routing experience for custom endpoints. This track eliminates hardcoded versioning patterns in favor of a "rolling" API model and simplifies route management through directory structure.

## Functional Requirements

### 1. Configurable Router Prefixes
- **EngineConfig Enhancement**: Add `http.crudPath`, `http.adminPath`, and `http.routesPath` to the global configuration.
- **Default Values**:
    - `crudPath`: Defaults to `/api`.
    - `adminPath`: Defaults to `/setup`.
    - `routesPath`: Defaults to `/api`.
- **Automatic Mounting**: The Express adapter must respect these prefixes when mounting the generic CRUD router, Admin router, and custom routes.

### 2. File-Based Routing (Next.js Style)
- **Autoloader Refactor**: Update the `autoloadRoutes` utility to recursively walk the `routes/` directory.
- **Path Resolution**:
    - Folder structure directly maps to URL segments (e.g., `routes/billing/invoice.ts` -> `/api/billing/invoice`).
    - `index.ts` resolution: Files named `index.ts` map to the parent directory's path (e.g., `routes/users/index.ts` -> `/api/users`).
- **Dynamic Segments**:
    - Support bracket syntax `[param]` for dynamic path segments in both file and folder names.
    - Automatic conversion: `routes/posts/[slug].ts` becomes `/api/posts/:slug`.
    - Automatic conversion: `routes/users/[id]/settings.ts` becomes `/api/users/:id/settings`.

### 3. Per-Route Overrides
- **Exported Path**: Route modules can export a `path` (or `prefix`) constant.
- **Behavior**: If a route file exports a `path`, the autoloader must use that exact string as the mount point, bypassing the folder structure and the global `routesPath` prefix.

### 4. Type-Safe Parameters
- **Parameter Extraction**: Ensure segments extracted from bracket naming are correctly identified.
- **Developer Experience**: Provide a mechanism (e.g., generated types or a utility) to access these parameters with type safety within the route handler.

## Non-Functional Requirements
- **Performance**: The recursive directory walk should be efficient and cached or performed only at startup.
- **Consistency**: Maintain the existing `@enginehq` monorepo structure and coding standards.

## Acceptance Criteria
- [ ] `enginejs.config.ts` successfully overrides all three prefixes.
- [ ] Files in `routes/` are served correctly according to their folder nesting.
- [ ] `index.ts` files resolve to the base directory path.
- [ ] `[id].ts` naming translates to `:id` in Express routing.
- [ ] Exporting `const path = '/health'` in any route file mounts it at `/health` regardless of its location.
- [ ] CRUD operations are accessible at `/api/:model` by default.
- [ ] All existing integration tests pass (updated to use the new prefixes).

## Out of Scope
- Versioned API support (this track explicitly moves to a rolling/non-versioned model).
- Middleware auto-loading based on file structure (only routes are covered here).
