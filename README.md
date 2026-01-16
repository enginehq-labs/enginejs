# EngineJS (Technical Preview)

EngineJS is a specs-driven TypeScript + Express backend framework for building schema-as-code systems:

- JSON DSL models → runtime + Sequelize models
- generic CRUD with ACL + configurable multi-subject RLS
- pipelines (transforms/validators/plugins)
- workflows + durable outbox + scheduler/replayer/retention

> Status: **Technical Preview (v0.1.2)** — Active development; APIs may change. Not production-ready yet.

## Packages

- `@enginehq/core` — core runtime (DSL, ORM, ACL/RLS, pipelines, workflows, migrations, core CRUD service)
- `@enginehq/auth` — JWT HS256 + optional refresh sessions (rotation/revocation)
- `@enginehq/express` — Express adapter (middleware, envelope, generic HTTP CRUD, admin endpoints)
- `enginehq` — unscoped umbrella re-export

## Install

```sh
npm i enginehq
```

## Quickstart

Create a new EngineJS app:

```sh
npx enginehq init my-app
cd my-app
npm i
npx enginehq sync
npm run dev
```

Optional: DB-backed workflows (recommended for future UI editing):

```sh
# enginejs.config.ts -> engine.workflows.registry = "db"
npx enginehq workflows sync
```

## Roadmap

See `ROADMAP.md`.

## Releasing

See `RELEASING.md`.

## Development model

This repo uses [Conductor](https://github.com/Primefit/conductor), a spec-driven development framework. All project context, tracks, and implementation plans are located in the `conductor/` directory.

- `conductor/product.md` — Product vision and scope
- `conductor/tech-stack.md` — Canonical technology stack
- `conductor/workflow.md` — Development and task procedures
- `conductor/tracks.md` — Project tracks and progress tracking

