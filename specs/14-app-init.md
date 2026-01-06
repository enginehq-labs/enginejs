# EngineJS App Scaffold + CLI

EngineJS ships an **opinionated app layout** (inspired by file-based conventions like expo-router) and a CLI (`enginehq`) to initialize and run apps.

## App layout (required)

An EngineJS app is a folder with:

- `dsl/`
  - `dsl/schema.json` — Ajv schema used by `compileDslFromFs` (can be minimal `{ "type": "object" }` initially)
  - `dsl/models/*.json` — app models
  - `dsl/meta/*.json` — system/meta models (at minimum `workflow_events_outbox` when workflows are enabled)
- `workflow/*.ts` — workflow specs (file-based registry)
- `pipeline/*.ts` — pipeline specs (file-based registry; preferred term: “pipeline”)
- `routes/*.ts` — custom HTTP endpoints (customer endpoints, etc.)
- `enginejs.config.ts` — app config (TypeScript)
- `package.json` — depends on `enginehq`

## Config file (required)

`enginejs.config.ts` must export a default object:

- `engine` — an `EngineConfig` for `createEngine()`
- `http` — `{ host?: string, port: number }`
- `autoload` (optional) — directories to load (defaults shown):
  - `pipelinesDir: "pipeline"`
  - `workflowsDir: "workflow"`
  - `routesDir: "routes"`

## File-based loading conventions (v0.1.x)

### Pipelines

Each file in `pipeline/` must export one of:

- default export: `{ [modelKey: string]: unknown }` (pipeline spec per model key)
- named export `pipelines`: `{ [modelKey: string]: unknown }`

Each pipeline spec is registered into the engine’s `pipelines` registry.

### Workflows

Each file in `workflow/` must export a workflow spec:

- default export: `{ name: string, triggers: [...], steps: [...] }`
- named export `workflow`: same shape

The workflow is registered into the engine’s `workflows` registry by `name`.

### Routes

Each file in `routes/` must export:

- default export: `(ctx: { app: Express, engine: EngineRuntime }) => void`
- OR named export `registerRoutes` with the same signature

Routes are mounted after the engine middleware, so custom endpoints can use `req.engine`/services if desired.

## Runtime entrypoint (required)

Apps run without a handwritten server entry file.

App `package.json` must set:

- `"main": "./node_modules/enginehq/dist/runtime/app.js"`
- `"scripts": { "start": "node --loader tsx .", "dev": "node --loader tsx ." }`

This allows `enginejs.config.ts` (and route/workflow/pipeline TS files) to be loaded at runtime.

## CLI (required)

The unscoped `enginehq` package must ship a CLI binary:

- `enginehq init <dir>` — creates the app folder structure and starter files
- `enginehq start` — runs the app in the current working directory
- `enginehq dev` — alias of `start` for now (watch mode may come later)

