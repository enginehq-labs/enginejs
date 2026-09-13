# EngineJS Framework: Express Adapter & CRUD Service

## Introduction
EngineJS provides a unified request handling architecture that bridges HTTP interfaces (via Express) with core business logic (via the `CrudService`). HTTP requests and internal calls use the same security, validation and pipeline logic. An internal call can skip ACL, RLS or pipelines with call options. See "Internal vs External Calls".

## App Entry Point
EngineJS apps are zero-boilerplate. After initializing with `enginehq init`, the app's `package.json` scripts use the CLI to start the server. No `server.ts` file is required.

```json
{
  "scripts": {
    "start": "enginehq start",
    "dev":   "enginehq dev"
  }
}
```

The `enginehq start` command runs the built runtime, `enginehq/dist/runtime/app.js`, with tsx. `enginehq dev` runs the same runtime, with no watch mode. The runtime:
1. Loads `enginejs.config.ts` from the current directory.
2. Creates the engine and calls `engine.init()`.
3. Loads `pipeline/ops.ts` and `workflow/steps.ts` if they exist, then autoloads the `pipeline/`, `workflow/` and `routes/` directories.
4. Starts the Express server on `http.port` from the app config (default: `3000`).

> **Note**: `"main"` in `package.json` is not required when using `enginehq start`. The CLI resolves the runtime path internally.

## Express Adapter
The Express adapter (`@enginehq/express`) provides the HTTP interface for the framework.

### Middleware Stack
Every request to an EngineJS app passes through this middleware stack, in this order:
1. **Observability**: Sets the `traceId` for the request.
2. **`express.json`**: Parses JSON bodies, with a limit of 2 MB.
3. **`responseEnvelope`**: Augments the `res` object with `.ok()` and `.fail()` methods, ensuring a consistent JSON response structure across the entire API.
4. **`servicesMiddleware`**: Adds `req.services`, with `get` and `has`, over the service registry.
5. **`actorMiddleware`**: Resolves the `Actor` (identity) for the current request. The default is the anonymous actor. When the `enginehq` runtime starts the app and `auth.jwt.accessSecret` is set, the runtime wires a resolver that verifies `Authorization: Bearer` tokens. A missing or invalid token gives the anonymous actor. A `resolveActor` in the app config replaces that resolver. A direct call to `createEngineExpressApp` wires no resolver. See [Auth & Sessions](auth.md) for details.

### Generic CRUD Router
The framework automatically mounts a generic CRUD router. By default it mounts at `/api/crud`. Set `engine.http.crudPath` to change it. `engine.http.basePath` is added in front.

The router maps HTTP verbs to model operations:
- **`GET /api/crud/:model`**: List records. Supports `filters`, `sort`, `page`, `limit`, `includeDepth`, `includeDeleted` and `includeArchived`. The `find` search parameter does nothing today (issue #12).
- **`GET /api/crud/:model/:id`**: Read a single record.
- **`POST /api/crud/:model`**: Create a new record.
- **`PATCH /api/crud/:model/:id`**: Update an existing record.
- **`DELETE /api/crud/:model/:id`**: Soft-delete a record. The response data is `{ "ok": true }`.

### Custom Routes & File-Based Routing

EngineJS supports file-based routing, inspired by frameworks like Next.js, allowing you to define custom API endpoints by organizing files within a `routes/` directory. The `autoloadRoutes` function automatically discovers and registers these routes.

- **File-Based Mapping**: The directory structure within `routes/` directly maps to the URL path.
  - Example: A file at `routes/users/profile.ts` would map to `/api/users/profile`.
- **`index.ts` Files**: An `index.ts` file mounts at the path of its own directory.
  - Example: `routes/users/index.ts` would map to `/api/users`.
- **Dynamic Segments**: Use square brackets `[param]` in file or folder names to create dynamic URL segments. These are automatically converted to Express-style `:param` (e.g., `:id`).
  - Example: the router for `routes/users/[id].ts` mounts at `/api/users`, because the mount path drops a trailing dynamic segment. The module declares that segment, for example `app.get('/:id', ...)`, which serves `/api/users/:id`.
  - Example: `routes/[version]/items.ts` maps to `/api/:version/items`.
- **Global Prefix**: Set a global prefix for all custom routes with `engine.http.routesPath` in `enginejs.config.ts`. The default is `/api`. `engine.http.basePath` is added in front.
- **Route Override**: A route file can export a `path` (or `prefix`) constant. Either export replaces the whole mount path. `engine.http.basePath` is still added in front.

**Example: `routes/items/[id].ts`**

```typescript
// routes/items/[id].ts
import type { Router } from 'express';
import type { EngineRuntime } from '@enginehq/core';

// The router mounts at /api/items (with routesPath /api). `app` is an Express Router.
// app.get('/:id') serves /api/items/:id, and app.post('/:id/update') serves /api/items/:id/update.
export default async function registerRoutes({ app, engine }: { app: Router, engine: EngineRuntime }) {
  app.get('/:id', (req, res) => {
    const { id } = req.params;
    res.ok({ message: `Fetching item with ID: ${id}` });
  });

  app.post('/:id/update', (req, res) => {
    const { id } = req.params;
    const { data } = req.body;
    res.ok({ message: `Updating item ${id} with data: ${JSON.stringify(data)}` });
  });
}
```

### Response Structure
All API responses follow a strict envelope:
```json
{
  "success": true,
  "code": 200,
  "data": { ... },
  "pagination": { "limit": 10, "totalCount": 100, ... } // null for a response that is not a list
}
```

An error response is `{ "success": false, "code", "message", "errors" }`.

## Core CRUD Service
The `CrudService` in `@enginehq/core` is the engine-room of data operations. It is designed to be usable both as an HTTP backend and as a service for internal system tasks (e.g., within workflows).

### Operation Lifecycle
For `create` and `update`, the service runs the steps below. `delete` runs step 1, marks the row deleted, runs steps 7 and 8, and emits the workflow event with the row as stored.
1. **Security Check**: Executes ACL and RLS checks against the current actor. `bypassAclRls` skips this step.
2. **Pre-Validation Pipeline**: Runs the `beforeValidate` phase (sanitization, defaults).
3. **Validation Pipeline**: Runs the `validate` phase (business rules, required fields).
4. **Pre-Persist Pipeline**: Runs the `beforePersist` phase.
5. **Persistence**: Maps DSL fields to Sequelize attributes and executes the database operation.
6. **Junction Updates**: Manages many-to-many associations for `multi: true` foreign keys.
7. **Post-Persist Pipeline**: Runs the `afterPersist` phase.
8. **Response Pipeline**: Runs the `response` phase (redaction).
9. **Pruning**: Drops keys that are not DSL fields, include aliases or `*_auto_name` keys. System fields such as `deleted` stay.
10. **Workflow Emission**: Emits an event to the `workflow_events_outbox` if workflows are enabled. Where a response phase runs, the event comes after it. The event comes before pruning for `update`, and for the bypass path of `create`.

### Internal vs External Calls
- **External (HTTP)**: Triggered by the Express router. It always enforces ACL and RLS, and runs the pipelines of the action.
- **Internal (Workflows/Plugins)**: Resolve the service with `engine.services.resolve('crudService', { scope: 'singleton' })`. Call options: `bypassAclRls` skips ACL and RLS, `runPipelines: false` skips all pipelines, and `runResponsePipeline: false` skips the response phase. No option skips one other phase.
