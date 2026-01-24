# EngineJS Framework — Express Adapter & CRUD Service

## Introduction
EngineJS provides a unified request handling architecture that bridges HTTP interfaces (via Express) with core business logic (via the `CrudService`). This integration ensures that all operations—whether triggered via API or internally—pass through the same security, validation, and pipeline logic.

## Express Adapter
The Express adapter (`@enginehq/express`) provides the HTTP interface for the framework.

### Middleware Stack
Every request to an EngineJS app passes through a standardized middleware stack:
1. **`responseEnvelope`**: Augments the `res` object with `.ok()` and `.fail()` methods, ensuring a consistent JSON response structure across the entire API.
2. **`servicesMiddleware`**: Injects the framework's `ServiceRegistry` into the `req` object.
3. **`actorMiddleware`**: Resolves the `Actor` (identity) for the current request using a configurable `ActorResolver`.

### Generic CRUD Router
The framework automatically mounts a generic CRUD router. By default, it is mounted at `/api`, but this is configurable via `http.crudPath` in `enginejs.config.ts`.

The router maps HTTP verbs to model operations:
- **`GET /api/:model`**: List records (supports search, filters, sort, and pagination).
- **`GET /api/:model/:id`**: Read a single record.
- **`POST /api/:model`**: Create a new record.
- **`PATCH /api/:model/:id`**: Update an existing record.
- **`DELETE /api/:model/:id`**: Soft-delete a record.

### Custom Routes & File-Based Routing

EngineJS supports file-based routing, inspired by frameworks like Next.js, allowing you to define custom API endpoints by organizing files within a `routes/` directory. The `autoloadRoutes` function automatically discovers and registers these routes.

- **File-Based Mapping**: The directory structure within `routes/` directly maps to the URL path.
  - Example: A file at `routes/users/profile.ts` would map to `/api/users/profile`.
- **`index.ts` Files**: An `index.ts` file in a directory will be mounted at the parent directory's path.
  - Example: `routes/users/index.ts` would map to `/api/users`.
- **Dynamic Segments**: Use square brackets `[param]` in file or folder names to create dynamic URL segments. These are automatically converted to Express-style `:param` (e.g., `:id`).
  - Example: `routes/users/[id].ts` maps to `/api/users/:id`.
  - Example: `routes/[version]/items.ts` maps to `/api/:version/items`.
- **Global Prefix**: You can set a global prefix for all custom routes using `http.routesPath` in `enginejs.config.ts`. The default is `/api`.
- **Route Override**: Individual route files can override the global prefix or their generated path by exporting a `path` (or `prefix`) constant. This allows for fine-grained control over specific route endpoints.

**Example: `routes/items/[id].ts`**

```typescript
// examples/my-app/routes/items/[id].ts
import type { Express } from 'express';
import type { EngineRuntime } from '@enginehq/core';

// This route will be mounted at /api/items/:id (assuming http.routesPath is /api)
export default async function registerRoutes({ app, engine }: { app: Express, engine: EngineRuntime }) {
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
  "pagination": { "limit": 10, "totalCount": 100, ... } // Only for list
}
```

## Core CRUD Service
The `CrudService` in `@enginehq/core` is the engine-room of data operations. It is designed to be usable both as an HTTP backend and as a service for internal system tasks (e.g., within workflows).

### Operation Lifecycle
For every write operation (`create`, `update`, `delete`), the service executes the following steps:
1. **Security Check**: Executes ACL and RLS checks against the current actor.
2. **Pre-Validation Pipeline**: Runs the `beforeValidate` phase (sanitization, defaults).
3. **Validation Pipeline**: Runs the `validate` phase (business rules, required fields).
4. **Pre-Persist Pipeline**: Runs the `beforePersist` phase.
5. **Persistence**: Maps DSL fields to Sequelize attributes and executes the database operation.
6. **Junction Updates**: Manages many-to-many associations for `multi: true` foreign keys.
7. **Post-Persist Pipeline**: Runs the `afterPersist` phase.
8. **Workflow Emission**: Emits an event to the `workflow_events_outbox` if workflows are enabled.
9. **Response Pipeline**: Runs the `response` phase (redaction).
10. **Pruning**: Strips internal fields and ensures the returned object matches the DSL definition.

### Internal vs External Calls
- **External (HTTP)**: Triggered by the Express router; always enforces ACL/RLS and runs full pipelines.
- **Internal (Workflows/Plugins)**: Can be called via `engine.services.resolve('crudService')`. Supports options to `bypassAclRls` or skip specific pipeline phases for trusted system operations.
