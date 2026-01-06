# EngineJS (Technical Preview)

EngineJS is a specs-driven TypeScript + Express backend framework for building schema-as-code systems:

- JSON DSL models → runtime + Sequelize models
- generic CRUD with ACL + configurable multi-subject RLS
- pipelines (transforms/validators/plugins)
- workflows + durable outbox + scheduler/replayer/retention

> Status: **Technical Preview (v0.1.0)** — Active development; APIs may change. Not production-ready yet.

## Packages

- `@enginehq/core` — core runtime (DSL, ORM, ACL/RLS, pipelines, workflows, migrations, core CRUD service)
- `@enginehq/auth` — JWT HS256 + optional refresh sessions (rotation/revocation)
- `@enginehq/express` — Express adapter (middleware, envelope, generic HTTP CRUD, admin endpoints)
- `enginehq` — unscoped umbrella re-export

## Install

```sh
npm i @enginehq/core @enginehq/express @enginehq/auth
```

## Quickstart

```ts
import express from 'express';
import { createEngine } from '@enginehq/core';
import { createEngineExpressApp } from '@enginehq/express';
import { getBearerToken, verifyActorAccessTokenHS256 } from '@enginehq/auth';

const engine = createEngine({
  app: { name: 'my-app', env: 'development' },
  db: { url: process.env.DATABASE_URL!, dialect: 'postgres' },
  dsl: { schemaPath: 'dsl/schema.json', fragments: { modelsDir: 'dsl/models', metaDir: 'dsl/meta' } },
  auth: { jwt: { accessSecret: process.env.JWT_SECRET || 'dev', accessTtl: '1h' } },
  acl: {},
  rls: { subjects: {}, policies: {} },
  workflows: { enabled: true },
});

await engine.init();

const app = express();
app.use(
  createEngineExpressApp(engine, {
    resolveActor: async (req) => {
      const token = getBearerToken(req.header('authorization'));
      if (!token) return { isAuthenticated: false, subjects: {}, roles: [], claims: {} };
      return verifyActorAccessTokenHS256({ token, secret: process.env.JWT_SECRET || 'dev' });
    },
  }),
);
app.listen(3000);
```

## Roadmap

See `ROADMAP.md`.

## Development model

This repo is deterministic/specs-driven:

- `specs/` is the source of truth
- `specs/templates/**` must match generated outputs
- regenerate via `npm run gen` and validate via `npm test`

