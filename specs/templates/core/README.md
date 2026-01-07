# @enginehq/core

EngineJS core runtime primitives: DSL registry, ORM adapter, pipelines, workflows/outbox, RLS/ACL utilities, and engine bootstrap.

> Status: **Technical Preview (v0.1.2)** — Active development; APIs may change.

## Install

```sh
npm i @enginehq/core
```

## Usage

Create and initialize an EngineJS runtime:

```ts
import { createEngine } from '@enginehq/core';

const engine = createEngine({
  app: { name: 'my-app', env: 'development' },
  db: { url: process.env.DATABASE_URL!, dialect: 'postgres' },
  dsl: { fragments: { modelsDir: 'dsl/models', metaDir: 'dsl/meta' } },
  auth: { jwt: { accessSecret: 'dev', accessTtl: '1h' } },
  acl: {},
  rls: { subjects: {}, policies: {} },
  // For future UI editing, prefer DB-backed workflows:
  workflows: { enabled: true, registry: 'db' }, // 'fs' | 'db'
});

await engine.init();
```
